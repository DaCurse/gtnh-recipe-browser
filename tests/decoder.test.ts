import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFormat5, PackDecodeError } from '../tools/pack-builder/decoder';
import { fluidRecipeScope } from '../src/lib/fluidContainers';
import { productionFallbackDictionary } from '../src/lib/oreDictionary';

function words(...values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeInt32LE(value, index * 4));
  return buffer;
}

function repositoryWithNullableUnlocalizedName(): Buffer {
  const values = [5, 8, 10, 10, 10, 10, 10, 10, 1, 11, 0];
  const itemPointer = 11;
  values.push(...Array.from({ length: 18 }, () => 0));

  const pushString = (value: string): number => {
    const pointer = values.length;
    const bytes = Buffer.from(value, 'utf8');
    values.push(bytes.byteLength);
    const padded = Buffer.alloc(Math.ceil(bytes.byteLength / 4) * 4);
    bytes.copy(padded);
    for (let offset = 0; offset < padded.byteLength; offset += 4) {
      values.push(padded.readInt32LE(offset));
    }
    return pointer;
  };

  values[itemPointer + 4] = pushString('i:test:nullable:0');
  values[itemPointer + 5] = pushString('Nullable Name');
  values[itemPointer + 6] = pushString('test');
  values[itemPointer + 7] = pushString('nullable');
  values[itemPointer + 8] = 1;
  values[itemPointer + 9] = 0;
  values[itemPointer + 10] = -1;
  values[itemPointer + 11] = -1;
  values[itemPointer + 12] = -1;
  values[itemPointer + 13] = 10;
  values[itemPointer + 14] = 10;
  values[itemPointer + 15] = 64;
  values[itemPointer + 16] = 0;
  values[itemPointer + 17] = -1;
  return gzipSync(words(...values));
}

describe('format-v5 decoder rejection', () => {
  it('rejects input which is not gzip data', () => {
    expect(() => decodeFormat5(Buffer.from('not gzip'))).toThrow(/decompress/i);
  });

  it('rejects unsupported versions before following pointers', () => {
    expect(() => decodeFormat5(gzipSync(words(4, 0, 0, 0, 0, 0, 0, 0)))).toThrow(
      new PackDecodeError('Unsupported data format 4; required 5')
    );
  });

  it('rejects truncated root data', () => {
    expect(() => decodeFormat5(gzipSync(words(5)))).toThrow(/truncated/i);
  });

  it('rejects invalid root pointers', () => {
    expect(() => decodeFormat5(gzipSync(words(5, 99, 99, 99, 99, 99, 99, 99)))).toThrow(/invalid pointer/i);
  });

  it('normalizes a null optional unlocalized name to an empty string', () => {
    const repository = decodeFormat5(repositoryWithNullableUnlocalizedName());
    expect(repository.items).toHaveLength(1);
    expect(repository.items[0]?.unlocalizedName).toBe('');
  });
});

const realDataPath = 'tests/fixtures/shadowtheage-v5-2.8.0/data.bin';
const realAtlasPath = 'tests/fixtures/shadowtheage-v5-2.8.0/atlas.webp';
describe.skipIf(!existsSync(realDataPath))('pinned real format-v5 dataset', () => {
  const repository = decodeFormat5(readFileSync(realDataPath));

  it('decodes the pinned 2.8.0-v5 repository completely', () => {
    expect(repository.formatVersion).toBe(5);
    expect(repository.items.filter((item) => item.searchable)).toHaveLength(41_091);
    expect(repository.fluids).toHaveLength(1_542);
    expect(repository.oreDictionaries).toHaveLength(625);
    expect(repository.recipeTypes).toHaveLength(154);
    expect(repository.recipes).toHaveLength(190_080);
    expect(Object.keys(repository.obsoleteRecipeRemaps)).toHaveLength(7_183);
  });

  it('matches the recorded immutable source hashes', () => {
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    expect(digest(realDataPath)).toBe('b0ff8d63f3104e979628c64e650cab17bf0b442e01bdb00c1d8f54c458a3eccc');
    expect(digest(realAtlasPath)).toBe('fa05550ce9657ce49d4512b4aab7fe76d684b70745b0bc7b744c9ae0d6eb6ef5');
  });

  it('preserves the actual shaped and shapeless crafting dimensions', () => {
    const shaped = repository.recipeTypes.find((type) => type.name === 'Crafting (Shaped)');
    const shapeless = repository.recipeTypes.find((type) => type.name === 'Crafting (Shapeless)');
    expect(shaped?.dimensions.itemInputs).toEqual({ columns: 3, rows: 3 });
    expect(shaped?.shapeless).toBe(false);
    expect(shapeless?.dimensions.itemInputs).toEqual({ columns: 3, rows: 3 });
    expect(shapeless?.shapeless).toBe(true);
  });

  it('retains non-searchable crafter goods needed by recipe tabs', () => {
    const hidden = repository.items.filter((item) => !item.searchable);
    expect(hidden.length).toBeGreaterThan(0);
    expect(repository.recipeTypes.some((type) => type.defaultCrafter && hidden.some((item) => item.id === type.defaultCrafter?.id))).toBe(true);
  });

  it('preserves Creosote Oil semi-fluid fuel metadata', () => {
    const creosote = repository.fluids.find((fluid) => fluid.name === 'Creosote Oil');
    const semiFluidType = repository.recipeTypes.find((type) => type.name === 'Semifluid Generator Fuels');
    const fuelRecipe = repository.recipes.find((recipe) =>
      recipe.recipeTypeId === semiFluidType?.id &&
      recipe.inputs.some((input) => input.goodsId === creosote?.id));
    expect(fuelRecipe?.gt?.metadata).toContainEqual({ key: 'fuel_value', value: 48 });
  });

  it('preserves fluid containers and their shared recipe directions', () => {
    const creosote = repository.fluids.find((fluid) => fluid.id === 'f:Railcraft:creosote')!;
    const cell = repository.items.find(
      (item) => item.id === 'i:Railcraft:fluid.creosote.cell:0'
    )!;
    const emptyCellId = 'i:IC2:itemCellEmpty:0';
    const goods = new Map(
      [...repository.items, ...repository.fluids].map((entry) => [entry.id, entry])
    );
    const fluidScope = fluidRecipeScope(creosote.id, goods)!;
    const containerScope = fluidRecipeScope(cell.id, goods)!;

    expect(cell.container).toEqual({
      fluidId: creosote.id,
      amount: 1_000,
      emptyItemId: emptyCellId
    });
    expect(containerScope.memberIds).toEqual(fluidScope.memberIds);
    expect(fluidScope.memberIds.has(emptyCellId)).toBe(false);

    const members = [...fluidScope.memberIds].map((id) => goods.get(id)!);
    const production = new Set(members.flatMap((entry) => entry.productionRecipeIds));
    const usages = new Set(members.flatMap((entry) => entry.usageRecipeIds));
    expect(production.size).toBe(463);
    expect(usages.size).toBe(167);
    expect(production.size).toBeGreaterThan(creosote.productionRecipeIds.length);
    expect(usages.size).toBeGreaterThan(creosote.usageRecipeIds.length);
  });

  it('retains ore-dictionary members and indexes their interchangeable usages', () => {
    const dustIron = repository.oreDictionaries.find((ore) => ore.id === 'o:dustIron');
    const oreRecipe = repository.recipes.find((recipe) =>
      recipe.inputs.some((input) => input.kind === 'oreDict' && input.goodsId === dustIron?.id));
    expect(dustIron?.itemIds.length).toBeGreaterThan(1);
    expect(oreRecipe).toBeDefined();
    for (const memberId of dustIron!.itemIds) {
      expect(repository.items.find((item) => item.id === memberId)?.usageRecipeIds).toContain(oreRecipe!.id);
    }
  });

  it('preserves the Ichorium ore alias needed to recover indirect production', () => {
    const thaumicIchorium = repository.items.find(
      (item) => item.id === 'i:ThaumicTinkerer:kamiResource:2'
    );
    const gregTechIchorium = repository.items.find(
      (item) => item.id === 'i:gregtech:gt.metaitem.01:11978'
    );
    const dictionary = repository.oreDictionaries.find((ore) => ore.id === 'o:ingotIchorium');

    expect(thaumicIchorium?.productionRecipeIds).toHaveLength(0);
    expect(dictionary?.itemIds).toEqual(expect.arrayContaining([
      thaumicIchorium!.id,
      gregTechIchorium!.id
    ]));
    expect(gregTechIchorium?.productionRecipeIds.length).toBeGreaterThan(0);

    const fallback = productionFallbackDictionary(
      thaumicIchorium!.id,
      repository.oreDictionaries,
      (itemId) =>
        (repository.items.find((item) => item.id === itemId)?.productionRecipeIds.length ?? 0) > 0
    );
    const recoveredRecipes = new Set(fallback?.itemIds.flatMap((itemId) =>
      repository.items.find((item) => item.id === itemId)?.productionRecipeIds ?? []));
    expect(fallback?.id).toBe('o:ingotIchorium');
    expect(recoveredRecipes.size).toBe(35);
  });
});
