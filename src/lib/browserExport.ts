import { buildRecipeSearchDocument, recipeSearchTerms, toRecipeSearchCatalogEntry, toRecipeSearchRecord } from './recipeSearch';
import {
  specialCategory,
  specialSearchText,
  type SpecialDrop,
  type SpecialGoods,
  type SpecialRecord
} from './specialData';
import type { CatalogEntry, Ingredient, Recipe, RecipeView } from './types';

const BROWSER_EXPORT_SCHEMA_VERSION = 1 as const;

type BrowserExportKind = 'recipes' | 'special';
type BrowserExportScope = 'pane' | 'machine' | 'special-global';

interface BrowserExportDataset {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
}

interface BrowserExportSelection {
  id: string;
  name: string;
  kind: CatalogEntry['kind'];
}

interface BrowserExportFilter {
  query: string;
  applied: boolean;
}

interface BrowserExportSpecialViewType {
  id: string;
  label: string;
}

export interface BrowserExportEnvelope<TRecord extends Recipe | SpecialRecord = Recipe | SpecialRecord> {
  schemaVersion: typeof BROWSER_EXPORT_SCHEMA_VERSION;
  kind: BrowserExportKind;
  dataset: BrowserExportDataset;
  selection: BrowserExportSelection;
  view: RecipeView;
  scope: BrowserExportScope;
  recipeType: string | null;
  specialViewType: BrowserExportSpecialViewType | null;
  filter: BrowserExportFilter;
  records: TRecord[];
}

export interface BrowserExportRepository {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  entries: readonly CatalogEntry[];
}

interface BrowserExportBaseOptions {
  repository: BrowserExportRepository;
  selected: BrowserExportSelection | CatalogEntry;
  view: RecipeView;
  scope: BrowserExportScope;
  recipeType?: string | null;
  specialViewType?: BrowserExportSpecialViewType | null;
  query?: string;
  applied?: boolean;
}

export interface RecipeExportOptions extends BrowserExportBaseOptions {
  kind?: 'recipes';
  records: readonly Recipe[];
}

export interface SpecialExportOptions extends BrowserExportBaseOptions {
  kind?: 'special';
  records: readonly SpecialRecord[];
}

function compareStableOrder(
  left: { id: string; order?: number },
  right: { id: string; order?: number }
): number {
  return (left.order ?? 0) - (right.order ?? 0)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function ordered<T extends { id: string; order?: number }>(records: readonly T[]): T[] {
  return [...records].sort(compareStableOrder);
}

function selectionOf(selected: BrowserExportSelection | CatalogEntry): BrowserExportSelection {
  return {
    id: selected.id,
    name: selected.name,
    kind: selected.kind
  };
}

function filterOf(query: string | undefined, applied: boolean | undefined): BrowserExportFilter {
  const normalizedQuery = query ?? '';
  return {
    query: normalizedQuery,
    applied: applied ?? normalizedQuery.trim().length > 0
  };
}

function datasetOf(repository: BrowserExportRepository): BrowserExportDataset {
  return {
    datasetId: repository.datasetId,
    gtnhVersion: repository.gtnhVersion,
    revision: repository.revision
  };
}

function catalogNames(repository: BrowserExportRepository): ReadonlyMap<string, string> {
  return new Map(
    repository.entries
      .filter((entry) => entry.name.trim().length > 0)
      .map((entry) => [entry.id, entry.name])
  );
}

/**
 * A catalog reference is represented by its stable ID and its resolved name.
 * The exporter uses this helper only at fields whose domain is a catalog
 * reference; it deliberately does not infer references from property names.
 */
type NamedCatalogObject<T extends object> = T & { name: string };
type GoodsValue = string | SpecialGoods;
type GoodsGroup = GoodsValue | readonly GoodsValue[];

function catalogNameForId(
  id: string,
  names: ReadonlyMap<string, string>,
  fallback?: string
): string {
  return names.get(id) ?? fallback ?? id;
}

function withCatalogName<T extends object>(
  value: T,
  id: string,
  names: ReadonlyMap<string, string>,
  fallback?: string
): NamedCatalogObject<T> {
  const existingName = (value as { name?: unknown }).name;
  return {
    ...value,
    name: catalogNameForId(
      id,
      names,
      typeof existingName === 'string' ? existingName : fallback
    )
  };
}

function namesForIds(
  ids: readonly string[] | undefined,
  names: ReadonlyMap<string, string>
): string[] | undefined {
  return ids?.map((id) => catalogNameForId(id, names));
}

function namesForIdMap(
  values: Readonly<Record<string, unknown>> | undefined,
  names: ReadonlyMap<string, string>
): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.keys(values).map((id) => [id, catalogNameForId(id, names)])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSpecialGoods(value: unknown): value is SpecialGoods {
  return isRecord(value) && typeof value.goodsId === 'string';
}

function decorateSpecialGoods<T extends SpecialGoods>(
  goods: T,
  names: ReadonlyMap<string, string>
): NamedCatalogObject<T> & { alternativeNames?: string[]; oreDictionaryName?: string } {
  const decorated = withCatalogName(goods, goods.goodsId, names, goods.label);
  return {
    ...decorated,
    ...(goods.alternatives !== undefined
      ? { alternativeNames: namesForIds(goods.alternatives, names) }
      : {}),
    ...(goods.oreDictionaryId !== undefined
      ? { oreDictionaryName: catalogNameForId(goods.oreDictionaryId, names) }
      : {})
  };
}

function decorateKnownGoodsValue(
  value: unknown,
  names: ReadonlyMap<string, string>
): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => decorateKnownGoodsValue(child, names));
  }
  return isSpecialGoods(value) ? decorateSpecialGoods(value, names) : value;
}

function decorateKnownGoodsList(
  values: readonly unknown[] | undefined,
  names: ReadonlyMap<string, string>
): unknown[] | undefined {
  return values?.map((value) => decorateKnownGoodsValue(value, names));
}

function namesForKnownGoodsValue(
  value: unknown,
  names: ReadonlyMap<string, string>
): unknown {
  if (typeof value === 'string') return catalogNameForId(value, names);
  if (Array.isArray(value)) return value.map((child) => namesForKnownGoodsValue(child, names));
  if (isSpecialGoods(value)) {
    return catalogNameForId(value.goodsId, names, value.name ?? value.label);
  }
  return value;
}

function namesForKnownGoodsList(
  values: readonly unknown[] | undefined,
  names: ReadonlyMap<string, string>
): unknown[] | undefined {
  return values?.map((value) => namesForKnownGoodsValue(value, names));
}

function decorateIngredient(
  ingredient: Ingredient,
  names: ReadonlyMap<string, string>
): Ingredient {
  return {
    ...withCatalogName(ingredient, ingredient.id, names),
    ...(ingredient.ingredientGroupId
      ? { ingredientGroupName: catalogNameForId(ingredient.ingredientGroupId, names) }
      : {}),
    ...(ingredient.alternatives !== undefined
      ? { alternativeNames: namesForIds(ingredient.alternatives, names) }
      : {})
  };
}

function decorateRecipe(recipe: Recipe, names: ReadonlyMap<string, string>): Recipe {
  return {
    ...recipe,
    inputs: recipe.inputs.map((ingredient) => decorateIngredient(ingredient, names)),
    outputs: recipe.outputs.map((ingredient) => decorateIngredient(ingredient, names)),
    ...(recipe.crafterId !== undefined
      ? { crafterName: catalogNameForId(recipe.crafterId, names) }
      : {}),
    ...(recipe.crafters !== undefined
      ? { crafters: recipe.crafters.map((crafter) => withCatalogName(crafter, crafter.id, names)) }
      : {}),
    ...(recipe.typeIconId !== undefined
      ? { typeIconName: catalogNameForId(recipe.typeIconId, names) }
      : {})
  };
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
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.drops ? { drops: decorateKnownGoodsList(value.drops, names) } : {}),
    ...(value.soils
      ? {
        soils: decorateKnownGoodsList(value.soils, names),
        soilsNames: namesForKnownGoodsList(value.soils, names)
      }
      : {}),
    ...(value.underBlocks
      ? {
        underBlocks: decorateKnownGoodsList(value.underBlocks, names),
        underBlocksNames: namesForKnownGoodsList(value.underBlocks, names)
      }
      : {}),
    ...(value.blocksUnder
      ? {
        blocksUnder: decorateKnownGoodsList(value.blocksUnder, names),
        blocksUnderNames: namesForKnownGoodsList(value.blocksUnder, names)
      }
      : {}),
    ...(value.machineCatalysts
      ? {
        machineCatalysts: decorateKnownGoodsList(value.machineCatalysts, names),
        machineCatalystsNames: namesForKnownGoodsList(value.machineCatalysts, names)
      }
      : {}),
    ...(value.parents
      ? {
        parents: decorateKnownGoodsList(value.parents, names),
        parentsNames: namesForKnownGoodsList(value.parents, names)
      }
      : {}),
    ...(value.outputSeed
      ? { outputSeed: decorateSpecialGoods(value.outputSeed, names) }
      : {}),
    ...(value.memberSeeds
      ? { memberSeeds: value.memberSeeds.map((seed) => decorateSpecialGoods(seed, names)) }
      : {})
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
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsIds ? { goodsNames: namesForIds(value.goodsIds, names) } : {}),
    ...(value.oreGoodsId
      ? { oreGoodsName: catalogNameForId(value.oreGoodsId, names) }
      : {}),
    ...(value.oreDictionaryId
      ? { oreDictionaryName: catalogNameForId(value.oreDictionaryId, names) }
      : {}),
    ...(value.ores ? { ores: value.ores.map((ore) => decorateSpecialGoods(ore, names)) } : {})
  };
}

function decorateVeinPayload(
  value: VeinExportPayload,
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsId
      ? { goodsName: catalogNameForId(value.goodsId, names) }
      : {}),
    ...(value.goodsIds ? { goodsNames: namesForIds(value.goodsIds, names) } : {}),
    ...(value.layers
      ? { layers: value.layers.map((layer) => decorateVeinLayer(layer, names)) }
      : {}),
    ...(value.ores
      ? { ores: value.ores.map((ore) => decorateSpecialGoods(ore, names)) }
      : {}),
    ...(value.representativeOres
      ? {
        representativeOres: decorateKnownGoodsList(value.representativeOres, names),
        representativeOresNames: namesForKnownGoodsList(value.representativeOres, names)
      }
      : {}),
    ...(value.representativeDusts
      ? {
        representativeDusts: decorateKnownGoodsList(value.representativeDusts, names),
        representativeDustsNames: namesForKnownGoodsList(value.representativeDusts, names)
      }
      : {}),
    ...(value.potentialDrops
      ? { potentialDrops: value.potentialDrops.map((drop) => decorateSpecialGoods(drop, names)) }
      : {}),
    ...(value.dimensionGoodsIds
      ? {
        dimensionGoodsNames: namesForIdMap(value.dimensionGoodsIds, names)
      }
      : {})
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
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.focus ? { focus: decorateSpecialGoods(value.focus, names) } : {}),
    ...(value.focusGoodsId
      ? { focusGoodsName: catalogNameForId(value.focusGoodsId, names) }
      : {}),
    ...(value.crystalGoodsId
      ? { crystalGoodsName: catalogNameForId(value.crystalGoodsId, names) }
      : {}),
    ...(value.outputs
      ? { outputs: value.outputs.map((output) => decorateSpecialGoods(output, names)) }
      : {}),
    ...(value.ores
      ? { ores: value.ores.map((ore) => decorateSpecialGoods(ore, names)) }
      : {}),
    ...(value.filler
      ? { filler: value.filler.map((filler) => decorateSpecialGoods(filler, names)) }
      : {}),
    ...(value.reagents
      ? {
        reagents: decorateKnownGoodsList(value.reagents, names)
      }
      : {}),
    ...(value.estimatedAmounts
      ? { estimatedAmountNames: namesForIdMap(value.estimatedAmounts, names) }
      : {})
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
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.bag ? { bag: decorateSpecialGoods(value.bag, names) } : {}),
    ...(value.bagGoodsId
      ? { bagGoodsName: catalogNameForId(value.bagGoodsId, names) }
      : {}),
    ...(value.drops
      ? { drops: value.drops.map((drop) => decorateSpecialGoods(drop, names)) }
      : {}),
    ...(value.groups
      ? {
        groups: value.groups.map((group) => ({
          ...group,
          ...(group.alternatives
            ? { alternatives: group.alternatives.map((drop) => decorateSpecialGoods(drop, names)) }
            : {}),
          ...(group.drops
            ? { drops: group.drops.map((drop) => decorateSpecialGoods(drop, names)) }
            : {})
        }))
      }
      : {}),
    ...(value.fortune ? { fortuneNames: namesForIdMap(value.fortune, names) } : {}),
    ...(value.limits ? { limitNames: namesForIdMap(value.limits, names) } : {})
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
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsIds ? { goodsNames: namesForIds(value.goodsIds, names) } : {})
  };
}

function decorateVendingPayload(
  value: VendingExportPayload,
  names: ReadonlyMap<string, string>
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
        nonConsumedItems: value.nonConsumedItems.map((entry) => decorateGoodsIdContainer(entry, names))
      }
      : {}),
    ...(value.toItems
      ? { toItems: value.toItems.map((entry) => decorateGoodsIdContainer(entry, names)) }
      : {})
  };
}

interface WorldgenExportPayload {
  drops?: readonly SpecialDrop[];
  entries?: readonly SpecialDrop[];
  tables?: ReadonlyArray<{ items?: readonly SpecialDrop[] }>;
}

function decorateWorldgenPayload(
  value: WorldgenExportPayload,
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.drops
      ? { drops: value.drops.map((drop) => decorateSpecialGoods(drop, names)) }
      : {}),
    ...(value.entries
      ? { entries: value.entries.map((entry) => decorateSpecialGoods(entry, names)) }
      : {}),
    ...(value.tables
      ? {
        tables: value.tables.map((table) => ({
          ...table,
          ...(table.items
            ? { items: table.items.map((item) => decorateSpecialGoods(item, names)) }
            : {})
        }))
      }
      : {})
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
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.machineId
      ? { machineName: catalogNameForId(value.machineId, names) }
      : {}),
    ...(value.inputs
      ? { inputs: value.inputs.map((input) => decorateSpecialGoods(input, names)) }
      : {}),
    ...(value.outputs
      ? { outputs: value.outputs.map((output) => decorateSpecialGoods(output, names)) }
      : {})
  };
}

function decorateProcessingNode(
  value: ProcessingNodeExportValue,
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.goodsId
      ? { name: catalogNameForId(value.goodsId, names) }
      : value.id && names.has(value.id)
        ? { name: catalogNameForId(value.id, names) }
        : {}),
    ...(value.machineId
      ? { machineName: catalogNameForId(value.machineId, names) }
      : {})
  };
}

function decorateProcessingEdge(
  value: ProcessingEdgeExportValue,
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.from && names.has(value.from)
      ? { fromName: catalogNameForId(value.from, names) }
      : {}),
    ...(value.to && names.has(value.to)
      ? { toName: catalogNameForId(value.to, names) }
      : {})
  };
}

function decorateOreProcessingPayload(
  value: OreProcessingExportPayload,
  names: ReadonlyMap<string, string>
): Record<string, unknown> {
  return {
    ...value,
    ...(value.source ? { source: decorateSpecialGoods(value.source, names) } : {}),
    ...(value.result ? { result: decorateSpecialGoods(value.result, names) } : {}),
    ...(value.stages
      ? {
        stages: value.stages.map((stage) => typeof stage === 'string'
          ? stage
          : decorateProcessingStage(stage, names))
      }
      : {}),
    ...(value.nodes
      ? { nodes: value.nodes.map((node) => decorateProcessingNode(node, names)) }
      : {}),
    ...(value.edges
      ? { edges: value.edges.map((edge) => decorateProcessingEdge(edge, names)) }
      : {})
  };
}

function decorateSpecialPayload(
  category: string,
  payload: SpecialRecord['payload'],
  names: ReadonlyMap<string, string>
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

function decorateSpecialRecord(record: SpecialRecord, names: ReadonlyMap<string, string>): SpecialRecord {
  return {
    ...record,
    ...(record.goodsIds ? { goodsNames: namesForIds(record.goodsIds, names) } : {}),
    ...(record.productionGoodsIds
      ? { productionGoodsNames: namesForIds(record.productionGoodsIds, names) }
      : {}),
    ...(record.usageGoodsIds
      ? { usageGoodsNames: namesForIds(record.usageGoodsIds, names) }
      : {}),
    ...(record.inputs
      ? { inputs: record.inputs.map((input) => decorateSpecialGoods(input, names)) }
      : {}),
    ...(record.outputs
      ? { outputs: record.outputs.map((output) => decorateSpecialGoods(output, names)) }
      : {}),
    payload: decorateSpecialPayload(record.category, record.payload, names)
  };
}

export function createRecipeExport(
  options: RecipeExportOptions
): BrowserExportEnvelope<Recipe> {
  const names = catalogNames(options.repository);
  return {
    schemaVersion: BROWSER_EXPORT_SCHEMA_VERSION,
    kind: 'recipes',
    dataset: datasetOf(options.repository),
    selection: selectionOf(options.selected),
    view: options.view,
    scope: options.scope,
    recipeType: options.recipeType ?? null,
    specialViewType: null,
    filter: filterOf(options.query, options.applied),
    records: ordered(options.records).map((recipe) => decorateRecipe(recipe, names))
  };
}

export function createSpecialExport(
  options: SpecialExportOptions
): BrowserExportEnvelope<SpecialRecord> {
  const names = catalogNames(options.repository);
  return {
    schemaVersion: BROWSER_EXPORT_SCHEMA_VERSION,
    kind: 'special',
    dataset: datasetOf(options.repository),
    selection: selectionOf(options.selected),
    view: options.view,
    scope: options.scope,
    recipeType: null,
    specialViewType: options.specialViewType ?? null,
    filter: filterOf(options.query, options.applied),
    records: ordered(options.records).map((record) => decorateSpecialRecord(record, names))
  };
}

function recipeSearchDocuments(
  repository: BrowserExportRepository,
  records: readonly Recipe[]
) {
  const catalog = new Map(
    repository.entries.map((entry) => [entry.id, toRecipeSearchCatalogEntry(entry)])
  );
  return new Map(records.map((recipe) => [
    recipe.id,
    buildRecipeSearchDocument(toRecipeSearchRecord(recipe), catalog)
  ]));
}

/** Select complete or filtered materialized recipe records for a download. */
export function recipeRecordsForExport(
  repository: BrowserExportRepository,
  records: readonly Recipe[],
  recipeType: string | null,
  query: string,
  applied: boolean
): Recipe[] {
  const source = ordered(records);
  if (!applied) return source;
  const terms = recipeSearchTerms(query);
  const documents = recipeSearchDocuments(repository, source);
  return source.filter((recipe) => {
    if (recipeType !== null && recipe.type !== recipeType) return false;
    const document = documents.get(recipe.id);
    return document !== undefined && terms.every((term) => document.haystack.includes(term));
  });
}

/** Select complete or filtered materialized special records for a download. */
export function specialRecordsForExport(
  records: readonly SpecialRecord[],
  query: string,
  applied: boolean
): SpecialRecord[] {
  const source = ordered(records);
  if (!applied) return source;
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return source.filter((record) => {
    const text = specialSearchText(record);
    return terms.every((term) => text.includes(term));
  });
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value === null || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, stableJsonValue(object[key])])
  );
}

/** Serialize an export with deterministic object-key and record ordering. */
export function serializeBrowserExport(
  value: BrowserExportEnvelope
): string {
  return `${JSON.stringify(stableJsonValue(value), null, 2)}\n`;
}

function sanitizeExportFilename(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || 'export';
}

const RECIPE_VIEW_FILENAME: Record<RecipeView, string> = {
  recipes: 'recipes',
  usages: 'usages',
  machineUsages: 'machine-usages'
};

export function browserExportFilename(
  value: BrowserExportEnvelope
): string {
  if (value.scope === 'special-global') {
    const view = sanitizeExportFilename(value.specialViewType?.id ?? 'special');
    return `gtnh-special-global-${view}.json`;
  }
  const selection = sanitizeExportFilename(value.selection.name || value.selection.id);
  const recipeSubject = value.kind === 'recipes' && value.recipeType
    ? sanitizeExportFilename(value.recipeType)
    : selection;
  const view = value.kind === 'special'
    ? sanitizeExportFilename(value.specialViewType?.id ?? 'special')
    : RECIPE_VIEW_FILENAME[value.view];
  return `gtnh-${recipeSubject}-${view}.json`;
}

/** Download through a short-lived JSON Blob so packed shard bytes never leak into the export. */
export function downloadBrowserExport(
  value: BrowserExportEnvelope,
  filename = browserExportFilename(value)
): string {
  const blob = new Blob([serializeBrowserExport(value)], {
    type: 'application/json;charset=utf-8'
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = sanitizeExportFilename(filename.replace(/\.json$/i, '')) + '.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return anchor.download;
}
