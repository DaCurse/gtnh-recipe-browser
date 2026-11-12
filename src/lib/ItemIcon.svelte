<script lang="ts">
  import { untrack } from 'svelte';
  import IconSkeleton from './IconSkeleton.svelte';
  import { resolveRenderedIcon, supportsHighResolutionIcon, cachedRenderedIcon, iconIdentity, iconRenderKey } from './highResolutionIcons';
  import { resolveCachedIconSheetUrl, decodeIconSheetUrl } from './iconCache';
  import type { RenderedIcon } from './highResolutionIcons';
  import type { CatalogBrowseEntry, CatalogEntry } from './types';
  let { entry, size = 48, selected = false, bare = false, frame = true, renderScale = 1 }: { entry: CatalogEntry; size?: number; selected?: boolean; bare?: boolean; frame?: boolean; renderScale?: number } = $props();
  let presentation = $state.raw<{ identity:string; value:RenderedIcon }>();
  const spriteSize = $derived(Math.max(1, size - 2 * Math.round(size * (bare ? 0.075 : 1 / 18))));
  const owner = $derived(entry.icon?.ownerId ?? (/^[if]:/.test(entry.id) ? entry.id : (entry as Partial<CatalogBrowseEntry>).variantIds?.[0] ?? entry.id));
  const identity = $derived(entry.icon ? iconIdentity(entry.icon,owner) : '');
  const requestKey = $derived(entry.icon ? iconRenderKey(entry.icon,owner,spriteSize * renderScale) : '');
  const rendered = $derived(presentation?.identity === identity ? presentation.value : cachedRenderedIcon(requestKey));

  $effect(() => {
    const key = requestKey;
    const currentIdentity = identity;
    const [icon, ownerId, displayedPixels, previous] = untrack(() => [entry.icon,owner,spriteSize * renderScale,presentation] as const);
    if (!icon) return;
    const ready = cachedRenderedIcon(key);
    if (ready && (!previous || previous.identity !== currentIdentity || ready.resolution >= previous.value.resolution)) {
      presentation = {identity:currentIdentity,value:ready};
    }
    if (ready?.resolution === 64 || previous?.identity === currentIdentity && previous.value.resolution === 64) return;
    let active = true;
    // Cached base sheets may appear once on a cold load. Never replace a
    // displayed sprite with a skeleton or downgrade an already sharp sprite.
    if (supportsHighResolutionIcon(icon,displayedPixels) && !ready) {
      void resolveCachedIconSheetUrl(icon).then(async url => {
        if (!url) return;
        await decodeIconSheetUrl(url);
        if (active && !untrack(() => presentation?.identity === currentIdentity)) {
          presentation = {identity:currentIdentity,value:{url,index:icon.index,columns:icon.columns,resolution:32}};
        }
      }).catch(() => {});
    }
    void resolveRenderedIcon(icon,ownerId,displayedPixels).then(value => {
      if (active) presentation = {identity:currentIdentity,value};
    }).catch(() => { /* Keep a ready fallback if a sheet is temporarily unavailable. */ });
    return () => { active = false; };
  });
</script>

<div class:selected class:bare class:frameless={!frame} class:fluid-slot={entry.kind === 'fluid'} class="slot" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
  {#if entry.icon && rendered}
    <div
      class="atlas-sprite"
      data-sprite-resolution={rendered.resolution}
      style:width={`${spriteSize}px`} style:height={`${spriteSize}px`}
      style:background-image={`url("${rendered.url}")`}
      style:background-size={`${rendered.columns * 100}% ${rendered.columns * 100}%`}
      style:background-position={`${(rendered.index % rendered.columns) * 100 / (rendered.columns - 1)}% ${Math.floor(rendered.index / rendered.columns) * 100 / (rendered.columns - 1)}%`}
    ></div>
  {:else if entry.icon}
    <IconSkeleton {size} />
  {:else}
    <div class:fluid={entry.kind === 'fluid'} class="sprite" style:width={`${spriteSize}px`} style:height={`${spriteSize}px`} style:--item-color={entry.color}>
      <span>{entry.glyph}</span>
    </div>
  {/if}
</div>

<style>
  .slot {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    background: url('/assets/machine-ui/slot-item.png') center/cover no-repeat;
    image-rendering: pixelated;
    border-radius: 0;
    transition: filter .15s, transform .15s;
  }
  .slot.fluid-slot { background-image: url('/assets/machine-ui/slot-fluid.png'); }
  .slot.bare, .slot.frameless { background: none; }
  .bare .atlas-sprite, .bare .sprite {
    filter: var(--item-icon-shadow, drop-shadow(0 0 1px #e1e7ed80) drop-shadow(0 3px 3px #000b));
  }
  .selected { filter: drop-shadow(0 0 4px #c6ccd2); transform: translateY(-1px); }
  .sprite {
    display: grid;
    place-items: center;
    color: var(--item-color);
    font-family: system-ui;
    font-weight: 900;
    font-size: max(15px, 52%);
    line-height: 1;
    text-shadow: -1px -1px #fff5, 1px 1px #000c;
    filter: drop-shadow(1px 2px 0 #0008);
  }
  .atlas-sprite { background-repeat:no-repeat; image-rendering:pixelated; }
  .fluid { border-radius: 6px 6px 12px 12px; background: color-mix(in srgb, var(--item-color) 65%, #34383d); color: #f0f2f4; }
</style>
