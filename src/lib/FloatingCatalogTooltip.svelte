<script lang="ts">
  import { untrack } from 'svelte';
  import CatalogTooltip from './CatalogTooltip.svelte';
  import type { CatalogEntry } from './types';

  let {
    entry,
    x,
    y,
    action,
    notes,
    hydrate
  }: {
    entry: CatalogEntry;
    x: number;
    y: number;
    action?: string;
    /** Additional plain-text lines supplied by a specialized goods view. */
    notes?: readonly string[];
    hydrate?: (id: string, signal: AbortSignal) => Promise<CatalogEntry | undefined>;
  } = $props();

  let element = $state<HTMLDivElement>();
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let width = $state(0);
  let height = $state(0);
  let hydrated = $state<CatalogEntry>();
  const entryId = $derived(entry.id);
  const displayEntry = $derived(hydrate ? hydrated?.id === entry.id ? hydrated : undefined : entry);
  $effect(() => {
    const id = entryId;
    const current = untrack(() => entry);
    const load = hydrate;
    hydrated = undefined;
    if (!load) return;
    const controller = new AbortController();
    // Avoid downloading detail partitions when the pointer only crosses an icon.
    const timer = setTimeout(() => {
      void load(id, controller.signal).then((detail) => {
        if (!controller.signal.aborted) hydrated = detail ?? current;
      }).catch(() => {
        // A failed/offline load may show the fallback once, without later recolouring.
        if (!controller.signal.aborted) hydrated = current;
      });
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  });
  const position = $derived.by(() => {
    if (typeof window === 'undefined') return '';
    const gap = 14;
    const edge = 12;
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

{#if displayEntry}
<div class="floating-tooltip" style={position} style:visibility={width > 0 ? 'visible' : 'hidden'} bind:this={element}>
  <CatalogTooltip entry={displayEntry} {action} {notes} />
</div>
{/if}

<style>
  .floating-tooltip { position:fixed; z-index:2000; width:min(460px,calc(100vw - 24px)); pointer-events:none; text-align:left; }
  .floating-tooltip :global(.minecraft-tooltip) { width:100%; max-height:min(70vh,620px); }
</style>
