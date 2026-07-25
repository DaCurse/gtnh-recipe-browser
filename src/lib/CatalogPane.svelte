<script lang="ts">
  import { onMount } from 'svelte';
  import CatalogVariantIcon from './CatalogVariantIcon.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import MinecraftText from './MinecraftText.svelte';
  import ProjectLinks from './ProjectLinks.svelte';
  import VariantPicker from './VariantPicker.svelte';
  import { resolveCatalogVariant } from './catalogVariants';
  import { oreCycle } from './oreCycle';
  import type { CatalogBrowseEntry, CatalogEntry } from './types';

  let {
    selected,
    detailsOpen,
    query = $bindable(),
    searchInput = $bindable(),
    catalog,
    exactCatalog,
    sidebarWidth = $bindable(),
    sidebarResizing = $bindable(),
    select,
  }: {
    selected: CatalogEntry;
    detailsOpen: boolean;
    query: string;
    searchInput?: HTMLInputElement;
    catalog: CatalogBrowseEntry[];
    exactCatalog: CatalogEntry[];
    sidebarWidth: number;
    sidebarResizing: boolean;
    select: (id: string) => void;
  } = $props();

  let searchIds = $state<string[]>([]);
  let searchTotal = $state(0);
  let searchPending = $state(true);
  let searchLoadingMore = $state(false);
  let searchReady = $state(false);
  let searchInitProgress = $state(0);
  let searchWorker = $state<Worker | null>(null);
  let searchRequest = 0;
  let searchGeneration = 0;
  let tooltipEntry = $state<CatalogBrowseEntry>();
  let variantGroup = $state<CatalogBrowseEntry>();
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  const entryById = $derived(new Map(catalog.map((entry) => [entry.id, entry])));
  const exactEntryById = $derived(new Map(exactCatalog.map((entry) => [entry.id, entry])));
  const searchableCatalog = $derived(catalog.filter((entry) => entry.searchable !== false));
  const visibleEntries = $derived(searchIds
    .map((id) => entryById.get(id))
    .filter((entry): entry is CatalogBrowseEntry => entry !== undefined));

  $effect(() => {
    const worker = searchWorker;
    const nextCatalog = searchableCatalog;
    if (!worker) return;
    const generation = ++searchGeneration;
    searchRequest += 1;
    searchIds = [];
    searchTotal = 0;
    searchPending = true;
    searchLoadingMore = false;
    searchReady = false;
    searchInitProgress = 0;
    worker.postMessage({ type: 'init', generation });
    const initialize = async () => {
      for (let start = 0; start < nextCatalog.length; start += 1_000) {
        if (generation !== searchGeneration || worker !== searchWorker) return;
        const end = Math.min(start + 1_000, nextCatalog.length);
        worker.postMessage({
          type: 'append',
          generation,
          catalog: nextCatalog.slice(start, end).map((entry) => ({
            id: entry.id,
            name: entry.name,
            mod: entry.mod,
            members: entry.variantIds.map((id) => {
              const member = exactEntryById.get(id)!;
              return {
                id: member.id,
                name: member.name,
                mod: member.mod,
                variantLabel: entry.variantLabels?.[id],
                rawTooltip: member.rawTooltip,
                searchMask: [...(member.searchMask ?? [])]
              };
            })
          })),
          completed: end,
          total: nextCatalog.length
        });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (generation === searchGeneration && worker === searchWorker) {
        worker.postMessage({ type: 'finish', generation });
      }
    };
    void initialize();
  });

  $effect(() => {
    const nextQuery = query;
    const worker = searchWorker;
    const ready = searchReady;
    if (!worker || !ready) return;
    searchPending = true;
    const request = ++searchRequest;
    searchLoadingMore = false;
    const timeout = window.setTimeout(() => {
      worker.postMessage({
        type: 'search',
        generation: searchGeneration,
        id: request,
        query: nextQuery,
        offset: 0,
        limit: 300
      });
    }, nextQuery ? 80 : 0);
    return () => window.clearTimeout(timeout);
  });

  function showPointerTooltip(event: PointerEvent, entry: CatalogBrowseEntry) {
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

  function showFocusTooltip(event: FocusEvent, entry: CatalogBrowseEntry) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipEntry = entry;
    tooltipX = rect.right;
    tooltipY = rect.bottom;
  }

  function hideTooltip() {
    tooltipEntry = undefined;
  }

  function variantSummary(entry: CatalogBrowseEntry): string {
    return entry.variantKind === 'gtOre'
      ? `${entry.variantCount.toLocaleString()} host-stone variants`
      : `${entry.variantCount.toLocaleString()} exact variants`;
  }

  function variantAction(entry: CatalogBrowseEntry): string | undefined {
    if (entry.variantKind === 'single') return undefined;
    return entry.variantKind === 'gtOre'
      ? `Click to choose one of ${entry.variantCount.toLocaleString()} host-stone variants`
      : `Click to choose one of ${entry.variantCount.toLocaleString()} exact variants`;
  }

  function requestMoreItems() {
    if (!searchWorker || searchPending || searchLoadingMore || searchIds.length >= searchTotal) return;
    searchLoadingMore = true;
    searchWorker.postMessage({
      type: 'search',
      generation: searchGeneration,
      id: searchRequest,
      query,
      offset: searchIds.length,
      limit: 300
    });
  }

  function loadMoreItems(node: HTMLElement) {
    if (!('IntersectionObserver' in window)) return;
    const root = node.closest('.item-grid');
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) requestMoreItems();
    }, { root, rootMargin: '400px 0px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function clampSidebarWidth(width: number): number {
    return Math.round(Math.max(300, Math.min(width, Math.min(720, window.innerWidth - 360))));
  }

  function saveSidebarWidth() {
    try {
      localStorage.setItem('gtnh-sidebar-width', String(sidebarWidth));
    } catch {
      // Resizing still works when storage is unavailable.
    }
  }

  function startResize(event: PointerEvent) {
    if (window.innerWidth <= 800) return;
    sidebarResizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveResize(event: PointerEvent) {
    if (!sidebarResizing) return;
    sidebarWidth = clampSidebarWidth(event.clientX);
  }

  function stopResize(event: PointerEvent) {
    if (!sidebarResizing) return;
    sidebarResizing = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    saveSidebarWidth();
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    sidebarWidth = clampSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 20 : -20));
    saveSidebarWidth();
  }

  onMount(() => {
    try {
      const storedWidth = Number(localStorage.getItem('gtnh-sidebar-width'));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        sidebarWidth = clampSidebarWidth(storedWidth);
      }
    } catch {
      // Use the default width when storage is unavailable.
    }
    const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
      type: 'module'
    });
    searchWorker = worker;
    worker.onmessage = (event: MessageEvent<
      | { type: 'ready'; generation: number }
      | { type: 'progress'; generation: number; completed: number; total: number }
      | {
          type: 'results';
          generation: number;
          id: number;
          offset: number;
          total: number;
          ids: string[];
        }
    >) => {
      if (event.data.generation !== searchGeneration) return;
      if (event.data.type === 'progress') {
        searchInitProgress = event.data.total > 0
          ? Math.round(event.data.completed / event.data.total * 100)
          : 100;
        return;
      }
      if (event.data.type === 'ready') {
        searchReady = true;
        searchInitProgress = 100;
        return;
      }
      if (event.data.id !== searchRequest) return;
      searchIds = event.data.offset === 0
        ? event.data.ids
        : [...searchIds, ...event.data.ids];
      searchTotal = event.data.total;
      searchPending = false;
      searchLoadingMore = false;
    };
    worker.onerror = (event) => {
      console.error('Catalog search worker failed', event);
      searchReady = false;
      searchPending = false;
    };
    return () => {
      worker.terminate();
      searchReady = false;
      if (searchWorker === worker) searchWorker = null;
    };
  });
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
      ? `PREPARING ITEMS & FLUIDS${searchInitProgress ? ` · ${searchInitProgress}%` : ''}`
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
          class:active={entry.variantIds.includes(selected.id)}
          class="item-tile"
          aria-label={entry.name}
          onpointerenter={(event) => showPointerTooltip(event, entry)}
          onpointermove={movePointerTooltip}
          onpointerleave={hideTooltip}
          onfocus={(event) => showFocusTooltip(event, entry)}
          onblur={hideTooltip}
          onclick={() => {
            hideTooltip();
            if (entry.variantKind !== 'single') variantGroup = entry;
            else select(entry.variantIds[0]!);
          }}
        >
          <CatalogVariantIcon
            {entry}
            exactEntries={exactEntryById}
            size={56}
            selected={entry.variantIds.includes(selected.id)}
          />
          <span class="item-summary">
            <strong>{entry.name}</strong>
            <small>{entry.variantKind !== 'single'
              ? variantSummary(entry)
              : entry.kind}</small>
            <span class="tooltip-preview">
              {#if entry.formula}<b>{entry.formula}</b>{/if}
              <MinecraftText
                lines={entry.formattedTooltip}
                raw={entry.rawTooltip}
                fallback={entry.tooltip}
              />
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
      <span>{searchableCatalog.length.toLocaleString()} families</span>
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
  <FloatingCatalogTooltip
    entry={resolveCatalogVariant(tooltipEntry, exactEntryById, $oreCycle)}
    x={tooltipX}
    y={tooltipY}
    action={variantAction(tooltipEntry)}
  />
{/if}

{#if variantGroup}
  <VariantPicker
    group={variantGroup}
    members={variantGroup.variantIds
      .map((id) => exactEntryById.get(id))
      .filter((entry): entry is CatalogEntry => entry !== undefined)}
    close={() => variantGroup = undefined}
    select={(id) => {
      variantGroup = undefined;
      select(id);
    }}
  />
{/if}
