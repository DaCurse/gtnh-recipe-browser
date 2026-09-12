import type { SpecialViewType } from './specialData';
import type { CatalogEntry } from './types';

export interface SpecialContextServiceIcon {
  label: string;
  goodsId?: string;
  icon?: CatalogEntry['icon'] | null;
}

/** Build the catalog-shaped faux item shown while browsing a global special view. */
export function createSpecialContextEntry(
  source: CatalogEntry,
  viewType: SpecialViewType,
  serviceIcon?: SpecialContextServiceIcon,
  iconEntry?: CatalogEntry
): CatalogEntry {
  const label = (viewType.shortLabel ?? viewType.label) || viewType.id;
  const name = `All ${label}`;
  return {
    id: `special:${viewType.id}`,
    name,
    rawName: name,
    mod: 'NEI Special Data',
    kind: 'item',
    internalName: viewType.id,
    unlocalizedName: viewType.id,
    tooltip: [
      `Global context: showing all ${label.toLocaleLowerCase()} in this dataset.`,
      'Use the category icon on a card to return to this item.'
    ],
    rawTooltip: null,
    tooltipLayout: 'compact',
    color: iconEntry?.color ?? source.color,
    glyph: iconEntry?.glyph ?? viewType.glyph ?? serviceIcon?.label.slice(0, 1) ?? source.glyph,
    ...(iconEntry?.icon ?? serviceIcon?.icon
      ? { icon: iconEntry?.icon ?? serviceIcon?.icon ?? undefined }
      : {}),
    searchable: false
  };
}
