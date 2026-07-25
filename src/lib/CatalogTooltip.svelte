<script lang="ts">
  import MinecraftText from './MinecraftText.svelte';
  import type { CatalogEntry } from './types';

  let {
    entry,
    action
  }: {
    entry: CatalogEntry;
    action?: string | string[];
  } = $props();
</script>

<div class="minecraft-tooltip" role="group" aria-label={`${entry.name} tooltip`}>
  <div class="tooltip-header">
    <MinecraftText lines={entry.formattedName} raw={entry.rawName} fallback={entry.name} />
  </div>
  <div class="tooltip-debug">{entry.id}</div>
  {#if entry.formula || entry.rawTooltip || entry.formattedTooltip?.length || entry.tooltip.length}
    <div class="tooltip-text">
      {#if entry.formula}<span class="tooltip-formula">{entry.formula}</span>{/if}
      <MinecraftText lines={entry.formattedTooltip} raw={entry.rawTooltip} fallback={entry.tooltip} />
    </div>
  {/if}
  {#if entry.oreDictionaryIds?.length}
    <div class="tooltip-ore-dictionaries">
      <span>Ore dictionary</span>
      {entry.oreDictionaryIds.map((id) => id.startsWith('o:') ? id.slice(2) : id).join(', ')}
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
  .tooltip-ore-dictionaries {
    margin-top: 4px;
    color: #aca1ab;
    font: 12px/1.45 Minecraft, monospace;
    text-shadow: 2px 2px #342c34;
    overflow-wrap: anywhere;
  }
  .tooltip-ore-dictionaries span {
    display: block;
    color: #777c82;
    font: 10px/1.4 ui-sans-serif, system-ui, sans-serif;
    text-transform: uppercase;
    letter-spacing: .08em;
    text-shadow: none;
  }
</style>
