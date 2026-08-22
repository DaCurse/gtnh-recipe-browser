import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** The wire version of browser-nei-special.json. */
const SPECIAL_SCHEMA_VERSION = 1 as const;

/**
 * Keep this order in sync with the order used by the NEI tabs.  It is part of
 * the sidecar contract: relying on object insertion order here made exports
 * change when a mod happened to register a handler in a different order.
 */
export const SPECIAL_CATEGORY_IDS = [
  'crop-output',
  'mutation-pool',
  'crop-breeding',
  'gt-ore-vein',
  'gt-small-ore',
  'meteor-ritual',
  'loot-bag',
  'vending-trade',
  'worldgen-loot',
  'gt-ore-processing'
] as const;

type SpecialCategoryId = (typeof SPECIAL_CATEGORY_IDS)[number];

/** Names accepted by the overlay when adapting older NEI terminology. */
const CATEGORY_ALIASES: Record<string, SpecialCategoryId> = {
  'crop-outputs': 'crop-output',
  crops: 'crop-output',
  cropOutput: 'crop-output',
  cropOutputs: 'crop-output',
  crop: 'crop-output',
  'mutation-pools': 'mutation-pool',
  mutations: 'mutation-pool',
  mutationPool: 'mutation-pool',
  mutationPools: 'mutation-pool',
  cropPool: 'mutation-pool',
  'direct-crop-breeding': 'crop-breeding',
  'crop-breedings': 'crop-breeding',
  cropBreeding: 'crop-breeding',
  cropBreedings: 'crop-breeding',
  gtOreVein: 'gt-ore-vein',
  gtOreVeins: 'gt-ore-vein',
  'gt-ore-veins': 'gt-ore-vein',
  gtSmallOre: 'gt-small-ore',
  gtSmallOres: 'gt-small-ore',
  'gt-small-ores': 'gt-small-ore',
  meteorRitual: 'meteor-ritual',
  meteorRituals: 'meteor-ritual',
  'meteor-rituals': 'meteor-ritual',
  lootbags: 'loot-bag',
  lootBag: 'loot-bag',
  lootBags: 'loot-bag',
  'loot-bags': 'loot-bag',
  vending: 'vending-trade',
  vendingTrade: 'vending-trade',
  vendingTrades: 'vending-trade',
  'vending-trades': 'vending-trade',
  'vending-machine': 'vending-trade',
  worldgen: 'worldgen-loot',
  worldgenLoot: 'worldgen-loot',
  worldGenLoot: 'worldgen-loot',
  'world-gen-loot': 'worldgen-loot',
  'ore-processing': 'gt-ore-processing',
  gtOreProcessing: 'gt-ore-processing',
  oreProcessing: 'gt-ore-processing'
};

interface SpecialSourceVersions {
  gtnhVersion: string;
  exporter: {
    repository: string;
    commit: string;
  };
  overlay: {
    version: string;
    commit?: string;
  };
  /** Mod ID to the exact version used to compile and run the adapters. */
  mods: Record<string, string>;
}

export interface SpecialViewType {
  id: SpecialCategoryId;
  label: string;
  serviceIconId: string;
}

interface SpecialServiceIcon {
  id: string;
  label: string;
  /** A normal goods ID or an explicit service-only icon token. */
  goodsId?: string;
  searchable: false;
}

interface SpecialRecordBase {
  id: string;
  category: SpecialCategoryId;
  title: string;
  /** Pre-normalized plain search text; service records are never indexed as goods. */
  searchText: string;
  goodsIds: string[];
  recipesLookupId: string;
  usagesLookupId: string;
  serviceIconId: string;
  payload: Record<string, unknown>;
}

export interface SpecialRecord extends SpecialRecordBase {
  [key: string]: unknown;
}

export interface SpecialData {
  schemaVersion: typeof SPECIAL_SCHEMA_VERSION;
  sourceVersions: SpecialSourceVersions;
  /** All requested categories must be listed, including a category with no records. */
  categories: SpecialCategoryId[];
  serviceIcons: SpecialServiceIcon[];
  specialViewTypes?: SpecialViewType[];
  records: SpecialRecord[];
}

interface SpecialValidationOptions {
  /** Defaults to every category in SPECIAL_CATEGORY_IDS. */
  requiredCategories?: readonly SpecialCategoryId[];
  /** Defaults to true; use false only for a deliberately partial development export. */
  requireNonEmptyCategories?: boolean;
  knownGoodsIds?: ReadonlySet<string>;
  knownRecipeLookupIds?: ReadonlySet<string>;
  knownUsageLookupIds?: ReadonlySet<string>;
  knownServiceIconIds?: ReadonlySet<string>;
}

export class SpecialDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecialDataError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SpecialDataError(`${path} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SpecialDataError(`${path} must be a finite number`);
  }
  return value;
}

function normalizeCategory(value: unknown, path: string): SpecialCategoryId {
  const category = requiredString(value, path);
  if ((SPECIAL_CATEGORY_IDS as readonly string[]).includes(category)) {
    return category as SpecialCategoryId;
  }
  const alias = CATEGORY_ALIASES[category];
  if (alias) return alias;
  throw new SpecialDataError(`${path} has unsupported category ${JSON.stringify(category)}`);
}

function sortedUniqueStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new SpecialDataError(`${path} must be an array`);
  const values = value.map((entry, index) => requiredString(entry, `${path}[${index}]`));
  const unique = [...new Set(values)].sort();
  if (unique.length !== values.length) throw new SpecialDataError(`${path} contains duplicate values`);
  return unique;
}

function cloneForJson(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finiteNumber(value, path);
  if (Array.isArray(value)) return value.map((entry, index) => cloneForJson(entry, `${path}[${index}]`));
  if (!isRecord(value)) throw new SpecialDataError(`${path} contains a non-JSON value`);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const childPath = `${path}.${key}`;
    result[key] = key === 'oreDictionary'
      ? requiredString(value[key], childPath)
      : cloneForJson(value[key], childPath);
  }
  return result;
}

function sourceVersions(value: unknown): SpecialSourceVersions {
  if (!isRecord(value)) throw new SpecialDataError('sourceVersions must be an object');
  const exporter = value.exporter;
  const overlay = value.overlay;
  const mods = value.mods;
  if (!isRecord(mods)) {
    // The Java overlay intentionally emits a flat map because it has no JSON
    // dependency.  Normalize that representation at the process boundary so
    // sidecar hashes remain independent of the writer implementation.
    const flat = Object.entries(value);
    const gtnhVersion = value.gtnhVersion ?? value.gtnh;
    const overlayVersion = value.overlayVersion ?? value.overlay;
    if (typeof gtnhVersion !== 'string' || typeof overlayVersion !== 'string') {
      throw new SpecialDataError('sourceVersions must contain gtnh and overlay versions');
    }
    const flatMods: Record<string, string> = {};
    for (const [modId, version] of flat) {
      if (['gtnh', 'gtnhVersion', 'overlay', 'overlayVersion', 'exporter', 'exporterCommit'].includes(modId)) continue;
      flatMods[requiredString(modId, 'sourceVersions key')] = requiredString(version, `sourceVersions.${modId}`);
    }
    return {
      gtnhVersion,
      exporter: {
        repository: requiredString(value.exporterRepository ?? 'runtime-overlay', 'sourceVersions.exporter.repository'),
        commit: requiredString(value.exporterCommit ?? value.exporter ?? 'runtime', 'sourceVersions.exporter.commit')
      },
      overlay: { version: overlayVersion },
      mods: Object.fromEntries(Object.entries(flatMods).sort(([left], [right]) => left.localeCompare(right)))
    };
  }
  if (!isRecord(exporter)) throw new SpecialDataError('sourceVersions.exporter must be an object');
  if (!isRecord(overlay)) throw new SpecialDataError('sourceVersions.overlay must be an object');
  const normalizedMods: Record<string, string> = {};
  for (const modId of Object.keys(mods).sort()) {
    normalizedMods[requiredString(modId, 'sourceVersions.mods key')] =
      requiredString(mods[modId], `sourceVersions.mods.${modId}`);
  }
  return {
    gtnhVersion: requiredString(value.gtnhVersion, 'sourceVersions.gtnhVersion'),
    exporter: {
      repository: requiredString(exporter.repository, 'sourceVersions.exporter.repository'),
      commit: requiredString(exporter.commit, 'sourceVersions.exporter.commit')
    },
    overlay: {
      version: requiredString(overlay.version, 'sourceVersions.overlay.version'),
      ...(overlay.commit === undefined
        ? {}
        : { commit: requiredString(overlay.commit, 'sourceVersions.overlay.commit') })
    },
    mods: normalizedMods
  };
}

function serviceIcons(value: unknown): SpecialServiceIcon[] {
  if (!Array.isArray(value)) throw new SpecialDataError('serviceIcons must be an array');
  const icons = value.map((entry, index) => {
    const path = `serviceIcons[${index}]`;
    if (!isRecord(entry)) throw new SpecialDataError(`${path} must be an object`);
    const icon: SpecialServiceIcon = {
      id: requiredString(entry.id, `${path}.id`),
      label: requiredString(entry.label, `${path}.label`),
      searchable: false
    };
    if (entry.goodsId !== undefined) icon.goodsId = requiredString(entry.goodsId, `${path}.goodsId`);
    if (entry.searchable !== false) throw new SpecialDataError(`${path}.searchable must be false`);
    return icon;
  });
  const ids = new Set<string>();
  for (const icon of icons) {
    if (ids.has(icon.id)) throw new SpecialDataError(`duplicate service icon ID ${icon.id}`);
    ids.add(icon.id);
  }
  return icons.sort((left, right) => left.id.localeCompare(right.id));
}

function viewTypes(value: unknown, iconIds: ReadonlySet<string>): SpecialViewType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new SpecialDataError('specialViewTypes must be an array');
  const views = value.map((entry, index) => {
    const path = `specialViewTypes[${index}]`;
    if (!isRecord(entry)) throw new SpecialDataError(`${path} must be an object`);
    const view: SpecialViewType = {
      id: normalizeCategory(entry.id, `${path}.id`),
      label: requiredString(entry.label, `${path}.label`),
      serviceIconId: requiredString(entry.serviceIconId, `${path}.serviceIconId`)
    };
    if (!iconIds.has(view.serviceIconId)) {
      throw new SpecialDataError(`${path}.serviceIconId references unknown icon ${view.serviceIconId}`);
    }
    return view;
  });
  const ids = new Set<string>();
  for (const view of views) {
    if (ids.has(view.id)) throw new SpecialDataError(`duplicate special view type ${view.id}`);
    ids.add(view.id);
  }
  return views.sort((left, right) => SPECIAL_CATEGORY_IDS.indexOf(left.id) - SPECIAL_CATEGORY_IDS.indexOf(right.id));
}

function lookupId(raw: Record<string, unknown>, names: string[], path: string): string {
  for (const name of names) {
    const candidate = raw[name];
    if (candidate !== undefined) return requiredString(candidate, path);
  }
  const lookup = raw.lookup;
  if (isRecord(lookup)) {
    for (const name of names) {
      const candidate = lookup[name.replace('LookupId', '').replace('Id', '').toLowerCase()];
      if (candidate !== undefined) return requiredString(candidate, path);
    }
  }
  throw new SpecialDataError(`${path} is required`);
}

function normalizeRecord(value: unknown, index: number, iconIds: ReadonlySet<string>): SpecialRecord {
  const path = `records[${index}]`;
  if (!isRecord(value)) throw new SpecialDataError(`${path} must be an object`);
  const category = normalizeCategory(value.category, `${path}.category`);
  const payloadValue = value.payload ?? value.data;
  if (!isRecord(payloadValue)) throw new SpecialDataError(`${path}.payload must be an object`);
  const serviceIconId = requiredString(value.serviceIconId ?? value.iconId, `${path}.serviceIconId`);
  if (!iconIds.has(serviceIconId)) {
    throw new SpecialDataError(`${path}.serviceIconId references unknown icon ${serviceIconId}`);
  }
  const rawGoodsIds = value.goodsIds ?? [];
  const record: SpecialRecord = {
    id: requiredString(value.id, `${path}.id`),
    category,
    title: requiredString(value.title ?? value.name, `${path}.title`),
    searchText: requiredString(value.searchText ?? value.search, `${path}.searchText`),
    goodsIds: sortedUniqueStrings(rawGoodsIds, `${path}.goodsIds`),
    recipesLookupId: lookupId(value, ['recipesLookupId', 'recipeLookupId'], `${path}.recipesLookupId`),
    usagesLookupId: lookupId(value, ['usagesLookupId', 'usageLookupId'], `${path}.usagesLookupId`),
    serviceIconId,
    payload: cloneForJson(payloadValue, `${path}.payload`) as Record<string, unknown>
  };
  // Preserve explicitly supplied extension fields in the normalized sidecar.
  // Known fields are rewritten above so aliases cannot leak into the wire form.
  for (const key of Object.keys(value).sort()) {
    if (!['category', 'data', 'goodsIds', 'iconId', 'id', 'lookup', 'name', 'payload', 'recipeLookupId', 'recipesLookupId', 'search', 'searchText', 'serviceIconId', 'title', 'usageLookupId', 'usagesLookupId'].includes(key)) {
      record[key] = cloneForJson(value[key], `${path}.${key}`);
    }
  }
  return record;
}

function categories(value: unknown, records: readonly SpecialRecord[]): SpecialCategoryId[] {
  if (value === undefined) {
    return SPECIAL_CATEGORY_IDS.filter((category) => records.some((record) => record.category === category));
  }
  const listed = sortedUniqueStrings(value, 'categories');
  return listed.map((category, index) => normalizeCategory(category, `categories[${index}]`)).sort(
    (left, right) => SPECIAL_CATEGORY_IDS.indexOf(left) - SPECIAL_CATEGORY_IDS.indexOf(right)
  );
}

function validateCategoryCoverage(
  listed: readonly SpecialCategoryId[],
  records: readonly SpecialRecord[],
  options: SpecialValidationOptions
): void {
  const required = options.requiredCategories ?? SPECIAL_CATEGORY_IDS;
  for (const category of required) {
    if (!listed.includes(category)) throw new SpecialDataError(`missing requested category ${category}`);
    if (options.requireNonEmptyCategories !== false && !records.some((record) => record.category === category)) {
      throw new SpecialDataError(`requested category ${category} has no records`);
    }
  }
}

function validateReferences(
  data: SpecialData,
  options: SpecialValidationOptions
): void {
  const iconIds = new Set(data.serviceIcons.map((icon) => icon.id));
  const knownIcons = options.knownServiceIconIds;
  const knownGoods = options.knownGoodsIds;
  const knownRecipes = options.knownRecipeLookupIds;
  const knownUsages = options.knownUsageLookupIds;
  const goods = new Set<string>();
  for (const icon of data.serviceIcons) if (icon.goodsId) goods.add(icon.goodsId);
  for (const record of data.records) {
    if (!iconIds.has(record.serviceIconId)) throw new SpecialDataError(`${record.id}: unknown service icon ${record.serviceIconId}`);
    if (knownIcons && !knownIcons.has(record.serviceIconId)) {
      throw new SpecialDataError(`${record.id}: service icon ${record.serviceIconId} is not in the exported icon catalog`);
    }
    if (knownRecipes && !knownRecipes.has(record.recipesLookupId)) {
      throw new SpecialDataError(`${record.id}: unresolved Recipes lookup ${record.recipesLookupId}`);
    }
    if (knownUsages && !knownUsages.has(record.usagesLookupId)) {
      throw new SpecialDataError(`${record.id}: unresolved Usages lookup ${record.usagesLookupId}`);
    }
    for (const goodsId of [...record.goodsIds, ...nestedGoodsIds(record.payload)]) {
      if (goods.has(goodsId)) continue;
      goods.add(goodsId);
      if (knownGoods && !knownGoods.has(goodsId)) {
        throw new SpecialDataError(`${record.id}: unresolved goods ID ${goodsId}`);
      }
    }
  }
  if (knownGoods) {
    for (const icon of data.serviceIcons) {
      if (icon.goodsId && !knownGoods.has(icon.goodsId)) {
        throw new SpecialDataError(`${icon.id}: unresolved goods ID ${icon.goodsId}`);
      }
    }
  }
}

function nestedGoodsIds(value: unknown): string[] {
  const result = new Set<string>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isRecord(current)) return;
    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.endsWith('goodsid') && typeof child === 'string') result.add(child);
      if (normalizedKey.endsWith('goodsids') && Array.isArray(child)) {
        for (const candidate of child) if (typeof candidate === 'string') result.add(candidate);
      }
      visit(child);
    }
  };
  visit(value);
  return [...result].sort();
}

/**
 * Validates and returns a deterministic representation of a sidecar.  The
 * returned object is safe to MessagePack or JSON encode: all object keys are
 * sorted, records and references are stable, and no input object is mutated.
 */
export function canonicalizeSpecialData(
  value: unknown,
  options: SpecialValidationOptions = {}
): SpecialData {
  if (!isRecord(value)) throw new SpecialDataError('special sidecar must be an object');
  if (value.schemaVersion !== SPECIAL_SCHEMA_VERSION) {
    throw new SpecialDataError(`Unsupported special sidecar schema ${String(value.schemaVersion)}; required ${SPECIAL_SCHEMA_VERSION}`);
  }
  const normalizedIcons = serviceIcons(value.serviceIcons);
  const iconIds = new Set(normalizedIcons.map((icon) => icon.id));
  const normalizedRecords = Array.isArray(value.records)
    ? value.records.map((record, index) => normalizeRecord(record, index, iconIds))
    : (() => { throw new SpecialDataError('records must be an array'); })();
  const recordIds = new Set<string>();
  for (const record of normalizedRecords) {
    if (recordIds.has(record.id)) throw new SpecialDataError(`duplicate special record ID ${record.id}`);
    recordIds.add(record.id);
  }
  const normalizedCategories = categories(value.categories, normalizedRecords);
  const data: SpecialData = {
    schemaVersion: SPECIAL_SCHEMA_VERSION,
    sourceVersions: sourceVersions(value.sourceVersions),
    categories: normalizedCategories,
    serviceIcons: normalizedIcons,
    records: normalizedRecords.sort((left, right) => {
      const categoryOrder = SPECIAL_CATEGORY_IDS.indexOf(left.category) - SPECIAL_CATEGORY_IDS.indexOf(right.category);
      return categoryOrder || left.id.localeCompare(right.id);
    })
  };
  const normalizedViews = viewTypes(value.specialViewTypes, iconIds);
  if (normalizedViews) data.specialViewTypes = normalizedViews;
  validateCategoryCoverage(data.categories, data.records, options);
  validateReferences(data, options);
  return data;
}

export function serializeSpecialData(
  value: unknown,
  options: SpecialValidationOptions = {}
): string {
  return `${JSON.stringify(canonicalizeSpecialData(value, options), null, 2)}\n`;
}

export async function readSpecialSidecar(
  path: string,
  options: SpecialValidationOptions = {}
): Promise<SpecialData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new SpecialDataError(`Unable to read special sidecar ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return canonicalizeSpecialData(parsed, options);
}

export function specialDataSha256(value: unknown, options: SpecialValidationOptions = {}): string {
  return createHash('sha256').update(serializeSpecialData(value, options)).digest('hex');
}

export function specialGoodsIds(data: SpecialData): string[] {
  return [...new Set([
    ...data.records.flatMap((record) => [...record.goodsIds, ...nestedGoodsIds(record.payload)]),
    ...data.serviceIcons.flatMap((icon) => icon.goodsId ? [icon.goodsId] : [])
  ])].sort();
}

export function buildSpecialViewTypes(data: SpecialData): SpecialViewType[] {
  if (data.specialViewTypes) return data.specialViewTypes.map((view) => ({ ...view }));
  const iconByCategory = new Map<string, string>();
  for (const record of data.records) if (!iconByCategory.has(record.category)) iconByCategory.set(record.category, record.serviceIconId);
  return SPECIAL_CATEGORY_IDS.filter((category) => iconByCategory.has(category)).map((category) => ({
    id: category,
    label: category.replaceAll('-', ' '),
    serviceIconId: iconByCategory.get(category)!
  }));
}
