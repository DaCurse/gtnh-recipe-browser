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
  <div class="tooltip-mod">{entry.mod}</div>
  {#if action}
    <div class="tooltip-action">
      <MinecraftText fallback={action} />
    </div>
  {/if}
</div>
