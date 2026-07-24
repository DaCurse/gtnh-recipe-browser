<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import AppHeader from './lib/AppHeader.svelte';
  import ApplicationState from './lib/ApplicationState.svelte';
  import CatalogPane from './lib/CatalogPane.svelte';
  import DatasetManager from './lib/DatasetManager.svelte';
  import ItemOverview from './lib/ItemOverview.svelte';
  import RecipeBrowser from './lib/RecipeBrowser.svelte';
  import { DatasetRepository } from './lib/dataset';
  import { itemListUrl } from './lib/navigation';
  import { storageShortfall } from './lib/offline';
  import {
    toRecipeSearchCatalogEntry,
    toRecipeSearchRecord
  } from './lib/recipeSearch';
  import {
    estimateStorage,
    listDatasets,
    removeDataset,
    requestPersistentStorage,
    storageIsPersistent
  } from './lib/storage';
  import type {
    CatalogEntry,
    DatasetState,
    DatasetVersion,
    ManagedDataset,
    OfflineInstallProgress,
    Recipe,
    RecipeView
  } from './lib/types';

  let catalog = $state<CatalogEntry[]>([]);
  let allRecipes = $state<Recipe[]>([]);
  let repository = $state<DatasetRepository | null>(null);
  let datasetVersion = $state('…');
  let datasetStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let datasetError = $state('');
  let datasetProgress = $state(0);
  let datasetStage = $state('Starting');
  let errorCopied = $state(false);
  let recipeLoading = $state(false);
  let recipeError = $state('');
  let recipeLoadedShards = $state(0);
  let recipeTotalShards = $state(0);
  let recipePage = $state(0);
  let loadedRecipeCounts = $state<Record<string, number>>({});
  let recipeQuery = $state('');
  let recipeFilter = $state('');
  let recipeDebouncePending = $state(false);
  let recipeWorkerPending = $state(false);
  let recipeSearchIds = $state<string[]>([]);
  let recipeSearchTotal = $state(0);
  let recipeSearchGeneration = $state(0);
  let recipeIndexRevision = $state(0);
  let recipeSearchReady = $state(false);
  let searchIds = $state<string[]>([]);
  let searchTotal = $state(0);
  let searchPending = $state(true);
  let searchLoadingMore = $state(false);
  let searchWorker: Worker | null = null;
  let recipeSearchWorker: Worker | null = null;
  let recipeAbortController: AbortController | null = null;
  let searchRequest = 0;
  let recipeRequest = 0;
  let recipeSearchRequest = 0;
  let query = $state('');
  let selectedId = $state('');
  let mode = $state<RecipeView>('recipes');
  let type = $state('');
  let detailsOpen = $state(false);
  let versionOpen = $state(false);
  let updateReady = $state(false);
  let sidebarWidth = $state(410);
  let sidebarResizing = $state(false);
  let searchInput = $state<HTMLInputElement>();
  let availableDatasets = $state<DatasetVersion[]>([]);
  let datasetRecords = $state<DatasetState[]>([]);
  let managerLoading = $state(false);
  let managerError = $state('');
  let installingDatasetId = $state('');
  let switchingDatasetId = $state('');
  let installProgress = $state<OfflineInstallProgress>();
  let installController: AbortController | null = null;
  let storageUsage = $state<number>();
  let storageQuota = $state<number>();
  let persistentStorage = $state<boolean>();

  const entryById = $derived(new Map(catalog.map((entry) => [entry.id, entry])));
  const searchableCatalog = $derived(catalog.filter((entry) => entry.searchable !== false));
  const visibleEntries = $derived(searchIds
    .map((id) => entryById.get(id))
    .filter((entry): entry is CatalogEntry => entry !== undefined));
  const selected = $derived(entryById.get(selectedId));
  const related = $derived(allRecipes);
  const types = $derived([...new Set(related.map((x) => x.type))]);
  const recipeById = $derived(new Map(related.map((recipe) => [recipe.id, recipe])));
  const visibleRecipes = $derived(recipeSearchIds
    .map((id) => recipeById.get(id))
    .filter((recipe): recipe is Recipe => recipe !== undefined));
  const recipePageSize = 20;
  const recipePageCount = $derived(Math.max(1, Math.ceil(recipeSearchTotal / recipePageSize)));
  const recipeSearchPending = $derived(recipeDebouncePending || recipeWorkerPending);
  const managedDatasets = $derived.by(() => {
    const versions = new Map(availableDatasets.map((version) => [version.datasetId, version]));
    for (const state of datasetRecords) {
      if (!versions.has(state.datasetId)) {
        versions.set(state.datasetId, {
          datasetId: state.datasetId,
          gtnhVersion: state.gtnhVersion,
          revision: state.revision,
          packManifestUrl: state.manifestUrl,
          offlineBytes: state.totalBytes
        });
      }
    }
    return [...versions.values()].map((version): ManagedDataset => ({
      version,
      state: datasetRecords.find((state) => state.datasetId === version.datasetId)
    }));
  });
  const activeDatasetState = $derived(datasetRecords.find((state) => state.active));
  const modeLabel = $derived(mode === 'machineUsages' ? 'machine usages' : mode);

  $effect(() => {
    const nextQuery = query;
    if (datasetStatus !== 'ready' || !searchWorker) return;
    searchPending = true;
    const request = ++searchRequest;
    searchLoadingMore = false;
    const timeout = window.setTimeout(() => {
      searchWorker?.postMessage({ type: 'search', id: request, query: nextQuery, offset: 0, limit: 300 });
    }, nextQuery ? 80 : 0);
    return () => window.clearTimeout(timeout);
  });

  $effect(() => {
    void selectedId;
    void mode;
    void type;
    void recipeFilter;
    recipePage = 0;
  });

  $effect(() => {
    const nextQuery = recipeQuery;
    recipeDebouncePending = nextQuery !== recipeFilter;
    const timeout = window.setTimeout(() => {
      recipeFilter = nextQuery;
      recipeDebouncePending = false;
    }, nextQuery ? 100 : 0);
    return () => window.clearTimeout(timeout);
  });

  $effect(() => {
    const generation = recipeSearchGeneration;
    void recipeIndexRevision;
    const query = recipeFilter;
    const recipeType = type;
    const page = recipePage;
    if (!detailsOpen || !recipeSearchReady || !recipeSearchWorker || !recipeType) {
      recipeWorkerPending = false;
      return;
    }
    const request = ++recipeSearchRequest;
    recipeWorkerPending = true;
    recipeSearchWorker.postMessage({
      type: 'search',
      generation,
      id: request,
      query,
      recipeType,
      offset: page * recipePageSize,
      limit: recipePageSize
    });
  });

  function initializeRecipeSearch(nextCatalog: CatalogEntry[]) {
    recipeSearchGeneration += 1;
    recipeIndexRevision += 1;
    recipeSearchIds = [];
    recipeSearchTotal = 0;
    recipeWorkerPending = false;
    recipeSearchWorker?.postMessage({
      type: 'init',
      generation: recipeSearchGeneration,
      catalog: nextCatalog.map(toRecipeSearchCatalogEntry)
    });
  }

  function resetRecipeSearch() {
    recipeSearchGeneration += 1;
    recipeIndexRevision += 1;
    recipeSearchIds = [];
    recipeSearchTotal = 0;
    recipeWorkerPending = false;
    recipeSearchWorker?.postMessage({
      type: 'reset',
      generation: recipeSearchGeneration
    });
  }

  function appendRecipeSearch(batch: Recipe[]) {
    if (batch.length === 0) return;
    recipeSearchWorker?.postMessage({
      type: 'append',
      generation: recipeSearchGeneration,
      recipes: batch.map(toRecipeSearchRecord)
    });
    recipeIndexRevision += 1;
  }

  async function refreshRecipes() {
    if (!repository || !selectedId) return;
    recipeAbortController?.abort();
    const controller = new AbortController();
    recipeAbortController = controller;
    const request = ++recipeRequest;
    const entryId = selectedId;
    const view = mode;
    allRecipes = [];
    type = '';
    recipePage = 0;
    resetRecipeSearch();
    recipeError = '';
    recipeLoading = true;
    recipeLoadedShards = 0;
    recipeTotalShards = 0;
    try {
      const loaded = await repository.recipesFor(entryId, view, ({
        loadedShards,
        totalShards,
        batch
      }) => {
        if (request !== recipeRequest) return;
        recipeLoadedShards = loadedShards;
        recipeTotalShards = totalShards;
        if (batch.length > 0) {
          const next = [...allRecipes, ...batch]
            .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
          allRecipes = next;
          appendRecipeSearch(batch);
          loadedRecipeCounts = {
            ...loadedRecipeCounts,
            [`${entryId}:${view}`]: next.length
          };
          if (!type) type = next[0]?.type ?? '';
        }
      }, controller.signal);
      if (request === recipeRequest) {
        allRecipes = loaded;
        loadedRecipeCounts = { ...loadedRecipeCounts, [`${entryId}:${view}`]: loaded.length };
        if (!type) type = loaded[0]?.type ?? '';
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Unable to load recipes', error);
      if (request === recipeRequest) {
        allRecipes = [];
        resetRecipeSearch();
        recipeError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === recipeRequest) recipeLoading = false;
    }
  }

  function setRecipePage(nextPage: number) {
    recipePage = Math.max(0, Math.min(nextPage, recipePageCount - 1));
    requestAnimationFrame(() => {
      document.querySelector('.recipe-search-block, .recipe-list')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      });
    });
  }

  function requestMoreItems() {
    if (!searchWorker || searchPending || searchLoadingMore || searchIds.length >= searchTotal) return;
    searchLoadingMore = true;
    searchWorker.postMessage({
      type: 'search',
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

  function startSidebarResize(event: PointerEvent) {
    if (window.innerWidth <= 800) return;
    sidebarResizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveSidebarResize(event: PointerEvent) {
    if (!sidebarResizing) return;
    sidebarWidth = clampSidebarWidth(event.clientX);
  }

  function stopSidebarResize(event: PointerEvent) {
    if (!sidebarResizing) return;
    sidebarResizing = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    saveSidebarWidth();
  }

  function resizeSidebarWithKeyboard(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    sidebarWidth = clampSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 20 : -20));
    saveSidebarWidth();
  }

  function viewUrlValue(view: RecipeView): string {
    return view === 'machineUsages' ? 'machine-usages' : view;
  }

  function viewFromUrl(value: string | null): RecipeView {
    if (value === 'usages') return 'usages';
    if (value === 'machine-usages') return 'machineUsages';
    return 'recipes';
  }

  function select(id: string, push = true, nextMode: RecipeView = 'recipes') {
    mode = nextMode;
    selectedId = id;
    recipeQuery = '';
    recipeFilter = '';
    detailsOpen = true;
    type = '';
    void refreshRecipes();
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('item', id);
      url.searchParams.set('view', viewUrlValue(mode));
      history.pushState({ id }, '', url);
    }
  }

  function setMode(next: RecipeView) {
    mode = next;
    recipeQuery = '';
    recipeFilter = '';
    type = '';
    void refreshRecipes();
    const url = new URL(location.href);
    url.searchParams.set('view', viewUrlValue(mode));
    history.replaceState({ id: selectedId }, '', url);
  }

  function showItemList(clearSearch = false) {
    recipeAbortController?.abort();
    recipeAbortController = null;
    ++recipeRequest;
    detailsOpen = false;
    recipeLoading = false;
    recipeError = '';
    if (clearSearch) query = '';
    history.replaceState({ route: 'items' }, '', itemListUrl(location.href));
  }

  function recipeCount(view: RecipeView): number | undefined {
    if (!selected) return undefined;
    const declared = view === 'recipes'
      ? selected.productionCount
      : view === 'usages'
        ? selected.usageCount
        : undefined;
    return loadedRecipeCounts[`${selected.id}:${view}`] ?? declared;
  }

  function diagnostic(error: unknown): string {
    if (error instanceof Error) return error.stack || error.message;
    return String(error);
  }

  async function copyError() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(datasetError);
      } else {
        const field = document.createElement('textarea');
        field.value = datasetError;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        document.execCommand('copy');
        field.remove();
      }
      errorCopied = true;
      window.setTimeout(() => errorCopied = false, 1800);
    } catch {
      errorCopied = false;
    }
  }

  function formatBytes(bytes?: number): string {
    if (bytes === undefined || !Number.isFinite(bytes)) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }

  async function refreshDatasetManager() {
    managerLoading = true;
    managerError = '';
    try {
      const [versions, records, storage, persisted] = await Promise.all([
        DatasetRepository.availableVersions(),
        listDatasets(),
        estimateStorage(),
        storageIsPersistent()
      ]);
      availableDatasets = versions;
      datasetRecords = records;
      storageUsage = storage.usage;
      storageQuota = storage.quota;
      persistentStorage = persisted;
    } catch (error) {
      managerError = diagnostic(error);
      datasetRecords = await listDatasets();
    } finally {
      managerLoading = false;
    }
  }

  function openVersionManager() {
    versionOpen = true;
    void refreshDatasetManager();
  }

  function validateRepository(loaded: DatasetRepository) {
    if (!loaded.entries.some((entry) => entry.searchable !== false)) {
      throw new Error('The verified catalog does not contain any searchable items or fluids');
    }
  }

  async function applyRepository(loaded: DatasetRepository, preserveSelection: boolean) {
    recipeAbortController?.abort();
    recipeAbortController = null;
    ++recipeRequest;
    allRecipes = [];
    loadedRecipeCounts = {};
    repository = loaded;
    catalog = loaded.entries;
    initializeRecipeSearch(loaded.entries);
    datasetVersion = loaded.gtnhVersion;
    const linkedId = new URLSearchParams(location.search).get('item');
    const preferredId = preserveSelection ? selectedId : linkedId;
    selectedId = preferredId && loaded.entries.some((entry) => entry.id === preferredId)
      ? preferredId
      : loaded.entries.find((entry) => entry.searchable !== false)?.id ?? loaded.entries[0]?.id ?? '';
    const selectedEntry = loaded.entries.find((entry) => entry.id === selectedId);
    if (mode === 'machineUsages' && !selectedEntry?.machineCapabilities?.length) mode = 'recipes';
    if (preserveSelection && preferredId !== selectedId) detailsOpen = false;
    if (!preserveSelection) detailsOpen = Boolean(linkedId && linkedId === selectedId);
    searchWorker?.postMessage({
      type: 'init',
      catalog: loaded.entries
        .filter((entry) => entry.searchable !== false)
        .map(({ id, name, mod }) => ({ id, name, mod }))
    });
    searchIds = [];
    searchTotal = 0;
    searchPending = true;
    searchLoadingMore = false;
    type = '';
    const url = new URL(location.href);
    url.searchParams.set('version', loaded.datasetId);
    if (!detailsOpen) {
      url.searchParams.delete('item');
      url.searchParams.delete('view');
    }
    history.replaceState(detailsOpen ? { id: selectedId } : { route: 'items' }, '', url);
    if (detailsOpen && selectedId) await refreshRecipes();
  }

  async function loadDataset(targetDatasetId?: string) {
    datasetStatus = 'loading';
    datasetError = '';
    datasetProgress = 0;
    datasetStage = 'Starting';
    errorCopied = false;
    repository = null;
    catalog = [];
    allRecipes = [];
    searchIds = [];
    searchTotal = 0;
    searchPending = true;
    searchLoadingMore = false;
    recipeLoading = false;
    selectedId = '';
    datasetVersion = '…';
    try {
      const linkedDatasetId = targetDatasetId
        ?? new URLSearchParams(location.search).get('version')
        ?? undefined;
      const loaded = await DatasetRepository.load(linkedDatasetId, ({ percent, stage }) => {
        datasetProgress = percent;
        datasetStage = stage;
      });
      validateRepository(loaded);
      await loaded.activate();
      await applyRepository(loaded, false);
      datasetStatus = 'ready';
      datasetRecords = await listDatasets();
    } catch (error) {
      console.error('Unable to load the GTNH dataset', error);
      datasetError = diagnostic(error);
      datasetStatus = 'error';
    }
  }

  async function installDataset(version: DatasetVersion) {
    if (installingDatasetId) return;
    managerError = '';
    installProgress = undefined;
    installingDatasetId = version.datasetId;
    const controller = new AbortController();
    installController = controller;
    try {
      const state = datasetRecords.find((record) => record.datasetId === version.datasetId);
      const totalBytes = version.offlineBytes ?? state?.totalBytes;
      const remainingBytes = totalBytes === undefined
        ? undefined
        : Math.max(0, totalBytes - (state?.storedBytes ?? 0));
      const estimate = await estimateStorage();
      storageUsage = estimate.usage;
      storageQuota = estimate.quota;
      const shortfall = remainingBytes === undefined
        ? undefined
        : storageShortfall(remainingBytes, estimate.usage, estimate.quota);
      if (shortfall !== undefined && shortfall > 0) {
        const availableBytes = Math.max(0, estimate.quota! - estimate.usage!);
        throw new Error(
          `Not enough browser storage. ${formatBytes(remainingBytes)} is still required, `
          + `but only ${formatBytes(availableBytes)} is estimated available.`
        );
      }
      const persisted = await requestPersistentStorage();
      if (persisted !== undefined) persistentStorage = persisted;
      const installer = repository?.datasetId === version.datasetId
        ? repository
        : await DatasetRepository.load(version.datasetId);
      validateRepository(installer);
      await installer.installOffline((progress) => {
        if (installingDatasetId === version.datasetId) installProgress = progress;
      }, controller.signal);
      if (repository?.datasetId === version.datasetId) await installer.activate();
      await refreshDatasetManager();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        managerError = diagnostic(error);
      }
      datasetRecords = await listDatasets();
    } finally {
      if (installingDatasetId === version.datasetId) {
        installingDatasetId = '';
        installController = null;
      }
    }
  }

  function cancelInstall() {
    installController?.abort();
  }

  async function switchDataset(version: DatasetVersion) {
    if (switchingDatasetId || version.datasetId === repository?.datasetId) return;
    switchingDatasetId = version.datasetId;
    managerError = '';
    try {
      const loaded = await DatasetRepository.load(version.datasetId);
      validateRepository(loaded);
      await loaded.activate();
      await applyRepository(loaded, true);
      datasetStatus = 'ready';
      await refreshDatasetManager();
    } catch (error) {
      managerError = diagnostic(error);
    } finally {
      switchingDatasetId = '';
    }
  }

  async function deleteDataset(state: DatasetState) {
    if (installingDatasetId === state.datasetId) return;
    const currentNote = repository?.datasetId === state.datasetId
      ? ' The currently open catalog will continue working until this page is reloaded.'
      : '';
    if (!confirm(`Delete locally stored data for GTNH ${state.gtnhVersion}?${currentNote}`)) return;
    managerError = '';
    try {
      await removeDataset(state.datasetId);
      await refreshDatasetManager();
    } catch (error) {
      managerError = diagnostic(error);
    }
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    mode = viewFromUrl(params.get('view'));
    try {
      const storedWidth = Number(localStorage.getItem('gtnh-sidebar-width'));
      if (Number.isFinite(storedWidth) && storedWidth > 0) sidebarWidth = clampSidebarWidth(storedWidth);
    } catch {
      // Use the default width when storage is unavailable.
    }
    searchWorker = new Worker(new URL('./workers/search.worker.ts', import.meta.url), { type: 'module' });
    searchWorker.onmessage = (event: MessageEvent<
      { type: 'ready' } | { type: 'results'; id: number; offset: number; total: number; ids: string[] }
    >) => {
      if (event.data.type === 'ready') {
        const request = ++searchRequest;
        searchWorker?.postMessage({ type: 'search', id: request, query, offset: 0, limit: 300 });
        return;
      }
      if (event.data.type !== 'results' || event.data.id !== searchRequest) return;
      searchIds = event.data.offset === 0
        ? event.data.ids
        : [...searchIds, ...event.data.ids];
      searchTotal = event.data.total;
      searchPending = false;
      searchLoadingMore = false;
    };
    searchWorker.onerror = (event) => {
      console.error('Catalog search worker failed', event);
      searchPending = false;
    };
    recipeSearchWorker = new Worker(
      new URL('./workers/recipeSearch.worker.ts', import.meta.url),
      { type: 'module' }
    );
    recipeSearchReady = true;
    recipeSearchWorker.onmessage = (event: MessageEvent<{
      type: 'results';
      generation: number;
      id: number;
      total: number;
      ids: string[];
    }>) => {
      if (
        event.data.type !== 'results'
        || event.data.generation !== recipeSearchGeneration
        || event.data.id !== recipeSearchRequest
      ) return;
      recipeSearchIds = event.data.ids;
      recipeSearchTotal = event.data.total;
      recipeWorkerPending = false;
    };
    recipeSearchWorker.onerror = (event) => {
      console.error('Recipe search worker failed', event);
      recipeSearchReady = false;
      recipeWorkerPending = false;
      recipeError = 'Recipe filtering could not start. Reload the page to retry.';
    };
    const handlePopState = () => {
      const id = new URLSearchParams(location.search).get('item');
      const linkedView = viewFromUrl(new URLSearchParams(location.search).get('view'));
      if (id && entryById.has(id)) select(id, false, linkedView);
      else detailsOpen = false;
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        detailsOpen = false;
        searchInput?.focus();
      }
    };
    addEventListener('popstate', handlePopState);
    addEventListener('keydown', handleShortcut);
    registerSW({ onNeedRefresh: () => updateReady = true });
    void loadDataset();
    return () => {
      removeEventListener('popstate', handlePopState);
      removeEventListener('keydown', handleShortcut);
      searchWorker?.terminate();
      searchWorker = null;
      recipeSearchWorker?.terminate();
      recipeSearchWorker = null;
      recipeSearchReady = false;
      recipeAbortController?.abort();
      recipeAbortController = null;
    };
  });
</script>

<svelte:head><title>{selected && detailsOpen ? `${selected.name} - GTNH Recipe Browser` : 'GTNH Recipe Browser'}</title></svelte:head>

<div class="app-shell">
  <AppHeader
    {datasetVersion}
    activeDataset={activeDatasetState}
    {updateReady}
    showHome={() => showItemList(true)}
    openDatasetManager={openVersionManager}
  />

  {#if datasetStatus !== 'ready'}
    <ApplicationState
      status={datasetStatus}
      stage={datasetStage}
      progress={datasetProgress}
      error={datasetError}
      {errorCopied}
      retry={() => loadDataset()}
      {copyError}
    />
  {:else if selected}
  <main class:home-view={!detailsOpen} class:resizing={sidebarResizing} style:--sidebar-width={`${sidebarWidth}px`}>
    <CatalogPane
      {selected}
      {detailsOpen}
      bind:query
      bind:searchInput
      {searchPending}
      {searchTotal}
      {visibleEntries}
      {searchLoadingMore}
      searchableCount={searchableCatalog.length}
      select={(id) => select(id)}
      {requestMoreItems}
      {loadMoreItems}
      startResize={startSidebarResize}
      moveResize={moveSidebarResize}
      stopResize={stopSidebarResize}
      resizeWithKeyboard={resizeSidebarWithKeyboard}
    />

    <section class:mobile-visible={detailsOpen} class="detail">
      <button class="back" onclick={() => showItemList()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg>
        Back to items
      </button>
      <ItemOverview
        {selected}
        {entryById}
        navigate={(id, view) => select(id, true, view)}
      />
      <RecipeBrowser
        {selected}
        {mode}
        {modeLabel}
        bind:type
        {types}
        {related}
        {entryById}
        bind:recipeQuery
        {recipeFilter}
        {recipeSearchPending}
        {recipeSearchTotal}
        {recipeLoading}
        {recipeLoadedShards}
        {recipeTotalShards}
        {recipeError}
        {visibleRecipes}
        {recipePage}
        {recipePageSize}
        {recipePageCount}
        {recipeCount}
        {setMode}
        navigate={(id, view) => select(id, true, view)}
        retry={refreshRecipes}
        {setRecipePage}
      />
    </section>
  </main>
  {/if}
</div>

{#if versionOpen}
  <DatasetManager
    datasets={managedDatasets}
    currentDatasetId={repository?.datasetId}
    loading={managerLoading}
    error={managerError}
    {installingDatasetId}
    {switchingDatasetId}
    {installProgress}
    {storageUsage}
    {storageQuota}
    {persistentStorage}
    close={() => versionOpen = false}
    install={installDataset}
    {cancelInstall}
    {switchDataset}
    {deleteDataset}
  />
{/if}
