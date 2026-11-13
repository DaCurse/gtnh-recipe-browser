<script lang="ts">
  import { onMount } from 'svelte';
  import ItemIcon from '../ItemIcon.svelte';
  import CatalogVariantIcon from '../CatalogVariantIcon.svelte';
  import type { CatalogBrowseEntry, CatalogEntry } from '../types';
  let {
    entry,
    entries,
    size = 32,
    renderScale = 1,
  }: {
    entry?: CatalogEntry;
    entries?: ReadonlyMap<string, CatalogEntry>;
    size?: number;
    renderScale?: number;
  } = $props();
  const members = $derived(entry?.members?.filter((id) => entries?.get(id)?.icon) ?? []);
  const family = $derived(
    entry?.kind === 'oreDict' && members.length
      ? ({
          ...entry,
          variantKind: 'exact',
          variantIds: members,
          variantCount: members.length,
        } satisfies CatalogBrowseEntry)
      : undefined,
  );
  let element: HTMLSpanElement;
  let visible = $state(false);
  onMount(() => {
    if (!('IntersectionObserver' in window)) {
      visible = true;
      return;
    }
    const observer = new IntersectionObserver(
      ([observation]) => {
        if (observation.isIntersecting) {
          visible = true;
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<span
  class="quest-icon"
  bind:this={element}
  style:width={`${size}px`}
  style:height={`${size}px`}
  aria-hidden="true"
>
  {#if visible && family && entries}<CatalogVariantIcon
      entry={family}
      exactEntries={entries}
      {size}
      bare
      frame={false}
      {renderScale}
    />
  {:else if visible && entry}<ItemIcon
      {entry}
      {size}
      bare
      frame={false}
      {renderScale}
    />{:else if visible}<span class="missing">?</span>{/if}
</span>

<style>
  .quest-icon {
    display: inline-grid;
    place-items: center;
    flex: none;
    pointer-events: none;
  }
  .missing {
    color: #888;
    font: 16px Minecraft;
  }
</style>
