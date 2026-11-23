import {
  specialCategory,
  type SpecialGoods,
  type SpecialRecord,
  type SpecialDrop,
} from '../special/specialData';
import {
  catalogNameForId,
  withCatalogName,
  namesForIds,
  type NamedCatalogObject,
} from './catalogNames';
type GoodsValue = string | SpecialGoods;
type GoodsGroup = GoodsValue | readonly GoodsValue[];

function namesForIdMap(
  values: Readonly<Record<string, unknown>> | undefined,
  names: ReadonlyMap<string, string>,
): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(Object.keys(values).map((id) => [id, catalogNameForId(id, names)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSpecialGoods(value: unknown): value is SpecialGoods {
  return isRecord(value) && typeof value.goodsId === 'string';
}

function decorateSpecialGoods<T extends SpecialGoods>(
  goods: T,
  names: ReadonlyMap<string, string>,
): NamedCatalogObject<T> & { alternativeNames?: string[]; oreDictionaryName?: string } {
  const decorated = withCatalogName(goods, goods.goodsId, names, goods.label);
  return {
    ...decorated,
    ...(goods.alternatives !== undefined
      ? { alternativeNames: namesForIds(goods.alternatives, names) }
      : {}),
    ...(goods.oreDictionaryId !== undefined
      ? { oreDictionaryName: catalogNameForId(goods.oreDictionaryId, names) }
      : {}),
  };
}

function decorateKnownGoodsValue(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => decorateKnownGoodsValue(child, names));
  }
  return isSpecialGoods(value) ? decorateSpecialGoods(value, names) : value;
}

function decorateKnownGoodsList(
  values: readonly unknown[] | undefined,
  names: ReadonlyMap<string, string>,
): unknown[] | undefined {
  return values?.map((value) => decorateKnownGoodsValue(value, names));
}

function namesForKnownGoodsValue(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return catalogNameForId(value, names);
  if (Array.isArray(value)) return value.map((child) => namesForKnownGoodsValue(child, names));
  if (isSpecialGoods(value)) {
    return catalogNameForId(value.goodsId, names, value.name ?? value.label);
  }
  return value;
}

function namesForKnownGoodsList(
  values: readonly unknown[] | undefined,
  names: ReadonlyMap<string, string>,
): unknown[] | undefined {
  return values?.map((value) => namesForKnownGoodsValue(value, names));
}

interface CropExportPayload {
  drops?: readonly SpecialDrop[];
  soils?: readonly GoodsValue[];
  underBlocks?: readonly GoodsValue[];
  blocksUnder?: readonly GoodsValue[];
  machineCatalysts?: readonly GoodsGroup[];
  parents?: readonly GoodsGroup[];
  outputSeed?: SpecialGoods;
  memberSeeds?: readonly SpecialGoods[];
}

function decorateCropPayload(
  value: CropExportPayload,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.drops ? { drops: decorateKnownGoodsList(value.drops, names) } : {}),
    ...(value.soils
      ? {
          soils: decorateKnownGoodsList(value.soils, names),
          soilsNames: namesForKnownGoodsList(value.soils, names),
        }
      : {}),
    ...(value.underBlocks
      ? {
          underBlocks: decorateKnownGoodsList(value.underBlocks, names),
          underBlocksNames: namesForKnownGoodsList(value.underBlocks, names),
        }
      : {}),
    ...(value.blocksUnder
      ? {
          blocksUnder: decorateKnownGoodsList(value.blocksUnder, names),
          blocksUnderNames: namesForKnownGoodsList(value.blocksUnder, names),
        }
      : {}),
    ...(value.machineCatalysts
      ? {
          machineCatalysts: decorateKnownGoodsList(value.machineCatalysts, names),
          machineCatalystsNames: namesForKnownGoodsList(value.machineCatalysts, names),
        }
      : {}),
    ...(value.parents
      ? {
          parents: decorateKnownGoodsList(value.parents, names),
          parentsNames: namesForKnownGoodsList(value.parents, names),
        }
      : {}),
    ...(value.outputSeed ? { outputSeed: decorateSpecialGoods(value.outputSeed, names) } : {}),
    ...(value.memberSeeds
      ? { memberSeeds: value.memberSeeds.map((seed) => decorateSpecialGoods(seed, names)) }
      : {}),
  };
}

interface VeinExportLayer {
  goodsIds?: readonly string[];
  oreGoodsId?: string;
  oreDictionaryId?: string;
  ores?: readonly SpecialGoods[];
}

interface VeinExportPayload {
  goodsId?: string;
  goodsIds?: readonly string[];
  layers?: readonly VeinExportLayer[];
  ores?: readonly SpecialGoods[];
  representativeOres?: readonly GoodsValue[];
  representativeDusts?: readonly GoodsValue[];
  potentialDrops?: readonly SpecialDrop[];
  dimensionGoodsIds?: Readonly<Record<string, string>>;
}

function decorateVeinLayer(
  value: VeinExportLayer,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsIds ? { goodsNames: namesForIds(value.goodsIds, names) } : {}),
    ...(value.oreGoodsId ? { oreGoodsName: catalogNameForId(value.oreGoodsId, names) } : {}),
    ...(value.oreDictionaryId
      ? { oreDictionaryName: catalogNameForId(value.oreDictionaryId, names) }
      : {}),
    ...(value.ores ? { ores: value.ores.map((ore) => decorateSpecialGoods(ore, names)) } : {}),
  };
}

function decorateVeinPayload(
  value: VeinExportPayload,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsId ? { goodsName: catalogNameForId(value.goodsId, names) } : {}),
    ...(value.goodsIds ? { goodsNames: namesForIds(value.goodsIds, names) } : {}),
    ...(value.layers
      ? { layers: value.layers.map((layer) => decorateVeinLayer(layer, names)) }
      : {}),
    ...(value.ores ? { ores: value.ores.map((ore) => decorateSpecialGoods(ore, names)) } : {}),
    ...(value.representativeOres
      ? {
          representativeOres: decorateKnownGoodsList(value.representativeOres, names),
          representativeOresNames: namesForKnownGoodsList(value.representativeOres, names),
        }
      : {}),
    ...(value.representativeDusts
      ? {
          representativeDusts: decorateKnownGoodsList(value.representativeDusts, names),
          representativeDustsNames: namesForKnownGoodsList(value.representativeDusts, names),
        }
      : {}),
    ...(value.potentialDrops
      ? { potentialDrops: value.potentialDrops.map((drop) => decorateSpecialGoods(drop, names)) }
      : {}),
    ...(value.dimensionGoodsIds
      ? {
          dimensionGoodsNames: namesForIdMap(value.dimensionGoodsIds, names),
        }
      : {}),
  };
}

interface MeteorExportPayload {
  focus?: SpecialGoods;
  focusGoodsId?: string;
  crystalGoodsId?: string;
  outputs?: readonly SpecialDrop[];
  ores?: readonly SpecialGoods[];
  filler?: readonly SpecialGoods[];
  reagents?: readonly SpecialGoods[];
  estimatedAmounts?: Readonly<Record<string, number>>;
}

function decorateMeteorPayload(
  value: MeteorExportPayload,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.focus ? { focus: decorateSpecialGoods(value.focus, names) } : {}),
    ...(value.focusGoodsId ? { focusGoodsName: catalogNameForId(value.focusGoodsId, names) } : {}),
    ...(value.crystalGoodsId
      ? { crystalGoodsName: catalogNameForId(value.crystalGoodsId, names) }
      : {}),
    ...(value.outputs
      ? { outputs: value.outputs.map((output) => decorateSpecialGoods(output, names)) }
      : {}),
    ...(value.ores ? { ores: value.ores.map((ore) => decorateSpecialGoods(ore, names)) } : {}),
    ...(value.filler
      ? { filler: value.filler.map((filler) => decorateSpecialGoods(filler, names)) }
      : {}),
    ...(value.reagents
      ? {
          reagents: decorateKnownGoodsList(value.reagents, names),
        }
      : {}),
    ...(value.estimatedAmounts
      ? { estimatedAmountNames: namesForIdMap(value.estimatedAmounts, names) }
      : {}),
  };
}

interface LootExportGroup {
  alternatives?: readonly SpecialDrop[];
  drops?: readonly SpecialDrop[];
}

interface LootExportPayload {
  bag?: SpecialGoods;
  bagGoodsId?: string;
  drops?: readonly SpecialDrop[];
  groups?: readonly LootExportGroup[];
  fortune?: Readonly<Record<string, unknown>>;
  limits?: Readonly<Record<string, unknown>>;
}

function decorateLootPayload(
  value: LootExportPayload,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.bag ? { bag: decorateSpecialGoods(value.bag, names) } : {}),
    ...(value.bagGoodsId ? { bagGoodsName: catalogNameForId(value.bagGoodsId, names) } : {}),
    ...(value.drops ? { drops: value.drops.map((drop) => decorateSpecialGoods(drop, names)) } : {}),
    ...(value.groups
      ? {
          groups: value.groups.map((group) => ({
            ...group,
            ...(group.alternatives
              ? {
                  alternatives: group.alternatives.map((drop) => decorateSpecialGoods(drop, names)),
                }
              : {}),
            ...(group.drops
              ? { drops: group.drops.map((drop) => decorateSpecialGoods(drop, names)) }
              : {}),
          })),
        }
      : {}),
    ...(value.fortune ? { fortuneNames: namesForIdMap(value.fortune, names) } : {}),
    ...(value.limits ? { limitNames: namesForIdMap(value.limits, names) } : {}),
  };
}

interface GoodsIdContainer {
  goodsIds?: readonly string[];
}

interface VendingExportPayload {
  machine?: SpecialGoods;
  currencies?: readonly SpecialGoods[];
  inputs?: readonly SpecialGoods[];
  outputs?: readonly SpecialGoods[];
  consumedInputs?: readonly string[];
  nonConsumedInputs?: readonly string[];
  displayItem?: GoodsIdContainer;
  fromCurrency?: readonly GoodsIdContainer[];
  fromItems?: readonly GoodsIdContainer[];
  nonConsumedItems?: readonly GoodsIdContainer[];
  toItems?: readonly GoodsIdContainer[];
}

function decorateGoodsIdContainer(
  value: GoodsIdContainer,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsIds ? { goodsNames: namesForIds(value.goodsIds, names) } : {}),
  };
}

function decorateVendingPayload(
  value: VendingExportPayload,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.machine ? { machine: decorateSpecialGoods(value.machine, names) } : {}),
    ...(value.currencies
      ? { currencies: value.currencies.map((currency) => decorateSpecialGoods(currency, names)) }
      : {}),
    ...(value.inputs
      ? { inputs: value.inputs.map((input) => decorateSpecialGoods(input, names)) }
      : {}),
    ...(value.outputs
      ? { outputs: value.outputs.map((output) => decorateSpecialGoods(output, names)) }
      : {}),
    ...(value.consumedInputs
      ? { consumedInputNames: namesForIds(value.consumedInputs, names) }
      : {}),
    ...(value.nonConsumedInputs
      ? { nonConsumedInputNames: namesForIds(value.nonConsumedInputs, names) }
      : {}),
    ...(value.displayItem
      ? { displayItem: decorateGoodsIdContainer(value.displayItem, names) }
      : {}),
    ...(value.fromCurrency
      ? { fromCurrency: value.fromCurrency.map((entry) => decorateGoodsIdContainer(entry, names)) }
      : {}),
    ...(value.fromItems
      ? { fromItems: value.fromItems.map((entry) => decorateGoodsIdContainer(entry, names)) }
      : {}),
    ...(value.nonConsumedItems
      ? {
          nonConsumedItems: value.nonConsumedItems.map((entry) =>
            decorateGoodsIdContainer(entry, names),
          ),
        }
      : {}),
    ...(value.toItems
      ? { toItems: value.toItems.map((entry) => decorateGoodsIdContainer(entry, names)) }
      : {}),
  };
}

interface WorldgenExportPayload {
  drops?: readonly SpecialDrop[];
  entries?: readonly SpecialDrop[];
  tables?: ReadonlyArray<{ items?: readonly SpecialDrop[] }>;
}

function decorateWorldgenPayload(
  value: WorldgenExportPayload,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.drops ? { drops: value.drops.map((drop) => decorateSpecialGoods(drop, names)) } : {}),
    ...(value.entries
      ? { entries: value.entries.map((entry) => decorateSpecialGoods(entry, names)) }
      : {}),
    ...(value.tables
      ? {
          tables: value.tables.map((table) => ({
            ...table,
            ...(table.items
              ? { items: table.items.map((item) => decorateSpecialGoods(item, names)) }
              : {}),
          })),
        }
      : {}),
  };
}

interface ProcessingStageExportValue {
  machineId?: string;
  inputs?: readonly SpecialGoods[];
  outputs?: readonly SpecialDrop[];
}

interface ProcessingNodeExportValue {
  id?: string;
  goodsId?: string;
  machineId?: string;
}

interface ProcessingEdgeExportValue {
  from?: string;
  to?: string;
}

interface OreProcessingExportPayload {
  source?: SpecialGoods;
  result?: SpecialGoods;
  stages?: readonly (string | ProcessingStageExportValue)[];
  nodes?: readonly ProcessingNodeExportValue[];
  edges?: readonly ProcessingEdgeExportValue[];
}

function decorateProcessingStage(
  value: ProcessingStageExportValue,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.machineId ? { machineName: catalogNameForId(value.machineId, names) } : {}),
    ...(value.inputs
      ? { inputs: value.inputs.map((input) => decorateSpecialGoods(input, names)) }
      : {}),
    ...(value.outputs
      ? { outputs: value.outputs.map((output) => decorateSpecialGoods(output, names)) }
      : {}),
  };
}

function decorateProcessingNode(
  value: ProcessingNodeExportValue,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsId
      ? { name: catalogNameForId(value.goodsId, names) }
      : value.id && names.has(value.id)
        ? { name: catalogNameForId(value.id, names) }
        : {}),
    ...(value.machineId ? { machineName: catalogNameForId(value.machineId, names) } : {}),
  };
}

function decorateProcessingEdge(
  value: ProcessingEdgeExportValue,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.from && names.has(value.from)
      ? { fromName: catalogNameForId(value.from, names) }
      : {}),
    ...(value.to && names.has(value.to) ? { toName: catalogNameForId(value.to, names) } : {}),
  };
}

function decorateOreProcessingPayload(
  value: OreProcessingExportPayload,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    ...value,
    ...(value.source ? { source: decorateSpecialGoods(value.source, names) } : {}),
    ...(value.result ? { result: decorateSpecialGoods(value.result, names) } : {}),
    ...(value.stages
      ? {
          stages: value.stages.map((stage) =>
            typeof stage === 'string' ? stage : decorateProcessingStage(stage, names),
          ),
        }
      : {}),
    ...(value.nodes
      ? { nodes: value.nodes.map((node) => decorateProcessingNode(node, names)) }
      : {}),
    ...(value.edges
      ? { edges: value.edges.map((edge) => decorateProcessingEdge(edge, names)) }
      : {}),
  };
}

function decorateSpecialPayload(
  category: string,
  payload: SpecialRecord['payload'],
  names: ReadonlyMap<string, string>,
): SpecialRecord['payload'] {
  switch (specialCategory(category)) {
    case 'crop':
    case 'cropPool':
    case 'cropBreeding':
      return decorateCropPayload(payload as CropExportPayload, names);
    case 'gtOreVein':
    case 'gtSmallOre':
      return decorateVeinPayload(payload as VeinExportPayload, names);
    case 'meteorRitual':
      return decorateMeteorPayload(payload as MeteorExportPayload, names);
    case 'lootBag':
      return decorateLootPayload(payload as LootExportPayload, names);
    case 'vending':
      return decorateVendingPayload(payload as VendingExportPayload, names);
    case 'worldgenLoot':
      return decorateWorldgenPayload(payload as WorldgenExportPayload, names);
    case 'oreProcessing':
      return decorateOreProcessingPayload(payload as OreProcessingExportPayload, names);
    default:
      return payload;
  }
}

export function decorateSpecialRecord(
  record: SpecialRecord,
  names: ReadonlyMap<string, string>,
): SpecialRecord {
  return {
    ...record,
    ...(record.goodsIds ? { goodsNames: namesForIds(record.goodsIds, names) } : {}),
    ...(record.productionGoodsIds
      ? { productionGoodsNames: namesForIds(record.productionGoodsIds, names) }
      : {}),
    ...(record.usageGoodsIds ? { usageGoodsNames: namesForIds(record.usageGoodsIds, names) } : {}),
    ...(record.inputs
      ? { inputs: record.inputs.map((input) => decorateSpecialGoods(input, names)) }
      : {}),
    ...(record.outputs
      ? { outputs: record.outputs.map((output) => decorateSpecialGoods(output, names)) }
      : {}),
    payload: decorateSpecialPayload(record.category, record.payload, names),
  };
}
