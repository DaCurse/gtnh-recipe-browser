import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encode } from '@msgpack/msgpack';
import type {
  DecodedRecipe,
  DecodedRecipeType,
  DecodedRepository
} from './model';
import type { SpecialData, SpecialRecord } from './special';
import { buildSpecialViewTypes, specialGoodsForDirection } from './special';

const SHARED_LAYOUT_SCHEMA_VERSION = 1;
const SHARED_LAYOUT_MAX_PREFIX_NIBBLES = 8;

export interface SharedLayoutTargets {
  recipes: number;
  goods: number;
  goodsMetadata: number;
  special: number;
  oreDictionaries: number;
}

export interface SharedPartitionLayout {
  schemaVersion: 1;
  targets: SharedLayoutTargets;
  /** Prefixes are immutable trie leaves. An empty prefix is the root leaf. */
  recipeTypes: Record<string, string[]>;
  goods: string[];
  oreDictionaries: string[];
  specialViews: Record<string, string[]>;
  /** Stable owner order; an owner's array index is its sprite cell forever. */
  iconOwners: string[];
  /** Historical diagnostics; entries are never removed when a layout is extended. */
  oversizedSingletons?: SharedOversizedSingleton[];
}

/**
 * The part of the persistent layout which must travel with every published
 * manifest. Icon owner slots are intentionally kept in the checked-in layout
 * input: the prefix trie is the release-lineage contract, while icon sheets
 * are independently content addressed.
 */
export interface SharedPrefixLayout {
  schemaVersion: 1;
  targets: SharedLayoutTargets;
  recipeTypes: Record<string, string[]>;
  goods: string[];
  oreDictionaries: string[];
  specialViews: Record<string, string[]>;
}

export const DEFAULT_SHARED_LAYOUT_TARGETS: SharedLayoutTargets = {
  // These targets keep modified recipe and intrinsic-goods records local
  // without turning every small recipe type into dozens of objects. Goods
  // metadata is paired with the goods prefix but is intentionally allowed a
  // larger cap because it contains relation indexes and display/search data.
  recipes: 1024 * 1024,
  goods: 160 * 1024,
  goodsMetadata: 512 * 1024,
  special: 1024 * 1024,
  oreDictionaries: 1024 * 1024
};

export interface SharedRecord {
  id: string;
  namespace: string;
  value: unknown;
}

/**
 * Fields which can change without changing the stable identity of a goods
 * record.  Keep this list explicit: the shared layout must be driven by the
 * wire model, not by conventions in logical IDs or filenames.
 *
 * The relation fields are deliberately here as well.  They are catalog
 * indexes derived from recipes/special records, so a recipe edit should not
 * rewrite the intrinsic goods shard which owns the item itself.
 */
const GOODS_METADATA_FIELDS = [
  'name',
  'tooltip',
  'unlocalizedName',
  'searchMask',
  'searchable',
  'numericId',
  'productionShards',
  'usageShards',
  'productionCount',
  'usageCount',
  'specialProductionShards',
  'specialUsageShards',
  'specialProductionLookupIds',
  'specialUsageLookupIds',
  'specialProductionCount',
  'specialUsageCount'
] as const;

const GOODS_METADATA_FIELD_SET = new Set<string>(GOODS_METADATA_FIELDS);

export function sharedGoodsStableValue(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !GOODS_METADATA_FIELD_SET.has(key))
  );
}

export function sharedGoodsMetadataValue(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => GOODS_METADATA_FIELD_SET.has(key) || key === 'id')
  );
}

interface SharedOversizedSingleton {
  namespace: string;
  prefix: string;
  /** Estimated compressed payload bytes for the complete singleton record. */
  estimatedBytes: number;
}

type SharedProbeLogicalId = (namespace: string, prefix: string) => string;
type SharedBucketEncoder = (logicalId: string, prefix: string, records: readonly SharedRecord[]) => unknown;

function stableRecipeTypeId(type: Pick<DecodedRecipeType, 'category' | 'name'>): string {
  // The decoder's source ID contains an order number. Reconstruct the stable
  // identity from typed recipe-type fields instead of parsing that number out
  // of an ID string; order remains presentation metadata in the manifest.
  return `recipeType:${encodeURIComponent(type.category)}:${encodeURIComponent(type.name)}`;
}

function stableRecipeTypeIds(
  types: readonly DecodedRecipeType[]
): Map<string, string> {
  const result = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const type of types) {
    const stableId = stableRecipeTypeId(type);
    const previous = owners.get(stableId);
    if (previous !== undefined && previous !== type.id) {
      throw new Error(`Recipe type IDs collide after removing presentation order: ${previous} and ${type.id}`);
    }
    owners.set(stableId, type.id);
    result.set(type.id, stableId);
  }
  return result;
}

function iconOwners(repository: DecodedRepository): Array<{ id: string; iconId: number }> {
  return [
    ...repository.items,
    ...repository.fluids,
    ...repository.recipeTypes.flatMap((type) => [
      ...type.singleblocks,
      ...type.multiblocks,
      ...(type.defaultCrafter ? [type.defaultCrafter] : [])
    ])
  ].map((entry) => ({ id: entry.id, iconId: entry.iconId }));
}

function buildIconOwners(repositories: readonly DecodedRepository[]): string[] {
  return [...new Set(repositories.flatMap((repository) => iconOwners(repository).map((owner) => owner.id)))].sort();
}

function sharedIconSlots(
  owners: readonly string[]
): Map<string, { sheetId: string; index: number }> {
  return new Map(owners.map((ownerId, slot) => [
    ownerId,
    {
      sheetId: `icons-${Math.floor(slot / 1024).toString().padStart(3, '0')}`,
      index: slot % 1024
    }
  ]));
}

export function sharedPrefixLayout(layout: SharedPartitionLayout): SharedPrefixLayout {
  return {
    schemaVersion: layout.schemaVersion,
    targets: { ...layout.targets },
    recipeTypes: Object.fromEntries(Object.entries(layout.recipeTypes).map(([id, prefixes]) => [id, [...prefixes]])),
    goods: [...layout.goods],
    oreDictionaries: [...layout.oreDictionaries],
    specialViews: Object.fromEntries(Object.entries(layout.specialViews).map(([id, prefixes]) => [id, [...prefixes]]))
  };
}

/** The fingerprint covers the published trie, not formatting of the input file. */
export function sharedPrefixLayoutFingerprint(layout: SharedPrefixLayout): string {
  return createHash('sha256')
    .update(JSON.stringify(layout))
    .digest('hex');
}

export function sharedLayoutFingerprint(layout: SharedPartitionLayout): string {
  return sharedPrefixLayoutFingerprint(sharedPrefixLayout(layout));
}

function assertPrefixList(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one partition`);
  }
  const seen = new Set<string>();
  for (const prefix of value) {
    if (typeof prefix !== 'string' || !/^[0-9a-f]{0,8}$/.test(prefix)) {
      throw new Error(`${label} contains an invalid partition prefix ${String(prefix)}`);
    }
    if (seen.has(prefix)) throw new Error(`${label} contains duplicate partition prefix ${prefix || 'root'}`);
    seen.add(prefix);
  }
}

function assertPrefixMap(value: unknown, label: string): asserts value is Record<string, string[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a namespace-to-prefix map`);
  }
  for (const [namespace, prefixes] of Object.entries(value)) {
    if (namespace.length === 0) throw new Error(`${label} contains an empty namespace`);
    assertPrefixList(prefixes, `${label}.${namespace}`);
  }
}

export function validateSharedPrefixLayout(layout: SharedPrefixLayout): void {
  if (!layout || layout.schemaVersion !== SHARED_LAYOUT_SCHEMA_VERSION) {
    throw new Error('Invalid shared prefix layout schema');
  }
  const targets = layout.targets as Partial<SharedLayoutTargets> | undefined;
  for (const key of ['recipes', 'goods', 'goodsMetadata', 'special', 'oreDictionaries'] as const) {
    const bytes = targets?.[key];
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1024) {
      throw new Error(`Invalid shared prefix layout target ${key}=${String(bytes)}`);
    }
  }
  assertPrefixList(layout.goods, 'Shared prefix layout goods');
  assertPrefixList(layout.oreDictionaries, 'Shared prefix layout oreDictionaries');
  assertPrefixMap(layout.recipeTypes, 'Shared prefix layout recipeTypes');
  assertPrefixMap(layout.specialViews, 'Shared prefix layout specialViews');
}

/**
 * Check release lineage. Existing namespaces and prefixes are never removed;
 * a new layout may only add namespaces or descendants. Targets are part of
 * the contract too, so changing a cap cannot silently rebalance old leaves.
 */
export function assertSharedLayoutExtension(
  previous: SharedPrefixLayout,
  next: SharedPrefixLayout
): void {
  validateSharedPrefixLayout(previous);
  validateSharedPrefixLayout(next);
  for (const key of ['recipes', 'goods', 'goodsMetadata', 'special', 'oreDictionaries'] as const) {
    if (previous.targets[key] !== next.targets[key]) {
      throw new Error(`Shared layout target ${key} changed from ${previous.targets[key]} to ${next.targets[key]}`);
    }
  }
  const assertMapExtension = (
    mapName: string,
    oldMap: Record<string, string[]>,
    newMap: Record<string, string[]>
  ): void => {
    for (const [namespace, oldPrefixes] of Object.entries(oldMap)) {
      const newPrefixes = newMap[namespace];
      if (!newPrefixes) throw new Error(`Shared layout removed namespace ${mapName}.${namespace}`);
      for (const prefix of oldPrefixes) {
        if (!newPrefixes.includes(prefix)) {
          throw new Error(`Shared layout removed ${mapName}.${namespace} prefix ${prefix || 'root'}`);
        }
      }
      for (const candidate of newPrefixes) {
        if (oldPrefixes.includes(candidate)) continue;
        for (const previousPrefix of oldPrefixes) {
          if (candidate !== previousPrefix && previousPrefix.startsWith(candidate)) {
            throw new Error(
              `Shared layout introduced ${mapName}.${namespace} ancestor ${candidate || 'root'} for existing prefix ${previousPrefix || 'root'}`
            );
          }
        }
      }
    }
  };
  const assertListExtension = (name: string, oldList: string[], newList: string[]): void => {
    for (const prefix of oldList) {
      if (!newList.includes(prefix)) {
        throw new Error(`Shared layout removed ${name} prefix ${prefix || 'root'}`);
      }
    }
    for (const candidate of newList) {
      if (oldList.includes(candidate)) continue;
      for (const previousPrefix of oldList) {
        // A newly introduced ancestor would absorb an already published
        // partition.  Keeping the old prefix in the list would not make that
        // safe: longest-prefix routing would change which logical shard owns
        // records in the candidate's subtree.  New descendants and disjoint
        // leaves are fine; only a strict ancestor of an old prefix is banned.
        if (candidate !== previousPrefix && previousPrefix.startsWith(candidate)) {
          throw new Error(
            `Shared layout introduced ${name} ancestor ${candidate || 'root'} for existing prefix ${previousPrefix || 'root'}`
          );
        }
      }
    }
  };
  assertMapExtension('recipeTypes', previous.recipeTypes, next.recipeTypes);
  assertMapExtension('specialViews', previous.specialViews, next.specialViews);
  assertListExtension('goods', previous.goods, next.goods);
  assertListExtension('oreDictionaries', previous.oreDictionaries, next.oreDictionaries);
}

export function sharedRepository(repository: DecodedRepository): DecodedRepository {
  const typeIds = stableRecipeTypeIds(repository.recipeTypes);
  return {
    ...repository,
    recipeTypes: repository.recipeTypes.map((type) => ({
      ...type,
      id: typeIds.get(type.id)!
    })),
    recipes: repository.recipes.map((recipe) => ({
      ...recipe,
      recipeTypeId: typeIds.get(recipe.recipeTypeId) ?? (() => {
        throw new Error(`Recipe ${recipe.id} references unknown type ${recipe.recipeTypeId}`);
      })()
    }))
  };
}

export function sharedPartitionPrefix(namespace: string, id: string, nibbles: number): string {
  if (!Number.isInteger(nibbles) || nibbles < 0 || nibbles > SHARED_LAYOUT_MAX_PREFIX_NIBBLES) {
    throw new RangeError(`Invalid shared partition depth ${nibbles}`);
  }
  return createHash('sha256').update(`${namespace}\0${id}`).digest('hex').slice(0, nibbles);
}

export function sharedLogicalId(kind: string, namespace: string, prefix: string): string {
  const encodedNamespace = encodeURIComponent(namespace).replace(/%/g, '_');
  return `${kind}-${encodedNamespace}-${prefix || 'root'}`;
}

export function groupSharedRecords<T extends SharedRecord>(
  records: readonly T[],
  prefixes: readonly string[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const hash = sharedPartitionPrefix(record.namespace, record.id, SHARED_LAYOUT_MAX_PREFIX_NIBBLES);
    const prefix = [...prefixes]
      .filter((candidate) => hash.startsWith(candidate))
      .sort((left, right) => right.length - left.length)[0];
    if (prefix === undefined) {
      throw new Error(`Shared layout has no partition for ${record.namespace}/${record.id}`);
    }
    const bucket = grouped.get(prefix) ?? [];
    bucket.push(record);
    grouped.set(prefix, bucket);
  }
  for (const bucket of grouped.values()) bucket.sort((left, right) => left.id.localeCompare(right.id));
  return grouped;
}

function sharedMessagePackBytes(value: unknown): number {
  return gzipSync(encode(value), { level: 9 }).byteLength;
}

function partitionPrefixesForRecords<T extends SharedRecord>(
  records: readonly T[],
  targetBytes: number,
  encodeBucket: SharedBucketEncoder,
  logicalIdForPrefix: SharedProbeLogicalId
): string[] {
  const split = (bucket: readonly T[], prefix: string): string[] => {
    if (bucket.length === 0) return [];
    const size = sharedMessagePackBytes(encodeBucket(
      logicalIdForPrefix(bucket[0]!.namespace, prefix),
      prefix,
      bucket
    ));
    if (size <= targetBytes || bucket.length === 1) return [prefix];
    if (prefix.length >= SHARED_LAYOUT_MAX_PREFIX_NIBBLES) {
      throw new Error(`Unable to partition ${bucket[0]!.namespace}; a single record exceeds the shared target`);
    }
    const groups = new Map<string, T[]>();
    for (const record of bucket) {
      const hash = sharedPartitionPrefix(record.namespace, record.id, prefix.length + 1);
      const childPrefix = hash.slice(0, prefix.length + 1);
      const child = groups.get(childPrefix) ?? [];
      child.push(record);
      groups.set(childPrefix, child);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([childPrefix, child]) => split(child, childPrefix));
  };
  return split(records, '');
}

function oversizedSingletonsForRecords<T extends SharedRecord>(
  records: readonly T[],
  prefixes: readonly string[],
  targetBytes: number,
  encodeBucket: SharedBucketEncoder,
  logicalIdForPrefix: SharedProbeLogicalId
): SharedOversizedSingleton[] {
  const result: SharedOversizedSingleton[] = [];
  for (const [prefix, bucket] of groupSharedRecords(records, prefixes)) {
    if (bucket.length !== 1) continue;
    const estimatedBytes = sharedMessagePackBytes(encodeBucket(
      logicalIdForPrefix(bucket[0]!.namespace, prefix),
      prefix,
      bucket
    ));
    if (estimatedBytes > targetBytes) {
      result.push({ namespace: bucket[0]!.namespace, prefix, estimatedBytes });
    }
  }
  return result;
}

function uniqueSharedRecords<T extends SharedRecord>(records: readonly T[]): T[] {
  const result = new Map<string, T>();
  for (const record of records) {
    const key = `${record.namespace}\0${record.id}`;
    // The layout only needs one representative per stable record ID. Keep the
    // first one deterministically; a later dataset can split the persistent
    // leaf if its changed representation grows beyond the target.
    if (!result.has(key)) result.set(key, record);
  }
  return [...result.values()];
}

function extendPartitionPrefixes<T extends SharedRecord>(
  previous: readonly string[],
  records: readonly T[],
  targetBytes: number,
  encodeBucket: SharedBucketEncoder,
  logicalIdForPrefix: SharedProbeLogicalId
): string[] {
  const prefixes = new Set(previous);
  // A record outside a previously published sparse trie gets its own leaf.
  // This never changes the meaning of an existing prefix.
  for (const record of records) {
    const hash = sharedPartitionPrefix(record.namespace, record.id, SHARED_LAYOUT_MAX_PREFIX_NIBBLES);
    if (![...prefixes].some((prefix) => hash.startsWith(prefix))) prefixes.add(hash);
  }
  // Existing leaves may be split into descendants when this dataset makes a
  // leaf too large. Keep the parent in the layout: older manifests still use
  // it, while longest-prefix matching routes this dataset to the descendants.
  const leavesToSplit = [...prefixes];
  for (const prefix of leavesToSplit) {
    const bucket = records.filter((record) => (
      sharedPartitionPrefix(record.namespace, record.id, SHARED_LAYOUT_MAX_PREFIX_NIBBLES).startsWith(prefix)
    ));
    if (bucket.length === 0) continue;
    const split = (values: readonly T[], currentPrefix: string): void => {
      const size = sharedMessagePackBytes(encodeBucket(
        logicalIdForPrefix(values[0]!.namespace, currentPrefix),
        currentPrefix,
        values
      ));
      if (size <= targetBytes || values.length <= 1) return;
      if (currentPrefix.length >= SHARED_LAYOUT_MAX_PREFIX_NIBBLES) {
        throw new Error(`Unable to extend ${values[0]!.namespace}; a singleton record exceeds the shared target`);
      }
      const children = new Map<string, T[]>();
      for (const record of values) {
        const hash = sharedPartitionPrefix(record.namespace, record.id, currentPrefix.length + 1);
        const childPrefix = hash.slice(0, currentPrefix.length + 1);
        const child = children.get(childPrefix) ?? [];
        child.push(record);
        children.set(childPrefix, child);
      }
      for (const [childPrefix, child] of children) {
        prefixes.add(childPrefix);
        split(child, childPrefix);
      }
    };
    split(bucket, prefix);
  }
  return [...prefixes].sort((left, right) => left.length - right.length || left.localeCompare(right));
}

function recipeRecords(
  repository: DecodedRepository,
  typeId: string
): SharedRecord[] {
  return repository.recipes
    .filter((recipe) => recipe.recipeTypeId === typeId)
    .map((recipe) => ({ id: recipe.id, namespace: typeId, value: recipe }));
}

function goodsRecords(
  repository: DecodedRepository,
  recipeShardByRecipeId: ReadonlyMap<string, string>,
  specialGoodsIndex: ReadonlyMap<string, SharedSpecialGoodsIndexEntry>,
  iconSlots: ReadonlyMap<string, { sheetId: string; index: number }>
): SharedRecord[] {
  return [...repository.items, ...repository.fluids].map((goods) => {
    const { productionRecipeIds, usageRecipeIds, ...base } = goods;
    delete (base as Partial<typeof goods>).iconId;
    const value = {
      ...base,
      productionShards: [...new Set(productionRecipeIds.map((id) => recipeShardByRecipeId.get(id)))].filter(
        (id): id is string => id !== undefined
      ).sort(),
      usageShards: [...new Set(usageRecipeIds.map((id) => recipeShardByRecipeId.get(id)))].filter(
        (id): id is string => id !== undefined
      ).sort(),
      productionCount: productionRecipeIds.length,
      usageCount: usageRecipeIds.length,
      // Every format-5 goods record receives a fixed-shape icon reference;
      // use a representative cell here so partition sizing includes that
      // payload overhead without depending on a particular owner slot.
      icon: iconSlots.get(goods.id) ?? { sheetId: 'icons-000', index: 0 },
      specialProductionShards: specialGoodsIndex.get(goods.id)?.recipes.shardIds ?? [],
      specialUsageShards: specialGoodsIndex.get(goods.id)?.usages.shardIds ?? [],
      specialProductionLookupIds: specialGoodsIndex.get(goods.id)?.recipes.lookupIds ?? [],
      specialUsageLookupIds: specialGoodsIndex.get(goods.id)?.usages.lookupIds ?? [],
      specialProductionCount: specialGoodsIndex.get(goods.id)?.recipes.recordCount ?? 0,
      specialUsageCount: specialGoodsIndex.get(goods.id)?.usages.recordCount ?? 0
    };
    return {
      id: goods.id,
      namespace: 'goods',
      value: sharedGoodsStableValue(value)
    };
  });
}

function oreDictionaryRecords(
  repository: DecodedRepository,
  specialGoodsIndex: ReadonlyMap<string, SharedSpecialGoodsIndexEntry>
): SharedRecord[] {
  return repository.oreDictionaries.map((group) => {
    const special = specialGoodsIndex.get(group.id);
    return {
      id: group.id,
      namespace: 'oreDictionaries',
      value: {
        ...group,
        specialProductionShards: special?.recipes.shardIds ?? [],
        specialUsageShards: special?.usages.shardIds ?? [],
        specialProductionLookupIds: special?.recipes.lookupIds ?? [],
        specialUsageLookupIds: special?.usages.lookupIds ?? [],
        specialProductionCount: special?.recipes.recordCount ?? 0,
        specialUsageCount: special?.usages.recordCount ?? 0
      }
    };
  });
}

interface SharedSpecialGoodsDirection {
  shardIds: string[];
  lookupIds: string[];
  recordCount: number;
}

interface SharedSpecialGoodsIndexEntry {
  recipes: SharedSpecialGoodsDirection;
  usages: SharedSpecialGoodsDirection;
}

function emptySharedSpecialDirection(): {
  shardIds: Set<string>;
  lookupIds: Set<string>;
  recordCount: number;
} {
  return { shardIds: new Set(), lookupIds: new Set(), recordCount: 0 };
}

function sharedSpecialGoodsIndex(
  records: readonly SharedRecord[],
  specialViews: Readonly<Record<string, string[]>>,
  repositories: readonly DecodedRepository[]
): ReadonlyMap<string, SharedSpecialGoodsIndexEntry> {
  const mutable = new Map<string, {
    recipes: ReturnType<typeof emptySharedSpecialDirection>;
    usages: ReturnType<typeof emptySharedSpecialDirection>;
  }>();
  const shardByRecordId = new Map<string, string>();
  for (const record of records) {
    const prefixes = specialViews[record.namespace];
    if (!prefixes) continue;
    const prefix = [...prefixes]
      .filter((candidate) => sharedPartitionPrefix(record.namespace, record.id, SHARED_LAYOUT_MAX_PREFIX_NIBBLES).startsWith(candidate))
      .sort((left, right) => right.length - left.length)[0];
    if (prefix === undefined) continue;
    shardByRecordId.set(record.id, sharedLogicalId('special', record.namespace, prefix));
    const special = record.value as SpecialRecord;
    for (const direction of ['recipes', 'usages'] as const) {
      const goodsIds = specialGoodsForDirection(special, direction);
      for (const goodsId of goodsIds) {
        const entry = mutable.get(goodsId) ?? {
          recipes: emptySharedSpecialDirection(),
          usages: emptySharedSpecialDirection()
        };
        const projection = entry[direction];
        projection.recordCount++;
        projection.lookupIds.add(direction === 'recipes' ? special.recipesLookupId : special.usagesLookupId);
        const shardId = shardByRecordId.get(record.id);
        if (shardId) projection.shardIds.add(shardId);
        mutable.set(goodsId, entry);
      }
    }
  }

  // The builder projects group and generic-seed special records to their
  // concrete catalog members. Apply the same broad projection here so a
  // member added to the union cannot make the goods cap unexpectedly fail.
  const merge = (target: string, source: string): void => {
    const sourceEntry = mutable.get(source);
    if (!sourceEntry) return;
    const targetEntry = mutable.get(target) ?? {
      recipes: emptySharedSpecialDirection(),
      usages: emptySharedSpecialDirection()
    };
    for (const direction of ['recipes', 'usages'] as const) {
      targetEntry[direction].recordCount += sourceEntry[direction].recordCount;
      sourceEntry[direction].shardIds.forEach((id) => targetEntry[direction].shardIds.add(id));
      sourceEntry[direction].lookupIds.forEach((id) => targetEntry[direction].lookupIds.add(id));
    }
    mutable.set(target, targetEntry);
  };
  const groups = repositories.flatMap((repository) => [
    ...repository.oreDictionaries,
    ...repository.ingredientGroups
  ]);
  for (const group of groups) for (const itemId of group.itemIds) merge(itemId, group.id);
  const goods = repositories.flatMap((repository) => [...repository.items, ...repository.fluids]);
  const cropKeys = new Map<string, string[]>();
  for (const goodsEntry of goods) {
    if (goodsEntry.kind !== 'item' || goodsEntry.mod.toLocaleLowerCase() !== 'cropsnh'
      || goodsEntry.internalName !== 'genericSeed' || !goodsEntry.nbt) continue;
    const crop = goodsEntry.nbt.match(/(?:^|[,{}]\s*)crop\s*:\s*"([^"]+)"/i)?.[1]?.toLocaleLowerCase();
    if (!crop) continue;
    const members = cropKeys.get(crop) ?? [];
    members.push(goodsEntry.id);
    cropKeys.set(crop, members);
  }
  for (const members of cropKeys.values()) {
    const source = members.find((id) => mutable.has(id));
    if (source) for (const member of members) merge(member, source);
  }

  return new Map([...mutable.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, entry]) => [
    id,
    {
      recipes: {
        shardIds: [...entry.recipes.shardIds].sort(),
        lookupIds: [...entry.recipes.lookupIds].sort(),
        recordCount: entry.recipes.recordCount
      },
      usages: {
        shardIds: [...entry.usages.shardIds].sort(),
        lookupIds: [...entry.usages.lookupIds].sort(),
        recordCount: entry.usages.recordCount
      }
    }
  ]));
}

function specialRecords(data: SpecialData | undefined): SharedRecord[] {
  return (data?.records ?? []).map((record) => ({
    id: record.id,
    namespace: record.category,
    value: record
  }));
}

function recipeBucket(logicalId: string, prefix: string, records: readonly SharedRecord[]): unknown {
  return {
    schemaVersion: 5,
    kind: 'recipeShard',
    logicalId,
    recipeTypeId: records[0]?.namespace,
    prefix,
    recipes: records.map((record) => record.value as DecodedRecipe)
  };
}

function goodsBucket(logicalId: string, prefix: string, records: readonly SharedRecord[]): unknown {
  return {
    schemaVersion: 5,
    kind: 'goods',
    logicalId,
    prefix,
    goods: records.map((record) => record.value)
  };
}

function oreDictionaryBucket(logicalId: string, prefix: string, records: readonly SharedRecord[]): unknown {
  return {
    schemaVersion: 5,
    kind: 'oreDictionaries',
    logicalId,
    prefix,
    oreDictionaries: records.map((record) => record.value)
  };
}

function specialBucket(logicalId: string, prefix: string, records: readonly SharedRecord[]): unknown {
  return {
    schemaVersion: 5,
    kind: 'special',
    logicalId,
    specialViewTypeId: records[0]?.namespace,
    prefix,
    records: records.map((record) => record.value as SpecialRecord)
  };
}

function recipeShardLogicalId(namespace: string, prefix: string): string {
  return sharedLogicalId('recipes', namespace, prefix);
}

function specialShardLogicalId(namespace: string, prefix: string): string {
  return sharedLogicalId('special', namespace, prefix);
}

function goodsLogicalId(_namespace: string, prefix: string): string {
  return `catalog-goods-${prefix || 'root'}`;
}

function oreDictionaryLogicalId(_namespace: string, prefix: string): string {
  return `catalog-ore-dictionaries-${prefix || 'root'}`;
}

function extendIconSlots(
  previous: readonly string[],
  repositories: readonly DecodedRepository[]
): string[] {
  const nextOwners = [...previous];
  const known = new Set(nextOwners);
  const owners = new Set(repositories.flatMap((repository) => iconOwners(repository).map((owner) => owner.id)));
  for (const ownerId of [...owners].sort()) {
    if (known.has(ownerId)) continue;
    nextOwners.push(ownerId);
    known.add(ownerId);
  }
  return nextOwners;
}

/**
 * Build the first persistent layout from the union of the supplied datasets.
 * Later builds should read this file and only increase a namespace's depth;
 * the builder never merges an already-published partition.
 */
export function buildSharedLayout(
  repositories: readonly DecodedRepository[],
  specialDataValues: readonly (SpecialData | undefined)[],
  targets: SharedLayoutTargets = DEFAULT_SHARED_LAYOUT_TARGETS
): SharedPartitionLayout {
  if (repositories.length === 0) throw new Error('At least one repository is required for a shared layout');
  const stableRepositories = repositories.map(sharedRepository);
  const oversizedSingletons: SharedOversizedSingleton[] = [];
  const iconOwners = buildIconOwners(stableRepositories);
  const iconSlots = sharedIconSlots(iconOwners);
  const typeIds = new Set(stableRepositories.flatMap((repository) => repository.recipeTypes.map((type) => type.id)));
  const recipeTypes: Record<string, string[]> = {};
  for (const typeId of [...typeIds].sort()) {
    const records = uniqueSharedRecords(stableRepositories.flatMap((repository) => recipeRecords(repository, typeId)));
    recipeTypes[typeId] = records.length === 0
      ? ['']
      : partitionPrefixesForRecords(records, targets.recipes, recipeBucket, recipeShardLogicalId);
    oversizedSingletons.push(...oversizedSingletonsForRecords(
      records,
      recipeTypes[typeId],
      targets.recipes,
      recipeBucket,
      recipeShardLogicalId
    ));
  }
  const recipeShardByRecipeId = new Map<string, string>();
  for (const repository of stableRepositories) {
    for (const type of repository.recipeTypes) {
      const prefixes = recipeTypes[type.id]!;
      const records = recipeRecords(repository, type.id);
      for (const [prefix, bucket] of groupSharedRecords(records, prefixes)) {
        const logicalId = sharedLogicalId('recipes', type.id, prefix);
        for (const record of bucket) recipeShardByRecipeId.set(record.id, logicalId);
      }
    }
  }
  const allSpecial = uniqueSharedRecords(specialDataValues.flatMap(specialRecords));
  const viewIds = new Set([
    ...allSpecial.map((record) => record.namespace),
    ...specialDataValues.flatMap((data) => data ? buildSpecialViewTypes(data).map((view) => view.id) : [])
  ]);
  const specialViews: Record<string, string[]> = {};
  for (const viewId of [...viewIds].sort()) {
    const records = allSpecial.filter((record) => record.namespace === viewId);
    specialViews[viewId] = records.length === 0
      ? ['']
      : partitionPrefixesForRecords(records, targets.special, specialBucket, specialShardLogicalId);
    oversizedSingletons.push(...oversizedSingletonsForRecords(
      records,
      specialViews[viewId],
      targets.special,
      specialBucket,
      specialShardLogicalId
    ));
  }
  const specialGoodsIndex = sharedSpecialGoodsIndex(allSpecial, specialViews, stableRepositories);
  const allOreDictionaries = uniqueSharedRecords(stableRepositories.map((repository) => oreDictionaryRecords(
    repository,
    specialGoodsIndex
  )).flat());
  const oreDictionaries = allOreDictionaries.length === 0
    ? ['']
    : partitionPrefixesForRecords(allOreDictionaries, targets.oreDictionaries, oreDictionaryBucket, oreDictionaryLogicalId);
  oversizedSingletons.push(...oversizedSingletonsForRecords(
    allOreDictionaries,
    oreDictionaries,
    targets.oreDictionaries,
    oreDictionaryBucket,
    oreDictionaryLogicalId
  ));
  const allGoods = uniqueSharedRecords(stableRepositories.map((repository) => goodsRecords(
    repository,
    recipeShardByRecipeId,
    specialGoodsIndex,
    iconSlots
  )).flat());
  const goods = allGoods.length === 0
    ? ['']
    : partitionPrefixesForRecords(allGoods, targets.goods, goodsBucket, goodsLogicalId);
  oversizedSingletons.push(...oversizedSingletonsForRecords(
    allGoods,
    goods,
    targets.goods,
    goodsBucket,
    goodsLogicalId
  ));
  return {
    schemaVersion: SHARED_LAYOUT_SCHEMA_VERSION,
    targets,
    recipeTypes,
    goods,
    oreDictionaries,
    specialViews,
    iconOwners,
    oversizedSingletons
  };
}

/**
 * Extend a published layout without rebuilding it. Existing prefixes and
 * icon cells remain valid forever; only descendants or leaves for previously
 * uncovered records are appended. Targets are intentionally taken from the
 * published layout so a later build cannot silently rebalance the tree.
 */
export function extendSharedLayout(
  previous: SharedPartitionLayout,
  repositories: readonly DecodedRepository[],
  specialDataValues: readonly (SpecialData | undefined)[]
): SharedPartitionLayout {
  validateSharedLayout(previous);
  if (repositories.length === 0) throw new Error('At least one repository is required for a shared layout');
  const stableRepositories = repositories.map(sharedRepository);
  const oversizedSingletons = [...(previous.oversizedSingletons ?? [])];
  const iconOwners = extendIconSlots(previous.iconOwners ?? [], stableRepositories);
  const iconSlots = sharedIconSlots(iconOwners);
  const typeIds = new Set(stableRepositories.flatMap((repository) => repository.recipeTypes.map((type) => type.id)));
  const recipeTypes: Record<string, string[]> = { ...previous.recipeTypes };
  for (const typeId of [...typeIds].sort()) {
    const records = uniqueSharedRecords(stableRepositories.flatMap((repository) => recipeRecords(repository, typeId)));
    const old = recipeTypes[typeId];
    recipeTypes[typeId] = old
      ? extendPartitionPrefixes(old, records, previous.targets.recipes, recipeBucket, recipeShardLogicalId)
      : records.length === 0
        ? ['']
        : partitionPrefixesForRecords(records, previous.targets.recipes, recipeBucket, recipeShardLogicalId);
    oversizedSingletons.push(...oversizedSingletonsForRecords(
      records,
      recipeTypes[typeId],
      previous.targets.recipes,
      recipeBucket,
      recipeShardLogicalId
    ));
  }

  const recipeShardByRecipeId = new Map<string, string>();
  for (const repository of stableRepositories) {
    for (const type of repository.recipeTypes) {
      const prefixes = recipeTypes[type.id]!;
      for (const [prefix, bucket] of groupSharedRecords(recipeRecords(repository, type.id), prefixes)) {
        const logicalId = sharedLogicalId('recipes', type.id, prefix);
        for (const record of bucket) recipeShardByRecipeId.set(record.id, logicalId);
      }
    }
  }
  const specialViews: Record<string, string[]> = { ...previous.specialViews };
  const allSpecial = uniqueSharedRecords(specialDataValues.flatMap(specialRecords));
  const viewIds = new Set([
    ...allSpecial.map((record) => record.namespace),
    ...specialDataValues.flatMap((data) => data ? buildSpecialViewTypes(data).map((view) => view.id) : [])
  ]);
  for (const viewId of viewIds) {
    const records = allSpecial.filter((record) => record.namespace === viewId);
    const old = specialViews[viewId];
    specialViews[viewId] = old
      ? extendPartitionPrefixes(old, records, previous.targets.special, specialBucket, specialShardLogicalId)
        : records.length === 0
          ? ['']
          : partitionPrefixesForRecords(records, previous.targets.special, specialBucket, specialShardLogicalId);
    oversizedSingletons.push(...oversizedSingletonsForRecords(
      records,
      specialViews[viewId],
      previous.targets.special,
      specialBucket,
      specialShardLogicalId
    ));
  }
  const specialGoodsIndex = sharedSpecialGoodsIndex(allSpecial, specialViews, stableRepositories);
  const allOreDictionaries = uniqueSharedRecords(stableRepositories.map((repository) => oreDictionaryRecords(
    repository,
    specialGoodsIndex
  )).flat());
  const oreDictionaries = extendPartitionPrefixes(
    previous.oreDictionaries,
    allOreDictionaries,
    previous.targets.oreDictionaries,
    oreDictionaryBucket,
    oreDictionaryLogicalId
  );
  oversizedSingletons.push(...oversizedSingletonsForRecords(
    allOreDictionaries,
    oreDictionaries,
    previous.targets.oreDictionaries,
    oreDictionaryBucket,
    oreDictionaryLogicalId
  ));
  const allGoods = uniqueSharedRecords(stableRepositories.map((repository) => goodsRecords(
    repository,
    recipeShardByRecipeId,
    specialGoodsIndex,
    iconSlots
  )).flat());
  const goods = extendPartitionPrefixes(previous.goods, allGoods, previous.targets.goods, goodsBucket, goodsLogicalId);
  oversizedSingletons.push(...oversizedSingletonsForRecords(
    allGoods,
    goods,
    previous.targets.goods,
    goodsBucket,
    goodsLogicalId
  ));

  return {
    ...previous,
    recipeTypes,
    goods,
    oreDictionaries,
    specialViews,
    iconOwners,
    oversizedSingletons: [...new Map(oversizedSingletons.map((entry) => [
      `${entry.namespace}\0${entry.prefix}`,
      entry
    ])).values()]
  };
}

export function validateSharedLayout(layout: SharedPartitionLayout): void {
  if (layout.schemaVersion !== SHARED_LAYOUT_SCHEMA_VERSION) {
    throw new Error(`Unsupported shared layout schema ${layout.schemaVersion}`);
  }
  validateSharedPrefixLayout(sharedPrefixLayout(layout));
  if (!Array.isArray(layout.iconOwners)) throw new Error('Shared layout is missing icon owners');
  const owners = new Set<string>();
  for (const ownerId of layout.iconOwners) {
    if (typeof ownerId !== 'string' || ownerId.length === 0 || owners.has(ownerId)) {
      throw new Error(`Invalid or duplicate shared icon owner ${String(ownerId)}`);
    }
    owners.add(ownerId);
  }
  for (const singleton of layout.oversizedSingletons ?? []) {
    if (!singleton || typeof singleton.namespace !== 'string'
      || !/^[0-9a-f]{0,8}$/.test(singleton.prefix)
      || !Number.isInteger(singleton.estimatedBytes)
      || singleton.estimatedBytes < 0) {
      throw new Error('Invalid oversized singleton diagnostic');
    }
  }
}
