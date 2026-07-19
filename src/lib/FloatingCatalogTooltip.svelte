<script lang="ts">
  import CatalogTooltip from './CatalogTooltip.svelte';
  import type { CatalogEntry } from './types';

  let {
    entry,
    x,
    y,
    action
  }: {
    entry: CatalogEntry;
    x: number;
    y: number;
    action: string;
  } = $props();

  let element: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
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

<div class="floating-tooltip" style={position} bind:this={element}>
  <CatalogTooltip {entry} {action} />
</div>

<style>
  .floating-tooltip { position:fixed; z-index:2000; width:min(460px,calc(100vw - 24px)); pointer-events:none; text-align:left; }
  .floating-tooltip :global(.minecraft-tooltip) { width:100%; max-height:min(70vh,620px); }
</style>
