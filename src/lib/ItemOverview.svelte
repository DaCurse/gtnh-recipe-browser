<script lang="ts">
  import CatalogTooltip from './CatalogTooltip.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { oreCycle } from './oreCycle';
  import type { CatalogEntry, RecipeView } from './types';

  let {
    selected,
    entryById,
    navigate
  }: {
    selected: CatalogEntry;
    entryById: Map<string, CatalogEntry>;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  const iconEntry = $derived(
    (selected.kind === 'oreDict' || selected.kind === 'itemGroup') && selected.members?.length
    ? entryById.get(selected.members[$oreCycle % selected.members.length]) ?? selected
    : selected);
  let tooltipEntry = $state<CatalogEntry>();
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  const tooltipAction = 'Left-click: Recipes · Right-click: Usages';

  function showPointerTooltip(event: PointerEvent, entry: CatalogEntry) {
    if (event.pointerType === 'touch') return;
    tooltipEntry = entry;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function movePointerTooltip(event: PointerEvent) {
    if (!tooltipEntry || event.pointerType === 'touch') return;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function showFocusTooltip(event: FocusEvent, entry: CatalogEntry) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipEntry = entry;
    tooltipX = rect.right;
    tooltipY = rect.bottom;
  }
</script>

<div class="item-head">
  <ItemIcon entry={iconEntry} size={88} selected />
  <div class="item-overview">
    <CatalogTooltip entry={selected} />
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
            onpointerenter={(event) => showPointerTooltip(event, member)}
            onpointermove={movePointerTooltip}
            onpointerleave={() => tooltipEntry = undefined}
            onfocus={(event) => showFocusTooltip(event, member)}
            onblur={() => tooltipEntry = undefined}
            onclick={() => {
              tooltipEntry = undefined;
              navigate(member.id, 'recipes');
            }}
            oncontextmenu={(event) => {
              event.preventDefault();
              tooltipEntry = undefined;
              navigate(member.id, 'usages');
            }}
          ><ItemIcon entry={member} size={52} /></button>
        {/if}
      {/each}
    </div>
  </div>
{/if}

{#if tooltipEntry}
  <FloatingCatalogTooltip
    entry={tooltipEntry}
    x={tooltipX}
    y={tooltipY}
    action={tooltipAction}
  />
{/if}
