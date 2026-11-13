<script lang="ts">
  import CatalogTooltip from './CatalogTooltip.svelte';
  import TooltipSkeleton from './TooltipSkeleton.svelte';
  import type { CatalogEntry } from './types';
  let {
    entry,
    loading = false,
    error = '',
    retry,
    action,
    notes,
  }: {
    entry: CatalogEntry;
    loading?: boolean;
    error?: string;
    retry?: () => void;
    action?: string | string[];
    notes?: readonly string[];
  } = $props();
</script>

{#if loading}<TooltipSkeleton />
{:else if error}<div class="tooltip-error" role="status">
    Item info could not be loaded. {#if retry}<button class="mc-button" onclick={retry}
        >Retry</button
      >{/if}
  </div>
{:else}<CatalogTooltip {entry} {action} {notes} />{/if}

<style>
  .tooltip-error {
    padding: 14px;
    color: #eee;
    background: #1c1020;
    border: 2px solid #593286;
  }
</style>
