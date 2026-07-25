import type {
  DecodedFluid,
  DecodedFluidContainer,
  DecodedGoodsBase,
  DecodedGtRecipe,
  DecodedItem,
  DecodedAnonymousIngredientGroup,
  DecodedOreDictionary,
  DecodedRecipe,
  DecodedRecipeIo,
  DecodedRecipeType,
  DecodedRepository,
  RecipeIoKind
} from './model';
import { PackDecodeError, WordReader } from './word-reader';

const FORMAT_VERSION = 5;
export { PackDecodeError };

function typeId(order: number, category: string, name: string): string {
  return `recipeType:${order}:${encodeURIComponent(category)}:${encodeURIComponent(name)}`;
}

function required(value: string | null, context: string): string {
  if (value === null) throw new PackDecodeError(`${context}: required string is null`);
  return value;
}

export function decodeFormat5(compressed: Uint8Array): DecodedRepository {
  const reader = new WordReader(compressed);
  const formatVersion = reader.int(0, 'format version');
  if (formatVersion !== FORMAT_VERSION) {
    throw new PackDecodeError(`Unsupported data format ${formatVersion}; required ${FORMAT_VERSION}`);
  }

  const itemPointers = reader.pointersAt(1, 'items');
  const fluidPointers = reader.pointersAt(2, 'fluids');
  const orePointers = reader.pointersAt(3, 'ore dictionaries');
  const typePointers = reader.pointersAt(4, 'recipe types');
  const recipePointers = reader.pointersAt(5, 'recipes');
  const servicePointers = reader.pointersAt(6, 'service items');
  const remapPointers = reader.pointersAt(7, 'obsolete recipe remaps');

  const idAt = (pointer: number, context: string) =>
    required(reader.stringAt(pointer + 4, `${context} id`), `${context} id`);

  // Format v5 can reference valid crafter/container goods which are intentionally absent
  // from the searchable root lists. Collect every reachable typed goods pointer so icons
  // and recipe ingredients never become dangling references.
  const searchableItemPointers = new Set(itemPointers);
  const searchableFluidPointers = new Set(fluidPointers);
  const allItemPointers = new Set([...itemPointers, ...servicePointers]);
  const allFluidPointers = new Set(fluidPointers);
  const allOrePointers = new Set(orePointers);

  for (const [index, pointer] of typePointers.entries()) {
    for (const offset of [3, 5]) {
      for (const itemPointer of reader.sliceAt(pointer + offset, `recipe type ${index} crafters`)) {
        if (itemPointer !== -1) allItemPointers.add(itemPointer);
      }
    }
    const defaultCrafter = reader.pointer(pointer + 6, `recipe type ${index} default crafter`, true);
    if (defaultCrafter !== null) allItemPointers.add(defaultCrafter);
  }
  for (const [recipeIndex, pointer] of recipePointers.entries()) {
    const packedIo = reader.sliceAt(pointer + 5, `recipe ${recipeIndex} I/O`);
    if (packedIo.length % 5 !== 0) {
      throw new PackDecodeError(`recipe ${recipeIndex} I/O: expected groups of 5, got ${packedIo.length} values`);
    }
    for (let index = 0; index < packedIo.length; index += 5) {
      const kind = packedIo[index];
      const goodsPointer = packedIo[index + 1];
      if (kind === 0 || kind === 3) allItemPointers.add(goodsPointer);
      else if (kind === 1) allOrePointers.add(goodsPointer);
      else if (kind === 2 || kind === 4) allFluidPointers.add(goodsPointer);
      else throw new PackDecodeError(`recipe ${recipeIndex} I/O ${index / 5}: invalid kind ${kind}`);
    }
  }
  for (const orePointer of allOrePointers) {
    for (const itemPointer of reader.sliceAt(orePointer + 5, `ore dictionary at ${orePointer} items`)) {
      allItemPointers.add(itemPointer);
    }
  }

  const processedItems = new Set<number>();
  const processedFluids = new Set<number>();
  while (processedItems.size < allItemPointers.size || processedFluids.size < allFluidPointers.size) {
    for (const itemPointer of allItemPointers) {
      if (processedItems.has(itemPointer)) continue;
      processedItems.add(itemPointer);
      const containerPointer = reader.pointer(itemPointer + 17, `item at ${itemPointer} container`, true);
      if (containerPointer !== null) {
        allFluidPointers.add(reader.pointer(containerPointer, `container at ${containerPointer} fluid`)!);
        const emptyItem = reader.pointer(containerPointer + 2, `container at ${containerPointer} empty item`, true);
        if (emptyItem !== null) allItemPointers.add(emptyItem);
      }
    }
    for (const fluidPointer of allFluidPointers) {
      if (processedFluids.has(fluidPointer)) continue;
      processedFluids.add(fluidPointer);
      for (const itemIndex of reader.sliceAt(fluidPointer + 16, `fluid at ${fluidPointer} container indices`)) {
        if (itemIndex < 0 || itemIndex >= itemPointers.length) {
          throw new PackDecodeError(`fluid at ${fluidPointer}: container item index ${itemIndex} is outside the root item list`);
        }
        allItemPointers.add(itemPointers[itemIndex]);
      }
    }
  }

  const orderedItems = [
    ...itemPointers,
    ...Array.from(allItemPointers).filter((pointer) => !searchableItemPointers.has(pointer)).sort((a, b) => a - b)
  ];
  const orderedFluids = [
    ...fluidPointers,
    ...Array.from(allFluidPointers).filter((pointer) => !searchableFluidPointers.has(pointer)).sort((a, b) => a - b)
  ];
  const orderedOres = [
    ...orePointers,
    ...Array.from(allOrePointers).filter((pointer) => !orePointers.includes(pointer)).sort((a, b) => a - b)
  ];

  const itemIdByPointer = new Map(orderedItems.map((pointer, index) => [pointer, idAt(pointer, `item ${index}`)]));
  const fluidIdByPointer = new Map(orderedFluids.map((pointer, index) => [pointer, idAt(pointer, `fluid ${index}`)]));
  const oreIdByPointer = new Map(orderedOres.map((pointer, index) => [pointer, idAt(pointer, `ore dictionary ${index}`)]));
  const recipeIdByPointer = new Map(recipePointers.map((pointer, index) => [pointer, idAt(pointer, `recipe ${index}`)]));

  const recipeTypeByPointer = new Map<number, DecodedRecipeType>();
  for (const [order, pointer] of typePointers.entries()) {
    const name = required(reader.stringAt(pointer, `recipe type ${order} name`), `recipe type ${order} name`);
    const category = required(reader.stringAt(pointer + 1, `recipe type ${order} category`), `recipe type ${order} category`);
    const rawDimensions = reader.sliceAt(pointer + 2, `recipe type ${order} dimensions`);
    if (rawDimensions.length !== 8) {
      throw new PackDecodeError(`recipe type ${order} dimensions: expected 8 values, got ${rawDimensions.length}`);
    }
    const crafter = (itemPointer: number, label: string) => ({
      id: idAt(itemPointer, label),
      name: required(reader.stringAt(itemPointer + 5, `${label} name`), `${label} name`),
      iconId: reader.int(itemPointer + 9, `${label} icon id`)
    });
    const crafters = (offset: number, label: string) =>
      Array.from(reader.sliceAt(pointer + offset, `recipe type ${order} ${label}`))
        .filter((itemPointer) => itemPointer !== -1)
        .map((itemPointer, index) => crafter(itemPointer, `recipe type ${order} ${label}[${index}]`));
    const defaultCrafterPointer = reader.pointer(pointer + 6, `recipe type ${order} default crafter`, true);
    recipeTypeByPointer.set(pointer, {
      id: typeId(order, category, name),
      order,
      name,
      category,
      dimensions: {
        itemInputs: { columns: rawDimensions[0], rows: rawDimensions[1] },
        fluidInputs: { columns: rawDimensions[2], rows: rawDimensions[3] },
        itemOutputs: { columns: rawDimensions[4], rows: rawDimensions[5] },
        fluidOutputs: { columns: rawDimensions[6], rows: rawDimensions[7] }
      },
      shapeless: reader.int(pointer + 4, `recipe type ${order} shapeless`) === 1,
      multiblocks: crafters(3, 'multiblocks'),
      singleblocks: crafters(5, 'singleblocks'),
      defaultCrafter: defaultCrafterPointer === null
        ? null
        : crafter(defaultCrafterPointer, `recipe type ${order} default crafter`)
    });
  }

  const recipeTypes = typePointers.map((pointer) => recipeTypeByPointer.get(pointer)!);

  const resolveRecipePointers = (offset: number, context: string) =>
    reader.pointersAt(offset, context).map((pointer, index) => {
      const id = recipeIdByPointer.get(pointer);
      if (!id) throw new PackDecodeError(`${context}[${index}]: pointer ${pointer} is not a recipe`);
      return id;
    });

  const decodeContainer = (pointer: number, context: string): DecodedFluidContainer => {
    const fluidPointer = reader.pointer(pointer, `${context} fluid`)!;
    const emptyPointer = reader.pointer(pointer + 2, `${context} empty item`, true);
    const fluidId = fluidIdByPointer.get(fluidPointer);
    const emptyItemId = emptyPointer === null ? null : itemIdByPointer.get(emptyPointer) ?? null;
    if (!fluidId) throw new PackDecodeError(`${context}: pointer ${fluidPointer} is not a fluid`);
    if (emptyPointer !== null && !emptyItemId) throw new PackDecodeError(`${context}: pointer ${emptyPointer} is not an item`);
    return { fluidId, amount: reader.int(pointer + 1, `${context} amount`), emptyItemId };
  };

  const decodeGoods = (pointer: number, context: string): Omit<DecodedGoodsBase, 'searchable'> => ({
    id: idAt(pointer, context),
    name: required(reader.stringAt(pointer + 5, `${context} name`), `${context} name`),
    mod: required(reader.stringAt(pointer + 6, `${context} mod`), `${context} mod`),
    internalName: required(reader.stringAt(pointer + 7, `${context} internal name`), `${context} internal name`),
    numericId: reader.int(pointer + 8, `${context} numeric id`),
    iconId: reader.int(pointer + 9, `${context} icon id`),
    tooltip: reader.stringAt(pointer + 10, `${context} tooltip`, true),
    unlocalizedName: reader.stringAt(pointer + 11, `${context} unlocalized name`, true) ?? '',
    nbt: reader.stringAt(pointer + 12, `${context} nbt`, true),
    searchMask: [0, 1, 2, 3].map((word) => reader.uint(pointer + word, `${context} search mask`)),
    productionRecipeIds: resolveRecipePointers(pointer + 13, `${context} production recipes`),
    usageRecipeIds: resolveRecipePointers(pointer + 14, `${context} usage recipes`)
  });

  const items: DecodedItem[] = orderedItems.map((pointer, index) => {
    const containerPointer = reader.pointer(pointer + 17, `item ${index} container`, true);
    return {
      ...decodeGoods(pointer, `item ${index}`),
      kind: 'item',
      searchable: searchableItemPointers.has(pointer),
      stackSize: reader.int(pointer + 15, `item ${index} stack size`),
      damage: reader.int(pointer + 16, `item ${index} damage`),
      container: containerPointer === null ? null : decodeContainer(containerPointer, `item ${index} container`)
    };
  });

  const fluids: DecodedFluid[] = orderedFluids.map((pointer, index) => ({
    ...decodeGoods(pointer, `fluid ${index}`),
    kind: 'fluid',
    searchable: searchableFluidPointers.has(pointer),
    isGas: reader.int(pointer + 15, `fluid ${index} isGas`) === 1,
    containerItemIds: Array.from(reader.sliceAt(pointer + 16, `fluid ${index} container indices`), (itemIndex) => {
      if (itemIndex < 0 || itemIndex >= itemPointers.length) {
        throw new PackDecodeError(`fluid ${index}: container item index ${itemIndex} is outside the root item list`);
      }
      return itemIdByPointer.get(itemPointers[itemIndex])!;
    })
  }));

  const ingredientGroups = orderedOres.map((pointer, index) => {
    const id = idAt(pointer, `ingredient group ${index}`);
    return {
      id,
      searchMask: [0, 1, 2, 3].map((word) => reader.uint(pointer + word, `ingredient group ${index} search mask`)),
      itemIds: reader.pointersAt(pointer + 5, `ingredient group ${index} items`).map((itemPointer, itemIndex) => {
      const itemId = itemIdByPointer.get(itemPointer);
      if (!itemId) throw new PackDecodeError(`ingredient group ${index} item ${itemIndex}: pointer ${itemPointer} is not an item`);
      return itemId;
      }),
      kind: (id.startsWith('g:') ? 'itemGroup' : 'oreDict') as 'itemGroup' | 'oreDict'
    };
  });
  const oreDictionaries = ingredientGroups.filter(
    (group): group is DecodedOreDictionary => group.kind === 'oreDict'
  );
  const anonymousIngredientGroups = ingredientGroups.filter(
    (group): group is DecodedAnonymousIngredientGroup => group.kind === 'itemGroup'
  );
  const ingredientGroupKindByPointer = new Map(
    orderedOres.map((pointer, index) => [pointer, ingredientGroups[index]!.kind])
  );

  const decodeGt = (pointer: number, context: string): DecodedGtRecipe => ({
    voltage: reader.int(pointer, `${context} voltage`),
    durationTicks: reader.int(pointer + 1, `${context} duration`),
    amperage: reader.int(pointer + 2, `${context} amperage`),
    voltageTier: reader.int(pointer + 3, `${context} voltage tier`),
    metadata: reader.pointersAt(pointer + 4, `${context} metadata`).map((metadataPointer, index) => ({
      key: required(reader.stringAt(metadataPointer, `${context} metadata ${index} key`), `${context} metadata ${index} key`),
      value: reader.double(metadataPointer + 1, `${context} metadata ${index} value`)
    })),
    circuitConflicts: reader.int(pointer + 5, `${context} circuit conflicts`),
    specialValue: reader.int(pointer + 6, `${context} special value`)
  });

  const ioKind: RecipeIoKind[] = ['item', 'oreDict', 'fluid', 'item', 'fluid'];
  const recipes: DecodedRecipe[] = recipePointers.map((pointer, recipeIndex) => {
    const packedIo = reader.sliceAt(pointer + 5, `recipe ${recipeIndex} I/O`);
    if (packedIo.length % 5 !== 0) {
      throw new PackDecodeError(`recipe ${recipeIndex} I/O: expected groups of 5, got ${packedIo.length} values`);
    }
    const inputs: DecodedRecipeIo[] = [];
    const outputs: DecodedRecipeIo[] = [];
    for (let index = 0; index < packedIo.length; index += 5) {
      const rawKind = packedIo[index];
      if (rawKind < 0 || rawKind >= ioKind.length) {
        throw new PackDecodeError(`recipe ${recipeIndex} I/O ${index / 5}: invalid kind ${rawKind}`);
      }
      const goodsPointer = packedIo[index + 1];
      const goodsId = rawKind === 1
        ? oreIdByPointer.get(goodsPointer)
        : rawKind === 2 || rawKind === 4
          ? fluidIdByPointer.get(goodsPointer)
          : itemIdByPointer.get(goodsPointer);
      if (!goodsId) {
        throw new PackDecodeError(`recipe ${recipeIndex} I/O ${index / 5}: unresolved goods pointer ${goodsPointer}`);
      }
      const io: DecodedRecipeIo = {
        kind: rawKind === 1
          ? ingredientGroupKindByPointer.get(goodsPointer) ?? 'oreDict'
          : ioKind[rawKind],
        goodsId,
        slot: packedIo[index + 2],
        amount: packedIo[index + 3],
        probability: packedIo[index + 4] / 100
      };
      (rawKind <= 2 ? inputs : outputs).push(io);
    }
    const recipeTypePointer = reader.pointer(pointer + 6, `recipe ${recipeIndex} type`)!;
    const recipeType = recipeTypeByPointer.get(recipeTypePointer);
    if (!recipeType) throw new PackDecodeError(`recipe ${recipeIndex}: unresolved recipe type pointer ${recipeTypePointer}`);
    const gtPointer = reader.pointer(pointer + 7, `recipe ${recipeIndex} GT info`, true);
    return {
      id: recipeIdByPointer.get(pointer)!,
      searchMask: [0, 1, 2, 3].map((word) => reader.uint(pointer + word, `recipe ${recipeIndex} search mask`)),
      recipeTypeId: recipeType.id,
      inputs,
      outputs,
      gt: gtPointer === null ? null : decodeGt(gtPointer, `recipe ${recipeIndex} GT info`)
    };
  });

  const serviceItemIds = servicePointers.map((pointer, index) => {
    const id = itemIdByPointer.get(pointer);
    if (!id) throw new PackDecodeError(`service item ${index}: pointer ${pointer} is not an item`);
    return id;
  });

  const obsoleteRecipeRemaps: Record<string, string> = {};
  for (const [index, pointer] of remapPointers.entries()) {
    const from = required(reader.stringAt(pointer, `recipe remap ${index} source`), `recipe remap ${index} source`);
    const targetPointer = reader.pointer(pointer + 1, `recipe remap ${index} target`)!;
    const target = recipeIdByPointer.get(targetPointer);
    if (!target) throw new PackDecodeError(`recipe remap ${index}: pointer ${targetPointer} is not a recipe`);
    obsoleteRecipeRemaps[from] = target;
  }

  return {
    formatVersion: FORMAT_VERSION,
    items,
    fluids,
    oreDictionaries,
    ingredientGroups: anonymousIngredientGroups,
    recipeTypes,
    recipes,
    serviceItemIds,
    obsoleteRecipeRemaps
  };
}
