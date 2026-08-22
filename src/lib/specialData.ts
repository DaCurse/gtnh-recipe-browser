import type { CatalogEntry, RecipeView } from './types';

/**
 * The browser-facing contract for NEI's non-recipe pages.
 *
 * The exporter is allowed to evolve its packed representation independently
 * of the UI.  DatasetRepository exposes these already materialized records
 * through the optional SpecialRepository interface below; old format-1--3
 * repositories simply do not implement it and therefore render no special
 * tabs.
 */

const SPECIAL_CATEGORY_ORDER = [
  'crop',
  'cropPool',
  'cropBreeding',
  'gtOreVein',
  'gtSmallOre',
  'meteorRitual',
  'lootBag',
  'vending',
  'worldgenLoot',
  'oreProcessing'
] as const;

export type SpecialCategory = typeof SPECIAL_CATEGORY_ORDER[number];

export interface SpecialViewType {
  id: string;
  label: string;
  shortLabel?: string;
  category?: SpecialCategory | string;
  iconId?: string;
  serviceIconId?: string;
  recordCount?: number;
  glyph?: string;
  order?: number;
}

interface SpecialServiceIcon {
  id: string;
  label: string;
  goodsId?: string;
  searchable: false;
  icon?: CatalogEntry['icon'] | null;
}

export interface SpecialGoods {
  goodsId: string;
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  chance?: number;
  weight?: number;
  limit?: number;
  /** A human-readable label for empty/service or unresolved references. */
  label?: string;
  role?: 'input' | 'output' | 'reagent' | 'currency' | 'filler' | 'tool' | string;
  alternatives?: string[];
  oreDictionaryId?: string;
}

export interface SpecialDrop extends SpecialGoods {
  minAmount?: number;
  maxAmount?: number;
  weight?: number;
  fortune?: [number, number, number, number];
  limit?: number;
  estimatedAmount?: number;
  groupId?: string;
  groupLabel?: string;
}

export interface CropSpecialPayload {
  cropName?: string;
  tier?: number;
  duration?: number;
  multiplier?: number;
  biomes?: string[];
  soils?: string[];
  underBlocks?: string[];
  requirements?: string[];
  drops?: SpecialDrop[];
  poolId?: string;
  poolLabel?: string;
  parents?: string[];
  parentCount?: 2 | 4 | number;
  machineOnly?: boolean;
}

export interface VeinSpecialPayload {
  veinName?: string;
  layers?: Array<{
    name?: string;
    minHeight?: number;
    maxHeight?: number;
    weight?: number;
    ores?: SpecialGoods[];
  }>;
  minHeight?: number;
  maxHeight?: number;
  weight?: number;
  dimensions?: Array<string | number>;
  dimensionChance?: Record<string, number>;
  ores?: SpecialGoods[];
  overrides?: string[];
  potentialDrops?: SpecialDrop[];
}

export interface MeteorSpecialPayload {
  focus?: SpecialGoods;
  lpCost?: number;
  radius?: number;
  ritual?: string;
  crystal?: string;
  fillerRatio?: number;
  outputs?: SpecialDrop[];
  estimatedAmounts?: Record<string, number>;
  reagents?: Array<SpecialGoods & { effect?: string }>;
  requirements?: string[];
}

export interface LootBagSpecialPayload {
  bag?: SpecialGoods;
  groupId?: string;
  groups?: Array<{
    id?: string;
    label?: string;
    weight?: number;
    inherited?: boolean;
    alternatives?: SpecialDrop[];
    drops?: SpecialDrop[];
    limit?: number;
  }>;
  drops?: SpecialDrop[];
  fortune?: Record<string, number[]>;
  limits?: Record<string, number>;
  trashGroup?: string;
}

export interface VendingSpecialPayload {
  machine?: SpecialGoods;
  currencies?: SpecialGoods[];
  inputs?: SpecialGoods[];
  outputs?: SpecialGoods[];
  requirements?: string[];
  consumedInputs?: string[];
  nonConsumedInputs?: string[];
  staticRequirement?: string;
}

export interface WorldgenSpecialPayload {
  source?: 'forge' | 'roguelike' | 'twilightForest' | string;
  table?: string;
  dimensions?: Array<string | number>;
  drops?: SpecialDrop[];
  minAmount?: number;
  maxAmount?: number;
  weight?: number;
  chance?: number;
}

export interface OreProcessingStage {
  id: string;
  machine: string;
  machineId?: string;
  rank?: number;
  inputs?: SpecialGoods[];
  outputs?: SpecialDrop[];
  branches?: string[];
  kind?: 'normal' | 'chemicalBath' | 'sifter' | string;
  probability?: number;
}

export interface OreProcessingSpecialPayload {
  source?: SpecialGoods;
  result?: SpecialGoods;
  stages: OreProcessingStage[];
  nodes?: SpecialProcessingNode[];
  edges?: SpecialProcessingEdge[];
}

export interface SpecialProcessingNode {
  id: string;
  label: string;
  kind?: 'source' | 'machine' | 'result' | 'probability' | 'reagent' | string;
  goodsId?: string;
  machineId?: string;
  rank?: number;
  width?: number;
  height?: number;
  branch?: string;
}

export interface SpecialProcessingEdge {
  from: string;
  to: string;
  chance?: number;
  label?: string;
  branch?: string;
}

type SpecialPayload = CropSpecialPayload
  | VeinSpecialPayload
  | MeteorSpecialPayload
  | LootBagSpecialPayload
  | VendingSpecialPayload
  | WorldgenSpecialPayload
  | OreProcessingSpecialPayload;

export interface SpecialRecord {
  id: string;
  category: SpecialCategory | string;
  title: string;
  subtitle?: string;
  searchText?: string;
  lookupId?: string;
  recipesLookupId?: string;
  usagesLookupId?: string;
  serviceIconId?: string;
  goodsIds?: string[];
  productionGoodsIds?: string[];
  usageGoodsIds?: string[];
  inputs?: SpecialGoods[];
  outputs?: SpecialDrop[];
  payload: SpecialPayload | Record<string, unknown>;
  order?: number;
}

export interface SpecialLoadProgress {
  loadedShards: number;
  totalShards: number;
  batch: SpecialRecord[];
}

/** Optional surface implemented by format-4 DatasetRepository. */
export interface SpecialRepository {
  readonly specialViewTypes?: readonly SpecialViewType[];
  readonly specialServiceIcons?: readonly SpecialServiceIcon[];
  specialFor?: (
    entryId: string,
    view: RecipeView,
    viewType: string,
    onProgress?: (progress: SpecialLoadProgress) => void,
    signal?: AbortSignal
  ) => Promise<SpecialRecord[]>;
  /** Alias accepted while the repository is being migrated. */
  specialRecordsFor?: SpecialRepository['specialFor'];
}

export function specialRepository(value: unknown): SpecialRepository {
  return value as SpecialRepository;
}

export function specialCategory(value: string): SpecialCategory | undefined {
  if ((SPECIAL_CATEGORY_ORDER as readonly string[]).includes(value)) {
    return value as SpecialCategory;
  }
  const aliases: Record<string, SpecialCategory> = {
    'crop-outputs': 'crop',
    'mutation-pools': 'cropPool',
    'crop-breeding': 'cropBreeding',
    'gt-ore-veins': 'gtOreVein',
    'gt-small-ores': 'gtSmallOre',
    'meteor-rituals': 'meteorRitual',
    lootbags: 'lootBag',
    'vending-trades': 'vending',
    'worldgen-loot': 'worldgenLoot',
    'gt-ore-processing': 'oreProcessing',
    cropOutput: 'crop',
    cropOutputs: 'crop',
    mutationPool: 'cropPool',
    mutationPools: 'cropPool',
    breeding: 'cropBreeding',
    directCropBreeding: 'cropBreeding',
    vein: 'gtOreVein',
    oreVein: 'gtOreVein',
    smallOre: 'gtSmallOre',
    meteor: 'meteorRitual',
    ritual: 'meteorRitual',
    loot: 'lootBag',
    enhancedLootBag: 'lootBag',
    vendingMachine: 'vending',
    worldGenLoot: 'worldgenLoot',
    oreProcess: 'oreProcessing',
    oreProcessingGraph: 'oreProcessing'
  };
  return aliases[value];
}

export function specialLabel(viewType: SpecialViewType): string {
  return viewType.shortLabel || viewType.label || viewType.id;
}

export function specialSearchText(record: SpecialRecord): string {
  const payload = record.payload as unknown as Record<string, unknown>;
  const flatten = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) return value.map(flatten).join(' ');
    if (typeof value === 'object') return Object.values(value).map(flatten).join(' ');
    return '';
  };
  return [
    record.id,
    record.category,
    record.title,
    record.subtitle,
    record.searchText,
    record.lookupId,
    record.recipesLookupId,
    record.usagesLookupId,
    ...(record.goodsIds ?? []),
    flatten(payload)
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

export function displaySpecialAmount(value: number | undefined, fluid = false): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  const suffix = fluid ? 'L' : '';
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))}B${suffix}`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M${suffix}`;
  if (value >= 10_000) return `${Number((value / 1_000).toFixed(1))}k${suffix}`;
  return `${value}${suffix}`;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Tolerant adapters for raw sidecar payloads used by the fixture and exporter. */
export function toSpecialGoods(value: unknown): SpecialGoods | undefined {
  if (typeof value === 'string') return { goodsId: value };
  const object = objectValue(value);
  if (!object) return undefined;
  const rawId = object.goodsId ?? object.id;
  const oreDictionary = object.oreDictionary;
  const goodsId = typeof rawId === 'string'
    ? rawId
    : typeof oreDictionary === 'string'
      ? `o:${oreDictionary}`
      : undefined;
  if (!goodsId) return undefined;
  return {
    goodsId,
    amount: typeof object.amount === 'number' ? object.amount : undefined,
    chance: typeof object.chance === 'number'
      ? object.chance
      : typeof object.probability === 'number'
        ? object.probability
        : undefined,
    label: typeof object.label === 'string'
      ? object.label
      : typeof oreDictionary === 'string'
        ? oreDictionary
        : undefined,
    role: typeof object.role === 'string'
      ? object.role
      : object.consumed === false
        ? 'tool'
        : undefined,
    alternatives: Array.isArray(object.alternatives)
      ? object.alternatives.filter((id): id is string => typeof id === 'string')
      : undefined,
    oreDictionaryId: typeof oreDictionary === 'string' ? `o:${oreDictionary}` : undefined
  };
}

export function toSpecialGoodsList(value: unknown): SpecialGoods[] {
  if (!Array.isArray(value)) return [];
  return value.map(toSpecialGoods).filter((item): item is SpecialGoods => item !== undefined);
}

function toSpecialDrop(value: unknown): SpecialDrop | undefined {
  const goods = toSpecialGoods(value);
  if (!goods) return undefined;
  const object = objectValue(value);
  if (!object) return goods;
  return {
    ...goods,
    minAmount: typeof object.minAmount === 'number'
      ? object.minAmount
      : typeof object.min === 'number'
        ? object.min
        : undefined,
    maxAmount: typeof object.maxAmount === 'number'
      ? object.maxAmount
      : typeof object.max === 'number'
        ? object.max
        : undefined,
    weight: typeof object.weight === 'number' ? object.weight : undefined,
    limit: typeof object.limit === 'number' ? object.limit : undefined,
    estimatedAmount: typeof object.estimatedAmount === 'number' ? object.estimatedAmount : undefined,
    fortune: Array.isArray(object.fortune)
      ? object.fortune.filter((entry): entry is number => typeof entry === 'number').slice(0, 4) as [number, number, number, number]
      : undefined
  };
}

export function toSpecialDrops(value: unknown): SpecialDrop[] {
  if (!Array.isArray(value)) return [];
  return value.map(toSpecialDrop).filter((item): item is SpecialDrop => item !== undefined);
}

export function boundedSpecialPage<T>(values: readonly T[], page: number, pageSize: number): T[] {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('Special page size must be a positive integer');
  }
  const safePage = Math.max(0, Math.floor(page));
  return values.slice(safePage * pageSize, (safePage + 1) * pageSize);
}

/** Entry is intentionally tiny so special renderers can share normal navigation. */
export type SpecialResolver = (id: string) => CatalogEntry | undefined;
