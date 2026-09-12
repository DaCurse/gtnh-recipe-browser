<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import AppHeader from './lib/AppHeader.svelte';
  import ApplicationState from './lib/ApplicationState.svelte';
  import CatalogPane from './lib/CatalogPane.svelte';
  import DatasetManager from './lib/DatasetManager.svelte';
  import { DatasetManagerState } from './lib/datasetManagerState.svelte';
  import ItemOverview from './lib/ItemOverview.svelte';
  import RecipeBrowser from './lib/RecipeBrowser.svelte';
  import { DatasetRepository } from './lib/dataset';
  import { clearIconSheetCache } from './lib/iconCache';
  import { createSpecialContextEntry } from './lib/specialContext';
  import {
    catalogSearchFromUrl,
    catalogSearchUrl,
    itemListUrl,
    recipeFilterFromUrl,
    recipeFilterUrl,
    recipeViewFromUrl,
    recipeViewUrlValue,
    specialNavigationFromUrl,
    specialNavigationUrl
  } from './lib/navigation';
  import type { CatalogEntry, RecipeView, SpecialScope } from './lib/types';

  let catalog = $state<CatalogEntry[]>([]);
  let repository = $state<DatasetRepository | null>(null);
  let datasetVersion = $state('…');
  let datasetStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let datasetError = $state('');
  let datasetProgress = $state(0);
  let datasetStage = $state('Starting');
  let errorCopied = $state(false);
  let loadTargetDatasetId = $state<string>();
  let loadTargetVersion = $state<string>();
  let loadPreserveSelection = $state(false);
  let query = $state('');
  let recipeQuery = $state('');
  let navigationUrlReady = $state(false);
  let selectedId = $state('');
  let mode = $state<RecipeView>('recipes');
  let specialType = $state('');
  let specialScope = $state<SpecialScope>('item');
  let detailsOpen = $state(false);
  let updateReady = $state(false);
  let sidebarWidth = $state(410);
  let sidebarResizing = $state(false);
  let searchInput = $state<HTMLInputElement>();

  const entryById = $derived(new Map(catalog.map((entry) => [entry.id, entry])));
  const selected = $derived(entryById.get(selectedId));
  const specialContextViewType = $derived(
    specialScope === 'all'
      ? repository?.specialViewTypes.find((viewType) => viewType.id === specialType)
      : undefined
  );
  const specialContextServiceIcon = $derived(
    specialContextViewType?.serviceIconId
      ? repository?.specialServiceIcons.find((icon) => icon.id === specialContextViewType.serviceIconId)
      : undefined
  );
  const specialContextIconEntry = $derived(
    specialContextServiceIcon?.goodsId
      ? entryById.get(specialContextServiceIcon.goodsId)
      : undefined
  );
  const itemOverviewSelected = $derived(
    selected && specialContextViewType
      ? createSpecialContextEntry(
        selected,
        specialContextViewType,
        specialContextServiceIcon,
        specialContextIconEntry
      )
      : selected
  );

  $effect(() => {
    if (!navigationUrlReady) return;
    const url = catalogSearchUrl(location.href, query);
    if (url.search === location.search) return;
    history.replaceState({ id: selectedId }, '', url);
  });

  $effect(() => {
    if (!navigationUrlReady) return;
    const url = recipeFilterUrl(location.href, recipeQuery);
    if (url.search === location.search) return;
    history.replaceState({ id: selectedId }, '', url);
  });

  const datasetManager = new DatasetManagerState({
    getRepository: () => repository,
    validateRepository,
    loadDataset: (version, preserveSelection) => loadDataset(
      version.datasetId,
      preserveSelection,
      version.gtnhVersion
    )
  });
  function select(id: string, push = true, nextMode: RecipeView = 'recipes') {
    mode = nextMode;
    selectedId = id;
    specialType = '';
    specialScope = 'item';
    if (push) recipeQuery = '';
    detailsOpen = true;
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('item', id);
      url.searchParams.set('view', recipeViewUrlValue(mode));
      url.searchParams.delete('special');
      url.searchParams.delete('special-scope');
      url.searchParams.delete('recipe-filter');
      history.pushState({ id }, '', url);
    }
  }

  function setMode(next: RecipeView) {
    mode = next;
    specialType = '';
    specialScope = 'item';
    recipeQuery = '';
    const url = new URL(location.href);
    url.searchParams.set('view', recipeViewUrlValue(mode));
    url.searchParams.delete('special');
    url.searchParams.delete('special-scope');
    url.searchParams.delete('recipe-filter');
    history.replaceState({ id: selectedId }, '', url);
  }

  function setSpecialNavigation(nextType: string, nextScope: SpecialScope) {
    specialType = nextType;
    specialScope = nextType ? nextScope : 'item';
    recipeQuery = '';
    const url = specialNavigationUrl(location.href, specialType, specialScope);
    url.searchParams.delete('recipe-filter');
    history.replaceState({ id: selectedId }, '', url);
  }

  function setRecipeQuery(nextQuery: string) {
    if (navigationUrlReady) recipeQuery = nextQuery;
  }

  function showItemList(clearSearch = false) {
    detailsOpen = false;
    const nextQuery = clearSearch ? '' : query;
    if (clearSearch) query = nextQuery;
    recipeQuery = '';
    const url = catalogSearchUrl(itemListUrl(location.href), nextQuery);
    history.replaceState({ route: 'items' }, '', url);
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

  function validateRepository(loaded: DatasetRepository) {
    if (!loaded.entries.some((entry) => entry.searchable !== false)) {
      throw new Error('The verified catalog does not contain any searchable items or fluids');
    }
  }

  async function applyRepository(loaded: DatasetRepository, preserveSelection: boolean) {
    repository = loaded;
    catalog = loaded.entries;
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
    const linkedSpecial = specialNavigationFromUrl(location.href);
    specialType = detailsOpen ? linkedSpecial.specialType : '';
    specialScope = detailsOpen ? linkedSpecial.specialScope : 'item';
    if (mode === 'machineUsages') {
      specialType = '';
      specialScope = 'item';
    }
    const url = new URL(location.href);
    url.searchParams.set('version', loaded.datasetId);
    if (!detailsOpen) {
      recipeQuery = '';
      url.searchParams.delete('item');
      url.searchParams.delete('view');
      url.searchParams.delete('special');
      url.searchParams.delete('special-scope');
      url.searchParams.delete('recipe-filter');
    } else {
      url.searchParams.set('item', selectedId);
      url.searchParams.set('view', recipeViewUrlValue(mode));
      const normalizedSpecial = specialNavigationUrl(url, specialType, specialScope);
      url.search = normalizedSpecial.search;
    }
    history.replaceState(detailsOpen ? { id: selectedId } : { route: 'items' }, '', url);
  }

  async function loadDataset(
    targetDatasetId?: string,
    preserveSelection = false,
    expectedVersion?: string
  ): Promise<boolean> {
    const linkedDatasetId = targetDatasetId
      ?? new URLSearchParams(location.search).get('version')
      ?? undefined;
    loadTargetDatasetId = linkedDatasetId;
    loadTargetVersion = expectedVersion;
    loadPreserveSelection = preserveSelection;
    datasetStatus = 'loading';
    datasetError = '';
    datasetProgress = 0;
    datasetStage = 'Starting';
    errorCopied = false;
    const previousRepository = repository;
    repository = null;
    catalog = [];
    if (!preserveSelection) selectedId = '';
    datasetVersion = expectedVersion ?? '…';
    try {
      const loaded = await DatasetRepository.load(
        linkedDatasetId,
        ({ percent, stage, gtnhVersion }) => {
          if (gtnhVersion) datasetVersion = gtnhVersion;
          datasetProgress = percent;
          datasetStage = stage;
        },
        previousRepository ?? undefined
      );
      validateRepository(loaded);
      await loaded.activate();
      await applyRepository(loaded, preserveSelection);
      clearIconSheetCache(new Set(
        loaded.entries
          .map((entry) => entry.icon?.sha256)
          .filter((sha256): sha256 is string => sha256 !== undefined)
      ));
      datasetStatus = 'ready';
      await datasetManager.refreshAvailability();
      return true;
    } catch (error) {
      console.error('Unable to load the GTNH dataset', error);
      datasetError = diagnostic(error);
      datasetStatus = 'error';
      return false;
    }
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    query = catalogSearchFromUrl(params);
    recipeQuery = recipeFilterFromUrl(params);
    navigationUrlReady = true;
    mode = recipeViewFromUrl(params.get('view'));
    const linkedSpecial = specialNavigationFromUrl(params);
    specialType = linkedSpecial.specialType;
    specialScope = linkedSpecial.specialScope;
    const handlePopState = () => {
      const currentParams = new URLSearchParams(location.search);
      const id = currentParams.get('item');
      query = catalogSearchFromUrl(currentParams);
      recipeQuery = recipeFilterFromUrl(currentParams);
      const linkedView = recipeViewFromUrl(currentParams.get('view'));
      const currentSpecial = specialNavigationFromUrl(currentParams);
      if (id && entryById.has(id)) {
        select(id, false, linkedView);
        specialType = currentSpecial.specialType;
        specialScope = currentSpecial.specialScope;
      } else {
        detailsOpen = false;
        specialType = '';
        specialScope = 'item';
        recipeQuery = '';
      }
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void datasetManager.refreshAvailability();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const availabilityTimer = window.setInterval(
      () => void datasetManager.refreshAvailability(),
      15 * 60 * 1_000
    );
    registerSW({
      immediate: true,
      onNeedReload: () => window.location.reload(),
      onNeedRefresh: () => updateReady = true,
      onRegisterError: (error) => console.error('Service worker registration failed', error)
    });
    void loadDataset();
    return () => {
      removeEventListener('popstate', handlePopState);
      removeEventListener('keydown', handleShortcut);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(availabilityTimer);
    };
  });
</script>

<svelte:head><title>{itemOverviewSelected && detailsOpen ? `${itemOverviewSelected.name} - GTNH Recipe Browser` : 'GTNH Recipe Browser'}</title></svelte:head>

<div class="app-shell">
  <AppHeader
    {datasetVersion}
    activeDataset={datasetManager.activeDataset}
    datasetUpdateAvailable={datasetManager.hasRevisionUpdate(repository?.datasetId)}
    {updateReady}
    showHome={() => showItemList(true)}
    openDatasetManager={() => datasetManager.show()}
  />

  {#if datasetStatus !== 'ready'}
    <ApplicationState
      status={datasetStatus}
      stage={datasetStage}
      progress={datasetProgress}
      loadingVersion={datasetVersion === '…' ? undefined : datasetVersion}
      error={datasetError}
      {errorCopied}
      retry={() => loadDataset(loadTargetDatasetId, loadPreserveSelection, loadTargetVersion)}
      {copyError}
    />
  {:else if selected && repository}
  <main class:home-view={!detailsOpen} class:resizing={sidebarResizing} style:--sidebar-width={`${sidebarWidth}px`}>
    <CatalogPane
      {selected}
      {detailsOpen}
      bind:query
      bind:searchInput
      catalog={repository.browseEntries}
      exactCatalog={catalog}
      searchDocuments={repository.searchDocuments}
      bind:sidebarWidth
      bind:sidebarResizing
      select={(id) => select(id)}
    />

    <section class:mobile-visible={detailsOpen} class="detail">
      <button class="back" onclick={() => showItemList()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg>
        Back to items
      </button>
      <ItemOverview
        selected={itemOverviewSelected!}
        {entryById}
        navigate={(id, view) => select(id, true, view)}
      />
      <RecipeBrowser
        {repository}
        {selected}
        {mode}
        {recipeQuery}
        {specialType}
        {specialScope}
        active={detailsOpen}
        setRecipeQuery={setRecipeQuery}
        {setMode}
        setSpecialNavigation={setSpecialNavigation}
        navigate={(id, view) => select(id, true, view)}
      />
    </section>
  </main>
  {/if}
</div>

{#if datasetManager.open}
  <DatasetManager
    datasets={datasetManager.datasets}
    currentDatasetId={repository?.datasetId}
    loading={datasetManager.loading}
    error={datasetManager.error}
    installingDatasetId={datasetManager.installingDatasetId}
    switchingDatasetId={datasetManager.switchingDatasetId}
    installProgress={datasetManager.installProgress}
    storageUsage={datasetManager.storageUsage}
    storageQuota={datasetManager.storageQuota}
    physicalAssetBytes={datasetManager.physicalAssetBytes}
    physicalAssetCount={datasetManager.physicalAssetCount}
    storageReport={datasetManager.storageReport}
    persistentStorage={datasetManager.persistentStorage}
    close={() => datasetManager.open = false}
    install={(version) => datasetManager.install(version)}
    cancelInstall={() => datasetManager.cancelInstall()}
    switchDataset={(version) => datasetManager.switchDataset(version)}
    deleteDataset={(state) => datasetManager.deleteDataset(state)}
  />
{/if}
