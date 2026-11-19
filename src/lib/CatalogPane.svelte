<script lang="ts">
  import { ItemTouch, clearItemTouch, openItemActions } from './itemTouch.svelte';
  import { keyboardModifiers } from './keyboardModifiers.svelte';
  import type { RecipeView } from './types';
  import { onMount } from 'svelte';
  import { createSearchReporter, trackEvent } from './analytics';
  import CatalogVariantIcon from './CatalogVariantIcon.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import MinecraftText from './MinecraftText.svelte';
  import { minecraftHtmlPlainText } from './minecraftText';
  import ProjectLinks from './ProjectLinks.svelte';
  import VariantPicker from './VariantPicker.svelte';
  import { resolveCatalogVariant } from './catalogVariants';
  import {
    blockColorScores,
    buildCatalogSearchDocuments,
    catalogDocumentMatches,
    parseCatalogSearchQuery,
    type CatalogSearchDocument,
  } from './catalogSearch';
  import { catalogSortOptions, isCatalogSort, sortCatalog, type CatalogSort } from './catalogSort';
  import HighlightedSearchInput from './HighlightedSearchInput.svelte';
  import SearchGuide from './SearchGuide.svelte';
  import { oreCycle } from './oreCycle';
  import type { CatalogBrowseEntry, CatalogEntry } from './types';

  let {
    selected,
    detailsOpen,
    query = $bindable(),
    searchInput = $bindable(),
    catalog,
    entryById,
    exactEntryById,
    loadSearchDocuments,
    sidebarWidth = $bindable(),
    sidebarResizing = $bindable(),
    select,
    navigate,
    searchContext = 'catalog',
  }: {
    selected: CatalogEntry;
    detailsOpen: boolean;
    query: string;
    searchInput?: HTMLInputElement;
    catalog: CatalogBrowseEntry[];
    entryById: ReadonlyMap<string, CatalogBrowseEntry>;
    exactEntryById: ReadonlyMap<string, CatalogEntry>;
    loadSearchDocuments?: (includeOreDictionary: boolean) => Promise<CatalogSearchDocument[]>;
    sidebarWidth: number;
    sidebarResizing: boolean;
    select: (id: string) => void;
    navigate?: (id: string, view: RecipeView) => void;
    searchContext?: 'catalog' | 'finder_input' | 'finder_output';
  } = $props();

  let layout = $state<'list' | 'grid'>(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 800px)').matches
      ? 'list'
      : 'grid',
  );
  function setLayout(next: 'list' | 'grid') {
    layout = next;
    hideTooltip();
    clearItemTouch();
    try {
      localStorage.setItem('gtnh-catalog-layout', next);
    } catch {
      // Keep the selection for this visit when storage is unavailable.
    }
    trackEvent('catalog_layout_changed', { layout: next, search_context: searchContext });
  }

  let sort = $state<CatalogSort>('mixed');
  let shuffleSeed = $state(0);
  function changeSort(next: CatalogSort, reshuffle = false) {
    sort = next;
    if (reshuffle) shuffleSeed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    hideTooltip();
    clearItemTouch();
    try {
      localStorage.setItem('gtnh-catalog-sort', next);
    } catch {
      /* Keep in-memory preference. */
    }
    trackEvent('catalog_sort_changed', { sort: next, reshuffle, search_context: searchContext });
  }

  let searchIds = $state<string[]>([]);
  let searchTotal = $state(0);
  let searchPending = $state(false);
  let searchLoadingMore = $state(false);
  let searchReady = $state(false);
  let searchInitProgress = $state(0);
  let searchWorkerError = $state('');
  let searchLoadError = $state('');
  let fallbackIds = $state<string[]>([]);
  let searchWorker = $state<Worker | null>(null);
  let searchRequest = 0;
  let searchGeneration = 0;
  let tooltipEntry = $state<CatalogBrowseEntry>();
  let variantGroup = $state<CatalogBrowseEntry>();
  let variantActions = $state(false);
  let variantView = $state<RecipeView>();
  const touch = new ItemTouch();
  function openVariant(entry: CatalogBrowseEntry, actions: boolean) {
    hideTooltip();
    variantActions = actions;
    variantView = undefined;
    variantGroup = entry;
  }
  function openItemView(entry: CatalogBrowseEntry, view: RecipeView) {
    const item = touch.frozen(entry.id) ?? resolveCatalogVariant(entry, exactEntryById, $oreCycle);
    hideTooltip();
    clearItemTouch();
    if (entry.variantKind !== 'single') {
      openVariant(entry, false);
      variantView = view;
    } else {
      navigate?.(item.id, view);
    }
  }
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  const searchableCatalog = $derived(catalog.filter((entry) => entry.searchable !== false));
  const orderedCatalog = $derived(sortCatalog(searchableCatalog, sort, shuffleSeed));
  const orderRanks = $derived(new Map(orderedCatalog.map((entry, index) => [entry.id, index])));
  const visibleEntries = $derived(
    searchIds
      .map((id) => entryById.get(id))
      .filter((entry): entry is CatalogBrowseEntry => entry !== undefined),
  );

  $effect(() => {
    void query;
    tooltipEntry = undefined;
  });

  const searchRequested = $derived(query.trim().length > 0);
  let initializedCatalog: CatalogBrowseEntry[] | undefined;
  let initializedOreDictionary = false;
  const needsOreDictionary = $derived(parseCatalogSearchQuery(query).needsOreDictionary);
  let guideOpen = $state(false);
  let guideOpener = $state<HTMLButtonElement>();
  const reportSearch = createSearchReporter('catalog_search');
  $effect(() =>
    reportSearch(
      query,
      searchContext,
      { search_context: searchContext, result_count: searchTotal },
      !searchPending && !searchLoadingMore,
    ),
  );

  // Browsing the sorted catalog needs neither a search index nor a worker scan.
  $effect(() => {
    const entries = orderedCatalog;
    if (searchRequested) return;
    searchRequest += 1;
    const ids = entries.map((entry) => entry.id);
    fallbackIds = ids;
    searchIds = ids.slice(0, 60);
    searchTotal = entries.length;
    searchPending = false;
    searchLoadingMore = false;
  });

  $effect(() => {
    const worker = searchWorker;
    const nextCatalog = searchableCatalog;
    const getDocuments = loadSearchDocuments;
    const includeOreDictionary =
      needsOreDictionary || (initializedCatalog === nextCatalog && initializedOreDictionary);
    if (
      !worker ||
      !searchRequested ||
      (initializedCatalog === nextCatalog && initializedOreDictionary === includeOreDictionary)
    )
      return;
    initializedCatalog = nextCatalog;
    initializedOreDictionary = includeOreDictionary;
    const generation = ++searchGeneration;
    searchRequest += 1;
    const nextFallbackIds = nextCatalog.map((entry) => entry.id);
    fallbackIds = nextFallbackIds;
    searchIds = nextFallbackIds.slice(0, 60);
    searchTotal = nextFallbackIds.length;
    searchPending = true;
    searchLoadingMore = false;
    searchReady = false;
    searchInitProgress = 0;
    searchWorkerError = '';
    try {
      worker.postMessage({ type: 'init', generation });
    } catch (error) {
      handleSearchWorkerFailure(error);
      return;
    }
    const initialize = async () => {
      const nextDocuments = await getDocuments?.(includeOreDictionary);
      for (let start = 0; start < nextCatalog.length; start += 1_000) {
        if (generation !== searchGeneration || worker !== searchWorker) return;
        const end = Math.min(start + 1_000, nextCatalog.length);
        if (nextDocuments) {
          worker.postMessage({
            type: 'appendDocuments',
            generation,
            documents: nextDocuments.slice(start, end),
            completed: end,
            total: nextDocuments.length,
          });
        } else {
          worker.postMessage({
            type: 'append',
            generation,
            catalog: nextCatalog.slice(start, end).map((entry) => ({
              id: entry.id,
              name: entry.name,
              mod: entry.mod,
              kind: entry.kind,
              numericId: entry.numericId,
              damage: entry.damage,
              members: entry.variantIds.map((id) => {
                const member = exactEntryById.get(id)!;
                return {
                  id: member.id,
                  name: member.name,
                  mod: member.mod,
                  variantLabel: entry.variantLabels?.[id],
                  rawTooltip: member.rawTooltip,
                  oreDictionaryIds: member.oreDictionaryIds,
                };
              }),
            })),
            completed: end,
            total: nextCatalog.length,
          });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (generation === searchGeneration && worker === searchWorker) {
        worker.postMessage({ type: 'finish', generation });
      }
    };
    void initialize().catch((error) => {
      if (generation === searchGeneration && worker === searchWorker)
        handleSearchWorkerFailure(error);
    });
  });

  $effect(() => {
    if (searchWorker && searchReady) {
      searchWorker.postMessage({
        type: 'order',
        generation: searchGeneration,
        ids: orderedCatalog.map((entry) => entry.id),
      });
    }
  });

  $effect(() => {
    void orderedCatalog;
    const nextQuery = query;
    const worker = searchWorker;
    const ready = searchReady;
    if (!worker || !ready || !nextQuery.trim()) return;
    searchPending = true;
    const request = ++searchRequest;
    searchLoadingMore = false;
    const timeout = window.setTimeout(
      () => {
        worker.postMessage({
          type: 'search',
          generation: searchGeneration,
          id: request,
          query: nextQuery,
          offset: 0,
          limit: 60,
        });
      },
      nextQuery ? 80 : 0,
    );
    return () => window.clearTimeout(timeout);
  });

  async function fallbackSearch(nextQuery: string, request: number): Promise<void> {
    searchLoadError = '';
    searchPending = true;
    try {
      await buildFallbackResults(nextQuery, request);
    } catch (error) {
      if (request !== searchRequest) return;
      console.error('Catalog fallback search failed', error);
      searchLoadError = 'Search could not load. Check your connection and try again.';
      searchIds = [];
      searchTotal = 0;
      searchPending = false;
      searchLoadingMore = false;
    }
  }

  async function buildFallbackResults(nextQuery: string, request: number): Promise<void> {
    const expression = parseCatalogSearchQuery(nextQuery);
    const documents = loadSearchDocuments
      ? await loadSearchDocuments(expression.needsOreDictionary)
      : buildCatalogSearchDocuments(
          searchableCatalog,
          [...exactEntryById.values()],
          exactEntryById,
        );
    if (request !== searchRequest) return;
    const matches: CatalogSearchDocument[] = [];
    for (let start = 0; start < documents.length; start += 1_000) {
      for (const document of documents.slice(start, start + 1_000)) {
        if (catalogDocumentMatches(document, expression)) {
          matches.push(document);
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (request !== searchRequest) return;
    }
    matches.sort((a, b) => (orderRanks.get(a.id) ?? Infinity) - (orderRanks.get(b.id) ?? Infinity));
    const ids = matches.map((match) => match.id);
    if (request !== searchRequest) return;
    fallbackIds = ids;
    searchIds = ids.slice(0, 60);
    searchTotal = matches.length;
    searchPending = false;
    searchLoadingMore = false;
  }

  function handleSearchWorkerFailure(error: unknown): void {
    console.error('Catalog search worker failed', error);
    searchWorkerError = 'Search index unavailable; showing the catalog with a local fallback.';
    searchReady = false;
    searchPending = false;
    searchLoadingMore = false;
  }

  $effect(() => {
    void orderedCatalog;
    const nextQuery = query;
    if (!searchWorkerError || searchReady) return;
    const request = ++searchRequest;
    void fallbackSearch(nextQuery, request);
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

  function hasDescription(entry: CatalogBrowseEntry): boolean {
    if (entry.formula?.trim()) return true;
    if (entry.formattedTooltip)
      return entry.formattedTooltip.some((line) =>
        line.segments.some((segment) => segment.text.trim()),
      );
    if (entry.rawTooltip !== undefined && entry.rawTooltip !== null)
      return !!minecraftHtmlPlainText(entry.rawTooltip).trim();
    return entry.tooltip.some((line) => line.trim());
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
    if (searchPending || searchLoadingMore || searchIds.length >= searchTotal) return;
    if (!query.trim() || searchWorkerError) {
      searchIds = fallbackIds.slice(0, Math.min(searchIds.length + 60, fallbackIds.length));
      return;
    }
    if (!searchWorker) return;
    searchLoadingMore = true;
    searchWorker.postMessage({
      type: 'search',
      generation: searchGeneration,
      id: searchRequest,
      query,
      offset: searchIds.length,
      limit: 60,
    });
  }

  function loadMoreItems(node: HTMLElement) {
    if (!('IntersectionObserver' in window)) return;
    const root = node.closest('.item-grid');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestMoreItems();
      },
      { root, rootMargin: '400px 0px' },
    );
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
      shuffleSeed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      const storedSort = localStorage.getItem('gtnh-catalog-sort');
      if (isCatalogSort(storedSort)) sort = storedSort;
      const storedLayout = localStorage.getItem('gtnh-catalog-layout');
      if (storedLayout === 'list' || storedLayout === 'grid') layout = storedLayout;
      const storedWidth = Number(localStorage.getItem('gtnh-sidebar-width'));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        sidebarWidth = clampSidebarWidth(storedWidth);
      }
    } catch {
      // Use the default width when storage is unavailable.
    }
    const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
      type: 'module',
    });
    searchWorker = worker;
    worker.onmessage = (
      event: MessageEvent<
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
      >,
    ) => {
      if (event.data.generation !== searchGeneration) return;
      if (event.data.type === 'progress') {
        searchInitProgress =
          event.data.total > 0 ? Math.round((event.data.completed / event.data.total) * 100) : 100;
        return;
      }
      if (event.data.type === 'ready') {
        searchReady = true;
        searchInitProgress = 100;
        return;
      }
      if (event.data.id !== searchRequest || !query.trim()) return;
      searchIds = event.data.offset === 0 ? event.data.ids : [...searchIds, ...event.data.ids];
      searchTotal = event.data.total;
      searchPending = false;
      searchLoadingMore = false;
    };
    worker.onerror = (event) => {
      handleSearchWorkerFailure(event);
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
    <HighlightedSearchInput
      bind:input={searchInput}
      bind:value={query}
      placeholder="Search items, fluids, or @mod…"
      label="Search catalog"
    />
    {#if query}
      <button class="clear-search" onclick={() => (query = '')} aria-label="Clear search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17"></path>
        </svg>
      </button>
    {/if}
    <kbd>Ctrl K</kbd>
  </div>
  <div class="sort-controls">
    <div class="sort-bar">
      <button
        class="search-help"
        bind:this={guideOpener}
        onclick={() => {
          guideOpen = true;
          trackEvent('search_help_opened', { search_context: searchContext });
        }}>Search syntax</button
      >
      <span class="mc-button-surface sort-select">
        <select
          id="catalog-sort-{searchContext}"
          aria-label="Sort items"
          value={sort}
          title={catalogSortOptions.find((option) => option.value === sort)?.description}
          onchange={(event) => {
            const value = event.currentTarget.value;
            if (isCatalogSort(value)) changeSort(value);
          }}
        >
          {#each catalogSortOptions as option (option.value)}
            <option value={option.value} title={option.description}>{option.label}</option>
          {/each}
        </select>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </span>
      <button
        class="mc-button reshuffle"
        aria-label={sort === 'shuffle' ? 'Reshuffle items' : 'Shuffle items'}
        title={sort === 'shuffle' ? 'Reshuffle items' : 'Shuffle items'}
        onclick={() => changeSort('shuffle', true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path
            d="M4 6h3c4 0 6 12 10 12h3m-4-4 4 4-4 4M4 18h3c1.5 0 2.7-1.7 4-4m2-4c1.3-2.3 2.5-4 4-4h3m-4-4 4 4-4 4"
          /></svg
        >
      </button>
    </div>
  </div>
  <div class="result-bar">
    <span
      >{searchPending && !searchReady
        ? `PREPARING ITEMS & FLUIDS${searchInitProgress ? ` · ${searchInitProgress}%` : ''}`
        : `${searchTotal.toLocaleString()} ITEMS & FLUIDS`}</span
    >
    <span class="search-tools">
      <span class="layout-switch" role="group" aria-label="Catalogue layout">
        <button
          aria-label="List view"
          title="List view"
          aria-pressed={layout === 'list'}
          onclick={() => setLayout('list')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"
            ><path d="M3 4h2v2H3zM3 9h2v2H3zM3 14h2v2H3zM8 5h9M8 10h9M8 15h9" /></svg
          >
        </button>
        <button
          aria-label="Grid view"
          title="Grid view"
          aria-pressed={layout === 'grid'}
          onclick={() => setLayout('grid')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"
            ><path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z" /></svg
          >
        </button>
      </span>
      {#if searchPending}<span class="mini-spinner" aria-label="Searching"></span>{/if}
    </span>
  </div>
  {#if searchWorkerError}
    <div class="search-fallback-note" role="status">
      {searchLoadError || searchWorkerError}
      {#if searchLoadError}<button
          onclick={() => {
            void fallbackSearch(query, ++searchRequest);
          }}>Retry</button
        >{/if}
    </div>
  {/if}
  <div class="item-grid" class:list-view={layout === 'list'} class:grid-view={layout === 'grid'}>
    {#if searchPending && visibleEntries.length === 0}
      <div class="catalog-empty search-loading">
        <span class="spinner" aria-hidden="true"></span>
        <b>Preparing item list…</b>
      </div>
    {:else}
      {#each visibleEntries as entry (entry.id)}
        {@const description = hasDescription(entry)}
        <div
          class="catalog-item"
          class:with-actions={layout === 'list' && searchContext === 'catalog' && !!navigate}
          class:active={(detailsOpen || searchContext !== 'catalog') &&
            entry.variantIds.includes(selected.id)}
        >
          <button
            class:active={(detailsOpen || searchContext !== 'catalog') &&
              entry.variantIds.includes(selected.id)}
            class="item-tile"
            aria-label={entry.name}
            use:touch.action={{
              key: entry.id,
              entry: resolveCatalogVariant(entry, exactEntryById, $oreCycle),
              enabled: searchContext === 'catalog',
              clearHover: hideTooltip,
              activate: (item) =>
                entry.variantKind !== 'single' ? openVariant(entry, false) : select(item.id),
              hold: (item) => {
                if (entry.variantKind !== 'single') openVariant(entry, true);
                else if (navigate) openItemActions(item, navigate);
              },
            }}
            onpointerenter={(event) => showPointerTooltip(event, entry)}
            onpointermove={movePointerTooltip}
            onpointerleave={hideTooltip}
            onfocus={(event) => showFocusTooltip(event, entry)}
            onblur={hideTooltip}
            onclick={() => {
              hideTooltip();
              if (entry.variantKind !== 'single') openVariant(entry, false);
              else select(entry.variantIds[0]!);
            }}
          >
            <CatalogVariantIcon
              {entry}
              exactEntries={exactEntryById}
              size={56}
              frozen={touch.frozen(entry.id)}
            />
            <span
              class="item-summary"
              class:has-variants={entry.variantKind !== 'single'}
              class:no-description={!description}
            >
              <strong>{entry.name}</strong>
              {#if entry.variantKind !== 'single'}<small>{variantSummary(entry)}</small>{/if}
              {#if description}<span class="tooltip-preview">
                  {#if entry.formula}<b>{entry.formula}</b>{/if}
                  <MinecraftText
                    lines={entry.formattedTooltip}
                    raw={entry.rawTooltip}
                    fallback={entry.tooltip}
                  />
                </span>
              {/if}<small class="item-mod">{entry.mod}</small>
            </span>
            {#if layout !== 'list' || searchContext !== 'catalog' || !navigate}<span
                class="row-arrow">›</span
              >{/if}
          </button>
          {#if layout === 'list' && searchContext === 'catalog' && navigate}
            <div class="catalog-item-actions">
              <button
                class="mc-button catalog-action"
                aria-label="Recipes for {entry.name}"
                onclick={() => openItemView(entry, 'recipes')}>Recipes</button
              >
              <button
                class="mc-button catalog-action"
                aria-label="Usages for {entry.name}"
                onclick={() => openItemView(entry, 'usages')}>Usages</button
              >
            </div>
          {/if}
        </div>
      {:else}
        <div class="catalog-empty">
          <b>No matches</b><span>Try fewer terms or another @mod filter.</span>
        </div>
      {/each}
      {#if visibleEntries.length < searchTotal}
        <button class="mc-button item-more" use:loadMoreItems onclick={requestMoreItems}>
          {searchLoadingMore
            ? 'Loading more items…'
            : `Showing ${visibleEntries.length.toLocaleString()} of ${searchTotal.toLocaleString()} · Load next 60`}
        </button>
      {/if}
    {/if}
  </div>
  <footer>
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
    onkeydown={resizeWithKeyboard}><span></span></button
  >
</aside>

{#if tooltipEntry}
  {@const entry = resolveCatalogVariant(tooltipEntry, exactEntryById, $oreCycle)}
  <FloatingCatalogTooltip
    {entry}
    x={tooltipX}
    y={tooltipY}
    action={variantAction(tooltipEntry)}
    colorScores={searchContext === 'catalog' && keyboardModifiers.shift
      ? blockColorScores(entry)
      : undefined}
  />
{/if}

{#if variantGroup}
  <VariantPicker
    group={variantGroup}
    members={variantGroup.variantIds
      .map((id) => exactEntryById.get(id))
      .filter((entry): entry is CatalogEntry => entry !== undefined)}
    close={() => (variantGroup = undefined)}
    select={(id) => {
      variantGroup = undefined;
      const entry = exactEntryById.get(id);
      if (variantView && navigate) navigate(id, variantView);
      else if (variantActions && entry && navigate) openItemActions(entry, navigate);
      else select(id);
    }}
  />
{/if}

{#if guideOpen}<SearchGuide close={() => (guideOpen = false)} opener={guideOpener} />{/if}

<style>
  .sort-controls {
    padding: 0 14px 6px;
    flex: none;
  }
  .sort-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }
  .sort-select {
    position: relative;
    display: flex;
    align-items: center;
    flex: none;
    width: fit-content;
    max-width: calc(100% - 90px);
    min-width: 0;
    border-radius: 0;
    color: #d9dcdf;
    font:
      400 14px/20px Minecraft,
      monospace;
    text-shadow: 1px 1px #222;
  }
  .sort-select select {
    appearance: none;
    width: auto;
    max-width: 100%;
    min-width: 0;
    min-height: 24px;
    border: 0;
    outline: 0;
    padding: 2px 22px 2px 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-shadow: inherit;
    cursor: pointer;
  }
  .sort-select option {
    color: #d9dcdf;
    background: #292b2e;
    text-shadow: none;
  }
  .sort-select:focus-within {
    border-color: #92999f;
    outline: 1px solid #92999f;
  }
  .sort-select svg {
    position: absolute;
    right: 8px;
    width: 16px;
    height: 16px;
    pointer-events: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .reshuffle svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: square;
    stroke-linejoin: miter;
  }
  .layout-switch {
    display: flex;
    gap: 2px;
  }
  .layout-switch button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: #92979c;
    cursor: pointer;
    border-radius: 3px;
  }
  .layout-switch button:hover {
    background: #303337;
    color: #eee;
  }
  .layout-switch button[aria-pressed='true'] {
    background: #34383c;
    border-color: #636970;
    color: #eee;
  }
  .layout-switch svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  .search-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .search-help {
    border: 0;
    background: none;
    padding: 7px 0;
    margin-right: auto;
    color: #959a9f;
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .search-help:hover {
    color: #d1d5d9;
  }
  .search-fallback-note button {
    margin-left: 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  .catalog-empty {
    grid-column: 1/-1;
    padding: 60px 20px;
    text-align: center;
    color: #858a8f;
  }
  .catalog-empty b,
  .catalog-empty span {
    display: block;
    margin: 8px;
  }
</style>
