<script lang="ts">
  import CatalogTooltipContent from './CatalogTooltipContent.svelte';
  import FloatingTooltip from './FloatingTooltip.svelte';
  import { useCatalogEntry } from './catalogEntryLoad.svelte';
  import type { CatalogEntry } from './types';

  let {
    entry,
    x,
    y,
    action,
    notes,
    interactive = false,
    anchor,
  }: {
    entry: CatalogEntry;
    x: number;
    y: number;
    action?: string;
    /** Additional plain-text lines supplied by a specialized goods view. */
    notes?: readonly string[];
    interactive?: boolean;
    anchor?: DOMRect;
  } = $props();

  const detail = useCatalogEntry(() => entry.id);
</script>

<FloatingTooltip {x} {y} {interactive} {anchor}>
  <CatalogTooltipContent
    entry={detail.entry ?? entry}
    loading={detail.loading}
    error={detail.error}
    retry={() => detail.retry()}
    {action}
    {notes}
  />
</FloatingTooltip>
