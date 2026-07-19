<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import CatalogTooltip from './lib/CatalogTooltip.svelte';
  import FloatingCatalogTooltip from './lib/FloatingCatalogTooltip.svelte';
  import ItemIcon from './lib/ItemIcon.svelte';
  import MinecraftText from './lib/MinecraftText.svelte';
  import { oreCycle } from './lib/oreCycle';
  import ProjectLinks from './lib/ProjectLinks.svelte';
  import RecipeCard from './lib/RecipeCard.svelte';
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
    OfflineInstallProgress,
    Recipe,
    RecipeView
  } from './lib/types';

  interface ManagedDataset {
    version: DatasetVersion;
    state?: DatasetState;
  }

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
  let itemTooltipEntry = $state<CatalogEntry>();
  let itemTooltipX = $state(0);
  let itemTooltipY = $state(0);
  let itemTooltipAction = $state<string>();
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
  const selectedIconEntry = $derived(selected?.kind === 'oreDict' && selected.members?.length
    ? entryById.get(selected.members[$oreCycle % selected.members.length]) ?? selected
    : selected);
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
    selectedId;
    mode;
    type;
    recipeFilter;
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
    recipeIndexRevision;
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

  function showItemPointerTooltip(event: PointerEvent, entry: CatalogEntry, action?: string) {
    if (event.pointerType === 'touch') return;
    itemTooltipEntry = entry;
    itemTooltipAction = action;
    itemTooltipX = event.clientX;
    itemTooltipY = event.clientY;
  }

  function moveItemPointerTooltip(event: PointerEvent) {
    if (!itemTooltipEntry || event.pointerType === 'touch') return;
    itemTooltipX = event.clientX;
    itemTooltipY = event.clientY;
  }

  function showItemFocusTooltip(event: FocusEvent, entry: CatalogEntry, action?: string) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    itemTooltipEntry = entry;
    itemTooltipAction = action;
    itemTooltipX = rect.right;
    itemTooltipY = rect.bottom;
  }

  function hideItemTooltip() {
    itemTooltipEntry = undefined;
    itemTooltipAction = undefined;
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

  function datasetStateLabel(state?: DatasetState, current = false): string {
    if (!state) return current ? 'ACTIVE · ONLINE ONLY' : 'AVAILABLE';
    if (state.status === 'complete') return state.active ? 'ACTIVE · OFFLINE READY' : 'OFFLINE READY';
    if (state.status === 'partial') return state.active ? 'ACTIVE · PARTIALLY CACHED' : 'PARTIALLY CACHED';
    return state.active ? 'ACTIVE · CATALOG READY' : 'CATALOG READY';
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
  <header>
    <a class="brand" href="./" aria-label="GTNH Recipe Browser home" onclick={(event) => {
      event.preventDefault();
      showItemList(true);
    }}>
      <span class="brand-cube"><img src="./assets/gtnh-logo.png" alt="" /></span>
      <span><b>GTNH</b><small>RECIPE BROWSER</small></span>
    </a>
    <button class="version" onclick={openVersionManager}>
      <span><i></i> {datasetVersion}</span>
      <small>{activeDatasetState?.status === 'complete'
        ? 'Offline ready'
        : activeDatasetState
          ? 'Catalog cached'
          : 'Online only'}</small>
      <svg class="chevron-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"></path></svg>
    </button>
    <ProjectLinks variant="header-links" />
  </header>

  {#if updateReady}<button class="update-banner" onclick={() => location.reload()}>A new app version is ready · Refresh</button>{/if}

  {#if datasetStatus === 'loading'}
    <main class="state-main">
      <section class="app-state" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <h1>Loading GTNH catalog</h1>
        <p>{datasetStage}</p>
        <div class="load-progress" aria-label={`Catalog loading ${datasetProgress}%`}>
          <span style:width={`${datasetProgress}%`}></span>
        </div>
        <small>{datasetProgress}%</small>
      </section>
    </main>
  {:else if datasetStatus === 'error'}
    <main class="state-main">
      <section class="app-state app-error" aria-live="assertive">
        <span class="error-mark" aria-hidden="true">!</span>
        <h1>Catalog failed to load</h1>
        <p>The browser could not verify or open the active GTNH dataset.</p>
        <pre>{datasetError}</pre>
        <div class="state-actions">
          <button onclick={copyError}>{errorCopied ? 'Copied' : 'Copy error'}</button>
          <button class="primary" onclick={() => loadDataset()}>Try again</button>
        </div>
      </section>
    </main>
  {:else if selected}
  <main class:home-view={!detailsOpen} class:resizing={sidebarResizing} style:--sidebar-width={`${sidebarWidth}px`}>
    <aside class:mobile-hidden={detailsOpen}>
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5"></circle>
          <path d="m15.5 15.5 4 4"></path>
        </svg>
        <input bind:this={searchInput} bind:value={query} placeholder="Search items, fluids, or @mod…" aria-label="Search catalog" />
        {#if query}
          <button class="clear-search" onclick={() => query = ''} aria-label="Clear search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
          </button>
        {/if}
        <kbd>Ctrl K</kbd>
      </div>
      <div class="result-bar">
        <span>{searchPending && searchTotal === 0 ? 'PREPARING ITEMS & FLUIDS' : `${searchTotal.toLocaleString()} ITEMS & FLUIDS`}</span>
        {#if searchPending}<span class="mini-spinner" aria-label="Searching"></span>{/if}
      </div>
      <div class="item-grid">
        {#if searchPending && visibleEntries.length === 0}
          <div class="empty search-loading"><span class="spinner" aria-hidden="true"></span><b>Preparing item list…</b></div>
        {:else}
          {#each visibleEntries as entry (entry.id)}
            <button
              class:active={selected.id === entry.id}
              class="item-tile"
              aria-label={entry.name}
              onpointerenter={(event) => showItemPointerTooltip(event, entry)}
              onpointermove={moveItemPointerTooltip}
              onpointerleave={hideItemTooltip}
              onfocus={(event) => showItemFocusTooltip(event, entry)}
              onblur={hideItemTooltip}
              onclick={() => {
                hideItemTooltip();
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
          <span>{searchableCatalog.length.toLocaleString()} entries</span>
        </div>
        <ProjectLinks variant="mobile-sidebar-links" />
      </footer>
      <button
        class="sidebar-resizer"
        aria-label="Resize item sidebar"
        title="Drag to resize item sidebar"
        onpointerdown={startSidebarResize}
        onpointermove={moveSidebarResize}
        onpointerup={stopSidebarResize}
        onpointercancel={stopSidebarResize}
        onkeydown={resizeSidebarWithKeyboard}
      ><span></span></button>
    </aside>

    {#if itemTooltipEntry}
      <FloatingCatalogTooltip
        entry={itemTooltipEntry}
        x={itemTooltipX}
        y={itemTooltipY}
        action={itemTooltipAction}
      />
    {/if}

    <section class:mobile-visible={detailsOpen} class="detail">
      <button class="back" onclick={() => showItemList()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg>
        Back to items
      </button>
      <div class="item-head">
        <ItemIcon entry={selectedIconEntry ?? selected} size={88} selected />
        <div class="item-overview">
          <CatalogTooltip entry={selected} />
        </div>
      </div>
      {#if selected.kind === 'oreDict' && selected.members}
        <div class="ore-members" aria-label="Interchangeable ore dictionary members">
          <p>{selected.members.length.toLocaleString()} ACCEPTED ITEMS</p>
          <div>
            {#each selected.members as memberId}
              {@const member = entryById.get(memberId)}
              {#if member}
                <button
                  aria-label={`${member.name}: left-click for recipes, right-click for usages`}
                  onpointerenter={(event) => showItemPointerTooltip(
                    event,
                    member,
                    'Left-click: Recipes · Right-click: Usages'
                  )}
                  onpointermove={moveItemPointerTooltip}
                  onpointerleave={hideItemTooltip}
                  onfocus={(event) => showItemFocusTooltip(
                    event,
                    member,
                    'Left-click: Recipes · Right-click: Usages'
                  )}
                  onblur={hideItemTooltip}
                  onclick={() => {
                    hideItemTooltip();
                    select(member.id, true, 'recipes');
                  }}
                  oncontextmenu={(event) => {
                    event.preventDefault();
                    hideItemTooltip();
                    select(member.id, true, 'usages');
                  }}
                ><ItemIcon entry={member} size={52} /></button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <nav class="view-tabs" aria-label="Item views">
        <button class:active={mode === 'recipes'} onclick={() => setMode('recipes')}>
          Recipes {#if recipeCount('recipes') !== undefined}<span>{recipeCount('recipes')}</span>{/if}
        </button>
        <button class:active={mode === 'usages'} onclick={() => setMode('usages')}>
          Usages {#if recipeCount('usages') !== undefined}<span>{recipeCount('usages')}</span>{/if}
        </button>
        {#if selected.machineCapabilities?.length}
          <button class:active={mode === 'machineUsages'} onclick={() => setMode('machineUsages')}>
            Machine Usages
            {#if recipeCount('machineUsages') !== undefined}<span>{recipeCount('machineUsages')}</span>{/if}
          </button>
        {/if}
      </nav>
      {#if mode === 'recipes' && selected.productionOreDictionaryId}
        <div class="ore-production-note">
          No direct output exists for this exact item. Showing recipes which produce an
          interchangeable <button onclick={() => select(selected.productionOreDictionaryId!, true, 'recipes')}>
            {selected.productionOreDictionaryId}
          </button> member.
        </div>
      {/if}
      <div class="type-row">
        {#each types as tab}
          {@const tabRecipe = related.find((recipe) => recipe.type === tab)}
          {@const tabCrafter = tabRecipe?.typeIconId ? entryById.get(tabRecipe.typeIconId) : undefined}
          <button class:active={type === tab} onclick={() => type = tab} title={tab} aria-label={tab}>
            {#if tabCrafter}<ItemIcon entry={tabCrafter} size={60} selected={type === tab} crisp={false} />{:else}<span class="machine-fallback">⚙</span>{/if}
          </button>
        {/each}
      </div>
      {#if related.length > 0}
        <div class="recipe-search-block">
          <div class="recipe-search-wrap">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5"></circle>
              <path d="m15.5 15.5 4 4"></path>
            </svg>
            <input
              bind:value={recipeQuery}
              placeholder={`Filter ${modeLabel} by item, mod, or metadata…`}
              aria-label={`Filter ${modeLabel}`}
            />
            {#if recipeQuery}
              <button onclick={() => recipeQuery = ''} aria-label="Clear recipe filter">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
              </button>
            {/if}
          </div>
          <small>{recipeSearchPending
            ? 'Filtering…'
            : `${recipeSearchTotal.toLocaleString()} matching ${modeLabel}`}</small>
        </div>
      {/if}
      <div class="recipe-list">
        {#if recipeLoading}
          <div class:partial={related.length > 0} class="recipe-loading" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>
            <b>Loading {modeLabel}…</b>
            <p>{recipeTotalShards > 0
              ? `${recipeLoadedShards} of ${recipeTotalShards} recipe chunks`
              : 'Finding the recipe data needed for this item.'}</p>
            {#if recipeTotalShards > 0}
              <div class="load-progress compact"><span style:width={`${recipeLoadedShards / recipeTotalShards * 100}%`}></span></div>
            {/if}
          </div>
        {/if}
        {#if recipeError}
          <div class="no-recipes recipe-error">
            <span>!</span><b>Could not load {modeLabel}</b><p>{recipeError}</p>
            <button onclick={refreshRecipes}>Try again</button>
          </div>
        {:else if !recipeLoading && recipeSearchPending && visibleRecipes.length === 0}
          <div class="recipe-loading partial" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>
            <b>Filtering {modeLabel}…</b>
          </div>
        {:else if !recipeLoading && visibleRecipes.length === 0}
          <div class="no-recipes">
            <span>⌁</span>
            <b>{recipeFilter ? `No matching ${modeLabel}` : `No ${modeLabel} found`}</b>
            <p>{recipeFilter
              ? 'Try fewer terms or clear the recipe filter.'
              : `This item has no known ${modeLabel} in the active dataset.`}</p>
          </div>
        {:else}
          {#each visibleRecipes as recipe (recipe.id)}
            <RecipeCard {recipe} navigate={(id, view) => select(id, true, view)} resolve={(id) => entryById.get(id)} />
          {/each}
          {#if recipeSearchTotal > recipePageSize}
            <nav class="recipe-pagination" aria-label="Recipe pages">
              <button
                disabled={recipePage === 0}
                onclick={() => setRecipePage(recipePage - 1)}
              >Previous</button>
              <span>
                {recipePage * recipePageSize + 1}–{Math.min((recipePage + 1) * recipePageSize, recipeSearchTotal)}
                of {recipeSearchTotal.toLocaleString()}
              </span>
              <button
                disabled={recipePage >= recipePageCount - 1}
                onclick={() => setRecipePage(recipePage + 1)}
              >Next</button>
            </nav>
          {/if}
        {/if}
      </div>
    </section>
  </main>
  {/if}
</div>

{#if versionOpen}
  <div class="scrim" role="presentation" onclick={(e) => e.currentTarget === e.target && (versionOpen = false)}>
    <div class="manager" role="dialog" aria-modal="true" aria-label="Dataset manager">
      <button class="close" onclick={() => versionOpen = false}>×</button>
      <p class="eyebrow">DATASET MANAGER</p><h2>Your GTNH versions</h2>
      <p>Catalogs stay available after loading. Install every recipe and icon chunk for complete offline use.</p>
      {#if managerLoading && managedDatasets.length === 0}
        <div class="manager-loading"><span class="mini-spinner"></span> Checking local datasets…</div>
      {:else}
        <div class="dataset-list">
          {#each managedDatasets as managed (managed.version.datasetId)}
            {@const state = managed.state}
            {@const installing = installingDatasetId === managed.version.datasetId}
            {@const switching = switchingDatasetId === managed.version.datasetId}
            {@const current = repository?.datasetId === managed.version.datasetId}
            <section class:active={current} class="dataset">
              <div class="dataset-summary">
                <span class="dataset-icon"><img src="./assets/gtnh-logo.png" alt="" /></span>
                <div>
                  <b>{managed.version.gtnhVersion}</b>
                  <small><i></i> {datasetStateLabel(state, current)}</small>
                </div>
                <strong>
                  {formatBytes(state?.storedBytes ?? 0)} / {formatBytes(
                    state?.totalBytes ?? managed.version.offlineBytes
                  )}
                </strong>
              </div>
              {#if installing && installProgress}
                <div
                  class="dataset-progress"
                  aria-label={`Offline download ${Math.round(installProgress.loadedBytes / Math.max(1, installProgress.totalBytes) * 100)}%`}
                >
                  <span style:width={`${installProgress.loadedBytes / Math.max(1, installProgress.totalBytes) * 100}%`}></span>
                </div>
                <small class="dataset-progress-text">
                  {formatBytes(installProgress.loadedBytes)} of {formatBytes(installProgress.totalBytes)}
                  · {installProgress.completedAssets}/{installProgress.totalAssets} chunks
                  {#if installProgress.retry} · retry {installProgress.retry}/3{/if}
                </small>
              {/if}
              <div class="dataset-actions">
                {#if current}
                  <span class="active-label">Active</span>
                {:else}
                  <button
                    disabled={Boolean(switchingDatasetId || installingDatasetId)}
                    onclick={() => switchDataset(managed.version)}
                  >{switching ? 'Switching…' : 'Switch'}</button>
                {/if}
                {#if state?.status !== 'complete'}
                  {#if installing}
                    <button class="cancel" onclick={cancelInstall}>Cancel</button>
                  {:else}
                    <button
                      class="primary"
                      disabled={Boolean(installingDatasetId || switchingDatasetId)}
                      onclick={() => installDataset(managed.version)}
                    >
                      <svg class="download-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"></path></svg>
                      {state?.status === 'partial' ? 'Resume download' : 'Download offline'}
                    </button>
                  {/if}
                {/if}
                {#if state}
                  <button
                    class="delete"
                    disabled={Boolean(installingDatasetId || switchingDatasetId)}
                    onclick={() => deleteDataset(state)}
                  >Delete</button>
                {/if}
              </div>
            </section>
          {:else}
            <div class="manager-loading">No GTNH datasets are available.</div>
          {/each}
        </div>
      {/if}
      {#if managerError}<pre class="manager-error">{managerError}</pre>{/if}
      <small class="storage">
        {storageUsage !== undefined && storageQuota !== undefined
          ? `${formatBytes(storageUsage)} used of ${formatBytes(storageQuota)} browser storage`
          : 'Browser storage usage is unavailable'}
        · {persistentStorage === true
          ? 'persistent storage granted'
          : persistentStorage === false
            ? 'storage may be reclaimed by the browser'
            : 'persistence support unavailable'}
      </small>
    </div>
  </div>
{/if}
