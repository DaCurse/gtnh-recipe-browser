<script lang="ts">
  import { blockColors, blockColorPalette } from './blockColors';
  import MinecraftText from './MinecraftText.svelte';
  import NbtTree from './NbtTree.svelte';
  import { keyboardModifiers } from './keyboardModifiers.svelte';
  import type { CatalogEntry } from './types';

  let {
    entry,
    action,
    notes,
    colorScores,
  }: {
    entry: CatalogEntry;
    action?: string | string[];
    /** Additional plain-text lines supplied by a specialized view. */
    notes?: readonly string[];
    colorScores?: string;
  } = $props();

  const visibleColors = $derived(
    blockColors.flatMap((color, index) => {
      const score = Number.parseInt(colorScores?.[index] ?? '0', 16);
      return score > 0
        ? [{ color, dye: blockColorPalette[index]!, percent: Math.round((score / 15) * 100) }]
        : [];
    }),
  );
</script>

<div
  class="minecraft-tooltip"
  class:compact={entry.tooltipLayout === 'compact'}
  role="group"
  aria-label={`${entry.name} tooltip`}
>
  <div class="tooltip-header">
    <MinecraftText lines={entry.formattedName} raw={entry.rawName} fallback={entry.name} />
  </div>
  <div class="tooltip-debug">{entry.id}</div>
  {#if entry.formula || entry.rawTooltip || entry.formattedTooltip?.length || entry.tooltip.length}
    <div class="tooltip-text">
      {#if entry.formula}<span class="tooltip-formula">{entry.formula}</span>{/if}
      <MinecraftText
        lines={entry.formattedTooltip}
        raw={entry.rawTooltip}
        fallback={entry.tooltip}
      />
    </div>
  {/if}
  {#if visibleColors.length}
    <div class="tooltip-colors" aria-label="Block color scores">
      {#each visibleColors as { color, dye, percent } (color)}
        <span class="color-score" style:--dye={`#${dye.toString(16).padStart(6, '0')}`}>
          {color}
          {percent}%
        </span>
      {/each}
    </div>
  {/if}
  {#if notes?.length}
    <div class="tooltip-notes">
      {#each notes as note, index (`${index}:${note}`)}<div>{note}</div>{/each}
    </div>
  {/if}
  {#if keyboardModifiers.shift && entry.showNbt && entry.nbt}<NbtTree source={entry.nbt} />{/if}
  {#if entry.oreDictionaryIds?.length}
    <div class="tooltip-ore-dictionaries">
      <span>Ore dictionary</span>
      {entry.oreDictionaryIds.map((id) => (id.startsWith('o:') ? id.slice(2) : id)).join(', ')}
    </div>
  {/if}
  <div class="tooltip-mod">{entry.mod}</div>
  {#if action}
    <div class="tooltip-action">
      <MinecraftText fallback={action} />
    </div>
  {/if}
</div>

<style>
  .tooltip-colors {
    display: flex;
    flex-wrap: wrap;
    column-gap: 4px;
    margin-top: 4px;
    font:
      14px/1.4 Minecraft,
      monospace;
    text-shadow: 1px 1px #342c34;
  }
  .color-score {
    color: color-mix(in srgb, var(--dye) 72%, white);
    white-space: nowrap;
  }
  .color-score:not(:last-child)::after {
    content: ' ·';
    color: #a69aa9;
  }
  .tooltip-notes {
    margin-top: 4px;
    color: #ffff55;
    font:
      18px/24px Minecraft,
      monospace;
    text-shadow: 2px 2px #342c34;
    overflow-wrap: anywhere;
  }
  .tooltip-ore-dictionaries {
    margin-top: 4px;
    color: #aca1ab;
    font:
      18px/24px Minecraft,
      monospace;
    text-shadow: 2px 2px #342c34;
    overflow-wrap: anywhere;
  }
  .tooltip-ore-dictionaries span {
    display: block;
    color: #777c82;
    font:
      10px/1.4 ui-sans-serif,
      system-ui,
      sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-shadow: none;
  }
  .minecraft-tooltip.compact .tooltip-debug,
  .minecraft-tooltip.compact .tooltip-mod {
    display: none;
  }
</style>
