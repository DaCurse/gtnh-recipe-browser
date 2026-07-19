<script lang="ts">
  import type { CatalogEntry } from './types';
  let { entry, size = 48, selected = false }: { entry: CatalogEntry; size?: number; selected?: boolean } = $props();
</script>

<div class:selected class="slot" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
  {#if entry.icon}
    <div
      class="atlas-sprite"
      style:background-image={`url("${entry.icon.url}")`}
      style:background-size={`${entry.icon.columns * 100}% ${entry.icon.columns * 100}%`}
      style:background-position={`${(entry.icon.index % entry.icon.columns) * 100 / (entry.icon.columns - 1)}% ${Math.floor(entry.icon.index / entry.icon.columns) * 100 / (entry.icon.columns - 1)}%`}
    ></div>
  {:else}
    <div class:fluid={entry.kind === 'fluid'} class="sprite" style:--item-color={entry.color}>
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
    background: url('/assets/inventory-slot.webp') center/cover no-repeat;
    image-rendering: pixelated;
    border-radius: 3px;
    transition: filter .15s, transform .15s;
  }
  .selected { filter: drop-shadow(0 0 4px #c6ccd2); transform: translateY(-1px); }
  .sprite {
    width: 61%;
    height: 61%;
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
  .atlas-sprite { width:61%; height:61%; background-repeat:no-repeat; image-rendering:pixelated; filter:drop-shadow(1px 2px 0 #0008); }
  .fluid { border-radius: 6px 6px 12px 12px; background: color-mix(in srgb, var(--item-color) 65%, #34383d); color: #f0f2f4; }
</style>
