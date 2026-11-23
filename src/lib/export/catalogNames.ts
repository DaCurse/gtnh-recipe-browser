/**
 * A catalog reference is represented by its stable ID and its resolved name.
 * The exporter uses this helper only at fields whose domain is a catalog
 * reference; it deliberately does not infer references from property names.
 */
export type NamedCatalogObject<T extends object> = T & { name: string };

export function catalogNameForId(
  id: string,
  names: ReadonlyMap<string, string>,
  fallback?: string,
): string {
  return names.get(id) ?? fallback ?? id;
}

export function withCatalogName<T extends object>(
  value: T,
  id: string,
  names: ReadonlyMap<string, string>,
  fallback?: string,
): NamedCatalogObject<T> {
  const existingName = (value as { name?: unknown }).name;
  return {
    ...value,
    name: catalogNameForId(id, names, typeof existingName === 'string' ? existingName : fallback),
  };
}

export function namesForIds(
  ids: readonly string[] | undefined,
  names: ReadonlyMap<string, string>,
): string[] | undefined {
  return ids?.map((id) => catalogNameForId(id, names));
}
