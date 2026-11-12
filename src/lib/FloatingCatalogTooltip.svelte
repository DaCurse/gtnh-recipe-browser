<script lang="ts">
  import CatalogTooltip from './CatalogTooltip.svelte';
  import TooltipSkeleton from './TooltipSkeleton.svelte';
  import { useCatalogEntry } from './catalogEntryLoad.svelte';
  import type { CatalogEntry } from './types';

  let {
    entry,
    x,
    y,
    action,
    notes,
    interactive = false,
    anchor
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

  let element = $state<HTMLDivElement>();
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let width = $state(0);
  let height = $state(0);
  // Delay a crossed icon, but never paint a catalogue stub before formatting arrives.
  const detail = useCatalogEntry(() => entry.id, 100);
  const displayEntry = $derived(!detail.active ? entry : detail.loading || detail.error ? undefined : detail.entry);
  const position = $derived.by(() => {
    if (typeof window === 'undefined') return '';
    const gap = 14;
    const edge = 12;
    if (interactive && anchor) {
      const below = viewportHeight - anchor.bottom - gap - edge;
      const above = anchor.top - gap - edge;
      const useBelow = below >= above;
      const available = Math.max(48, useBelow ? below : above);
      const left = Math.max(edge, Math.min(anchor.left, viewportWidth - width - edge));
      const top = useBelow ? anchor.bottom + gap : Math.max(edge, anchor.top - gap - Math.min(height, available));
      return `left:${left}px;top:${top}px;max-height:${available}px`;
    }
    let left = x + gap;
    let top = y + gap;
    if (left + width > viewportWidth - edge) {
      left = Math.max(edge, x - gap - width);
    }
    if (top + height > viewportHeight - edge) {
      top = Math.max(edge, y - gap - height);
    }
    left = Math.min(Math.max(edge, left), Math.max(edge, viewportWidth - edge - width));
    top = Math.min(Math.max(edge, top), Math.max(edge, viewportHeight - edge - height));
    return `left:${left}px;top:${top}px`;
  });

  $effect(() => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([observed]) => {
      width = observed.borderBoxSize[0]?.inlineSize ?? observed.contentRect.width;
      height = observed.borderBoxSize[0]?.blockSize ?? observed.contentRect.height;
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

{#if displayEntry || interactive}
<div class="floating-tooltip" class:touch-tooltip={interactive} style={position} style:visibility={width > 0 ? 'visible' : 'hidden'} bind:this={element}>
  {#if displayEntry}<CatalogTooltip entry={displayEntry} {action} {notes} />
  {:else if detail.error}<div class="touch-status" role="status">Item info could not be loaded. <button class="mc-button" onclick={() => detail.retry()}>Retry</button></div>
  {:else}<TooltipSkeleton />{/if}
</div>
{/if}

<style>
  .floating-tooltip { position:fixed; z-index:2000; width:min(460px,calc(100vw - 24px)); pointer-events:none; text-align:left; }
  .floating-tooltip :global(.minecraft-tooltip) { width:100%; max-height:min(70vh,620px); }
  .touch-tooltip { pointer-events:auto; overflow:auto; overscroll-behavior:contain; }
  .touch-tooltip :global(.minecraft-tooltip) { max-height:none; overflow:visible; }
  .touch-status { padding:14px; color:#eee; background:#1c1020; border:2px solid #593286; }
</style>
