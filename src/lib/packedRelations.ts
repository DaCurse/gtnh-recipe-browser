import { assetDigest } from './integrity';

export interface PackedRelationList { id: string; values: string[] }

const listFields = ['productionShards', 'usageShards', 'specialProductionShards', 'specialUsageShards',
  'specialProductionLookupIds', 'specialUsageLookupIds', 'productionMatchIds', 'usageMatchIds',
  'specialProductionMatchIds', 'specialUsageMatchIds', 'oreDictionaryIds', 'containerItemIds', 'itemIds'];

/** Intern repeated relation lists as independently reusable, complete records. */
export function compactRelations(records: readonly Record<string, unknown>[], namespace = ''): {
  records: Record<string, unknown>[]; lists: PackedRelationList[];
} {
  const lists = new Map<string, string[]>();
  const frequencies = new Map<string, number>();
  for (const record of records) for (const field of listFields) {
    const list = record[field];
    if (!Array.isArray(list) || list.length < 2) continue;
    const key = JSON.stringify(list);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const compact = records.map((record) => {
    const value = { ...record };
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined || (key.endsWith('Count') && child === 0)
        || ((key === 'specialProductionCounts' || key === 'specialUsageCounts')
          && child && typeof child === 'object' && Object.keys(child).length === 0)) delete value[key];
    }
    const refs: Record<string, string> = {};
    for (const field of listFields) {
      const list = value[field];
      if (!Array.isArray(list)) continue;
      delete value[field];
      if (list.length === 0) continue;
      if (field.endsWith('MatchIds') && list.length === 1 && list[0] === record.id) continue;
      const encoded = JSON.stringify(list);
      if ((frequencies.get(encoded) ?? 0) < 2 || encoded.length < 128) {
        value[field] = list;
        continue;
      }
      const id = assetDigest(new TextEncoder().encode(namespace + '\0' + encoded)).slice(0, 16);
      const previous = lists.get(id);
      if (previous && JSON.stringify(previous) !== encoded) throw new Error('Relation fingerprint collision');
      lists.set(id, list as string[]);
      refs[field] = id;
    }
    if (Object.keys(refs).length) value.listRefs = refs;
    return value;
  });
  return { records: compact, lists: [...lists].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, values]) => ({ id, values })) };
}

export function expandRelations<T extends { id: string }>(
  records: readonly T[], lists: readonly PackedRelationList[] = []
): T[] {
  const values = new Map(lists.map((list) => [list.id, list.values]));
  return records.map((record) => {
    const result = { ...record } as T & Record<string, unknown>;
    const refs = result.listRefs as Record<string, string> | undefined;
    for (const field of listFields) {
      const reference = refs?.[field];
      const list = reference ? values.get(reference) : undefined;
      if (reference && !list) throw new Error(`${record.id}: missing relation list ${reference}`);
      (result as Record<string, unknown>)[field] = list ?? result[field] ?? (field.endsWith('MatchIds') ? [record.id] : []);
    }
    delete result.listRefs;
    if ('itemIds' in record || refs?.itemIds) {
      const members = result.itemIds as string[];
      for (const field of listFields.filter((field) => field.endsWith('MatchIds'))) {
        if (!(field in record) && !refs?.[field]) {
          (result as Record<string, unknown>)[field] = field.startsWith('special') ? [record.id, ...members] : members;
        }
      }
    }
    return result;
  });
}
