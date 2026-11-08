<script lang="ts">
  import CatalogTooltip from './CatalogTooltip.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import { CatalogTooltipHover } from './catalogTooltipHover.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { oreCycle } from './oreCycle';
  import type { CatalogEntry, RecipeView } from './types';

  let {
    selected,
    loading = false,
    error = '',
    retry,
    entryById,
    navigate
  }: {
    selected: CatalogEntry;
    loading?: boolean;
    error?: string;
    retry?: () => void;
    entryById: Map<string, CatalogEntry>;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  const iconEntry = $derived(
    (selected.kind === 'oreDict' || selected.kind === 'itemGroup') && selected.members?.length
    ? entryById.get(selected.members[$oreCycle % selected.members.length]) ?? selected
    : selected);
  const tooltip = new CatalogTooltipHover();
  const tooltipAction = 'Left-click: Recipes · Right-click: Usages';

</script>

<div class="item-head" class:compact={selected.tooltipLayout === 'compact'}>
  <ItemIcon entry={iconEntry} size={88} selected />
  <div class="item-overview">
    {#if loading}
      <div class="tooltip-skeleton" role="status" aria-label="Loading item tooltip" aria-busy="true">
        <span></span><span></span><span></span>
      </div>
    {:else if error}
      <p class="tooltip-load-error" role="status">Item tooltip could not be loaded.</p>
      {#if retry}<button class="mc-button" onclick={retry}>Retry item details</button>{/if}
    {:else}
      <CatalogTooltip entry={selected} />
    {/if}
  </div>
</div>

{#if (selected.kind === 'oreDict' || selected.kind === 'itemGroup') && selected.members}
  <div class="ore-members" aria-label="Interchangeable ingredient members">
    <p>{selected.members.length.toLocaleString()} ACCEPTED ITEMS</p>
    <div>
      {#each selected.members as memberId (memberId)}
        {@const member = entryById.get(memberId)}
        {#if member}
          <button
            aria-label={`${member.name}: left-click for recipes, right-click for usages`}
            onpointerenter={(event) => tooltip.pointer(event, member)}
            onpointermove={(event) => tooltip.pointer(event)}
            onpointerleave={() => tooltip.clear()}
            onfocus={(event) => tooltip.focus(event, member)}
            onblur={() => tooltip.clear()}
            onclick={() => {
              tooltip.clear();
              navigate(member.id, 'recipes');
            }}
            oncontextmenu={(event) => {
              event.preventDefault();
              tooltip.clear();
              navigate(member.id, 'usages');
            }}
          ><ItemIcon entry={member} size={52} /></button>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .tooltip-skeleton { width:min(360px,100%); padding:10px 0; }
  .tooltip-skeleton span { display:block; height:14px; margin:0 0 12px; background:#35373c; }
  .tooltip-skeleton span:first-child { width:65%; height:20px; }
  .tooltip-skeleton span:last-child { width:80%; }
  .tooltip-load-error { margin:0; color:#a5aaaf; font-size:13px; }
</style>

{#if tooltip.entry}
  <FloatingCatalogTooltip
    entry={tooltip.entry}
    x={tooltip.x}
    y={tooltip.y}
    action={tooltipAction}
  />
{/if}
