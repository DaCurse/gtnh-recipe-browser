<script lang="ts">
  import CatalogTooltipContent from './CatalogTooltipContent.svelte';
  import FloatingTooltip from './FloatingTooltip.svelte';
  import { useCatalogEntry } from '../items/catalogEntryLoad.svelte';
  import type { CatalogEntry } from '../types';

  let {
    entry,
    x,
    y,
    action,
    notes,
    colorScores,
    interactive = false,
    anchor,
    onPointerPresence,
  }: {
    entry: CatalogEntry;
    x: number;
    y: number;
    action?: string;
    /** Additional plain-text lines supplied by a specialized goods view. */
    notes?: readonly string[];
    colorScores?: string;
    interactive?: boolean;
    anchor?: DOMRect;
    onPointerPresence?: (inside: boolean) => void;
  } = $props();

  const detail = useCatalogEntry(() => entry.id);
</script>

<FloatingTooltip
  {x}
  {y}
  {interactive}
  {anchor}
  {onPointerPresence}
  widthLimit={colorScores ? 620 : undefined}
>
  <CatalogTooltipContent
    entry={detail.entry ?? entry}
    loading={detail.loading}
    error={detail.error}
    retry={() => detail.retry()}
    {action}
    {notes}
    {colorScores}
  />
</FloatingTooltip>
