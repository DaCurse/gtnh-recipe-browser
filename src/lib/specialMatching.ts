/** Return the explicit goods direction when supplied by an adapter extension. */
export function specialGoodsForDirection(
  record: { goodsIds?: readonly string[]; productionGoodsIds?: readonly string[]; usageGoodsIds?: readonly string[]; payload: unknown },
  direction: 'recipes' | 'usages'
): string[] {
  const extensionKey = direction === 'recipes' ? 'productionGoodsIds' : 'usageGoodsIds';
  const extension = record[extensionKey];
  const ids = new Set<string>(
    Array.isArray(extension) && extension.every((value) => typeof value === 'string')
      ? extension
      : record.goodsIds ?? []
  );
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.endsWith('goodsid') && typeof child === 'string') ids.add(child);
      if (normalizedKey.endsWith('goodsids') && Array.isArray(child)) {
        child.filter((candidate): candidate is string => typeof candidate === 'string')
          .forEach((candidate) => ids.add(candidate));
      }
      visit(child);
    }
  };
  visit(record.payload);
  return [...ids].sort();
}

/** Mirror the export's registered-group aliases without broadening GT host-ore matching. */
export function specialGroupMatchesItem(
  groupId: string,
  item: { kind?: string; mod: string; internalName?: string }
): boolean {
  return !groupId.startsWith('o:ore') || (item.kind === 'item'
    && item.mod.toLocaleLowerCase() === 'gregtech'
    && (item.internalName?.toLocaleLowerCase().startsWith('gt.blockores') ?? false));
}
