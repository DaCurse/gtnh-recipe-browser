<script lang="ts">
  import { onMount } from 'svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { resolveCatalogVariant } from './catalogVariants';
  import { oreCycle } from './oreCycle';
  import type { CatalogBrowseEntry, CatalogEntry } from './types';

  let {
    entry,
    exactEntries,
    size = 56,
    selected = false
  }: {
    entry: CatalogBrowseEntry;
    exactEntries: ReadonlyMap<string, CatalogEntry>;
    size?: number;
    selected?: boolean;
  } = $props();

  let element: HTMLSpanElement;
  let visible = $state(false);
  let cycle = $state(0);
  const displayEntry = $derived(resolveCatalogVariant(entry, exactEntries, cycle));

  $effect(() => {
    if (!entry.isVariantGroup || !visible) return;
    return oreCycle.subscribe((value) => cycle = value);
  });

  onMount(() => {
    if (!entry.isVariantGroup || !('IntersectionObserver' in window)) {
      visible = true;
      return;
    }
    const root = element.closest('.item-grid');
    const observer = new IntersectionObserver(([observed]) => {
      visible = observed?.isIntersecting ?? false;
    }, { root, rootMargin: '120px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<span
  class="catalog-variant-icon"
  style:width={`${size}px`}
  style:height={`${size}px`}
  aria-hidden="true"
  bind:this={element}
>
  <ItemIcon entry={displayEntry} {size} {selected} />
</span>

<style>
  .catalog-variant-icon {
    display: block;
    flex: 0 0 auto;
  }
</style>
