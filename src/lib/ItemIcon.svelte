<script lang="ts">
  import { resolveIconSheetUrl } from './iconCache';
  import type { CatalogEntry } from './types';
  let { entry, size = 48, selected = false, bare = false, frame = true }: { entry: CatalogEntry; size?: number; selected?: boolean; bare?: boolean; frame?: boolean } = $props();
  let iconUrl = $state('');
  const spriteSize = $derived(Math.max(1, size - 2 * Math.round(size * (bare ? 0.075 : 1 / 18))));

  $effect(() => {
    const icon = entry.icon;
    iconUrl = '';
    if (!icon) return;
    let active = true;
    void resolveIconSheetUrl(icon).then((url) => {
      if (active) iconUrl = url;
    });
    return () => {
      active = false;
    };
  });
</script>

<div class:selected class:bare class:frameless={!frame} class:fluid-slot={entry.kind === 'fluid'} class="slot" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
  {#if entry.icon && iconUrl}
    <div
      class="atlas-sprite"
      style:width={`${spriteSize}px`} style:height={`${spriteSize}px`}
      style:background-image={`url("${iconUrl}")`}
      style:background-size={`${entry.icon.columns * 100}% ${entry.icon.columns * 100}%`}
      style:background-position={`${(entry.icon.index % entry.icon.columns) * 100 / (entry.icon.columns - 1)}% ${Math.floor(entry.icon.index / entry.icon.columns) * 100 / (entry.icon.columns - 1)}%`}
    ></div>
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
    filter: drop-shadow(0 0 1px #e1e7ed80) drop-shadow(0 3px 3px #000b);
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
