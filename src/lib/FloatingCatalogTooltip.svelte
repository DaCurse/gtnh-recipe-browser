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

  let element: HTMLDivElement;
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
    if (left + width > window.innerWidth - edge) {
      left = Math.max(edge, x - gap - width);
    }
    if (top + height > window.innerHeight - edge) {
      top = Math.max(edge, y - gap - height);
    }
    return `left:${left}px;top:${top}px`;
  });

  $effect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([observed]) => {
      width = observed.borderBoxSize[0]?.inlineSize ?? observed.contentRect.width;
      height = observed.borderBoxSize[0]?.blockSize ?? observed.contentRect.height;
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

{#if displayEntry}
<div class="floating-tooltip" style={position} bind:this={element}>
  <CatalogTooltip entry={displayEntry} {action} {notes} />
</div>
{/if}

<style>
  .floating-tooltip { position:fixed; z-index:2000; width:min(460px,calc(100vw - 24px)); pointer-events:none; text-align:left; }
  .floating-tooltip :global(.minecraft-tooltip) { width:100%; max-height:min(70vh,620px); }
</style>
