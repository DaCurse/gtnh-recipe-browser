<script lang="ts">
  import type { Snippet } from 'svelte';
  let { x, y, interactive = false, anchor, children }: {
    x: number; y: number; interactive?: boolean; anchor?: DOMRect; children: Snippet;
  } = $props();
  let element = $state<HTMLDivElement>();
  let viewportWidth = $state(0), viewportHeight = $state(0), width = $state(0), height = $state(0);
  const position = $derived.by(() => {
    const gap = 14, edge = 12;
    if (interactive && anchor) {
      const below = viewportHeight - anchor.bottom - gap - edge, above = anchor.top - gap - edge;
      const useBelow = below >= above;
      const available = Math.max(48, useBelow ? below : above);
      const left = Math.max(edge, Math.min(anchor.left, viewportWidth - width - edge));
      const top = useBelow ? anchor.bottom + gap : Math.max(edge, anchor.top - gap - Math.min(height, available));
      return `left:${left}px;top:${top}px;max-height:${available}px`;
    }
    let left = x + gap, top = y + gap;
    if (left + width > viewportWidth - edge) left = Math.max(edge, x - gap - width);
    if (top + height > viewportHeight - edge) top = Math.max(edge, y - gap - height);
    left = Math.min(Math.max(edge, left), Math.max(edge, viewportWidth - edge - width));
    top = Math.min(Math.max(edge, top), Math.max(edge, viewportHeight - edge - height));
    return `left:${left}px;top:${top}px`;
  });
  $effect(() => {
    if (!element) return;
    const rect = element.getBoundingClientRect(); width = rect.width; height = rect.height;
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
<div class="floating-tooltip" class:touch-tooltip={interactive} style={position} style:visibility={width > 0 ? 'visible' : 'hidden'} bind:this={element}>
  {@render children()}
</div>
<style>
  .floating-tooltip { position:fixed; z-index:2000; width:min(460px,calc(100vw - 24px)); pointer-events:none; text-align:left; }
  .floating-tooltip :global(.minecraft-tooltip) { width:100%; max-height:min(70vh,620px); }
  .touch-tooltip { pointer-events:auto; overflow:auto; overscroll-behavior:contain; }
  .touch-tooltip :global(.minecraft-tooltip) { max-height:none; overflow:visible; }
</style>
