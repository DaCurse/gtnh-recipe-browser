<script lang="ts">
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import MinecraftText from './MinecraftText.svelte';
  import ProjectLinks from './ProjectLinks.svelte';
  import type { CatalogEntry } from './types';

  let {
    selected,
    detailsOpen,
    query = $bindable(),
    searchInput = $bindable(),
    searchPending,
    searchTotal,
    visibleEntries,
    searchLoadingMore,
    searchableCount,
    select,
    requestMoreItems,
    loadMoreItems,
    startResize,
    moveResize,
    stopResize,
    resizeWithKeyboard
  }: {
    selected: CatalogEntry;
    detailsOpen: boolean;
    query: string;
    searchInput?: HTMLInputElement;
    searchPending: boolean;
    searchTotal: number;
    visibleEntries: CatalogEntry[];
    searchLoadingMore: boolean;
    searchableCount: number;
    select: (id: string) => void;
    requestMoreItems: () => void;
    loadMoreItems: (node: HTMLElement) => void | { destroy: () => void };
    startResize: (event: PointerEvent) => void;
    moveResize: (event: PointerEvent) => void;
    stopResize: (event: PointerEvent) => void;
    resizeWithKeyboard: (event: KeyboardEvent) => void;
  } = $props();

  let tooltipEntry = $state<CatalogEntry>();
  let tooltipX = $state(0);
  let tooltipY = $state(0);

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

  function hideTooltip() {
    tooltipEntry = undefined;
  }
</script>

<aside class:mobile-hidden={detailsOpen}>
  <div class="search-wrap">
    <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5"></circle>
      <path d="m15.5 15.5 4 4"></path>
    </svg>
    <input
      bind:this={searchInput}
      bind:value={query}
      placeholder="Search items, fluids, or @mod…"
      aria-label="Search catalog"
    />
    {#if query}
      <button class="clear-search" onclick={() => query = ''} aria-label="Clear search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17"></path>
        </svg>
      </button>
    {/if}
    <kbd>Ctrl K</kbd>
  </div>
  <div class="result-bar">
    <span>{searchPending && searchTotal === 0
      ? 'PREPARING ITEMS & FLUIDS'
      : `${searchTotal.toLocaleString()} ITEMS & FLUIDS`}</span>
    {#if searchPending}<span class="mini-spinner" aria-label="Searching"></span>{/if}
  </div>
  <div class="item-grid">
    {#if searchPending && visibleEntries.length === 0}
      <div class="empty search-loading">
        <span class="spinner" aria-hidden="true"></span>
        <b>Preparing item list…</b>
      </div>
    {:else}
      {#each visibleEntries as entry (entry.id)}
        <button
          class:active={selected.id === entry.id}
          class="item-tile"
          aria-label={entry.name}
          onpointerenter={(event) => showPointerTooltip(event, entry)}
          onpointermove={movePointerTooltip}
          onpointerleave={hideTooltip}
          onfocus={(event) => showFocusTooltip(event, entry)}
          onblur={hideTooltip}
          onclick={() => {
            hideTooltip();
            select(entry.id);
          }}
        >
          <ItemIcon {entry} size={56} selected={selected.id === entry.id} />
          <span class="item-summary">
            <strong>{entry.name}</strong>
            <small>{entry.kind}</small>
            <span class="tooltip-preview">
              {#if entry.formula}<b>{entry.formula}</b>{/if}
              <MinecraftText lines={entry.formattedTooltip} fallback={entry.tooltip} />
            </span>
          </span>
          <span class="row-arrow">›</span>
        </button>
      {:else}
        <div class="empty"><b>No matches</b><span>Try fewer terms or another @mod filter.</span></div>
      {/each}
      {#if visibleEntries.length < searchTotal}
        <button class="item-more" use:loadMoreItems onclick={requestMoreItems}>
          {searchLoadingMore
            ? 'Loading more items…'
            : `Showing ${visibleEntries.length.toLocaleString()} of ${searchTotal.toLocaleString()} · Load next 300`}
        </button>
      {/if}
    {/if}
  </div>
  <footer>
    <div class="sidebar-status">
      <span><i></i> Catalog ready</span>
      <span>{searchableCount.toLocaleString()} entries</span>
    </div>
    <ProjectLinks variant="mobile-sidebar-links" />
  </footer>
  <button
    class="sidebar-resizer"
    aria-label="Resize item sidebar"
    title="Drag to resize item sidebar"
    onpointerdown={startResize}
    onpointermove={moveResize}
    onpointerup={stopResize}
    onpointercancel={stopResize}
    onkeydown={resizeWithKeyboard}
  ><span></span></button>
</aside>

{#if tooltipEntry}
  <FloatingCatalogTooltip entry={tooltipEntry} x={tooltipX} y={tooltipY} />
{/if}
