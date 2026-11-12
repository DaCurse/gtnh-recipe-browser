<script lang="ts">
  import { ItemTouch } from './itemTouch.svelte';
  import CatalogTooltipContent from './CatalogTooltipContent.svelte';
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
    entryById: ReadonlyMap<string, CatalogEntry>;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  const iconEntry = $derived(
    (selected.kind === 'oreDict' || selected.kind === 'itemGroup') && selected.members?.length
    ? entryById.get(selected.members[$oreCycle % selected.members.length]) ?? selected
    : selected);
  const tooltip = new CatalogTooltipHover();
  const touch = new ItemTouch();
  const tooltipAction = 'Left-click: Recipes · Right-click: Usages';

</script>

<div class="item-head" class:compact={selected.tooltipLayout === 'compact'}>
  <ItemIcon entry={iconEntry} size={88} selected />
  <div class="item-overview">
    <CatalogTooltipContent entry={selected} {loading} {error} {retry} />
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
            use:touch.action={{ key: member.id, entry: member, activate: (entry) => navigate(entry.id, 'recipes'),
              navigate, clearHover: () => tooltip.clear() }}
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


{#if tooltip.entry}
  <FloatingCatalogTooltip
    entry={tooltip.entry}
    x={tooltip.x}
    y={tooltip.y}
    action={tooltipAction}
  />
{/if}
