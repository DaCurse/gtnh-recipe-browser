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
  import {
    itemListUrl,
    recipeViewFromUrl,
    recipeViewUrlValue
  } from './lib/navigation';
  import type { CatalogEntry, RecipeView } from './lib/types';

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
  let selectedId = $state('');
  let mode = $state<RecipeView>('recipes');
  let detailsOpen = $state(false);
  let updateReady = $state(false);
  let sidebarWidth = $state(410);
  let sidebarResizing = $state(false);
  let searchInput = $state<HTMLInputElement>();

  const entryById = $derived(new Map(catalog.map((entry) => [entry.id, entry])));
  const selected = $derived(entryById.get(selectedId));
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
    detailsOpen = true;
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('item', id);
      url.searchParams.set('view', recipeViewUrlValue(mode));
      history.pushState({ id }, '', url);
    }
  }

  function setMode(next: RecipeView) {
    mode = next;
    const url = new URL(location.href);
    url.searchParams.set('view', recipeViewUrlValue(mode));
    history.replaceState({ id: selectedId }, '', url);
  }

  function showItemList(clearSearch = false) {
    detailsOpen = false;
    if (clearSearch) query = '';
    history.replaceState({ route: 'items' }, '', itemListUrl(location.href));
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
    const url = new URL(location.href);
    url.searchParams.set('version', loaded.datasetId);
    if (!detailsOpen) {
      url.searchParams.delete('item');
      url.searchParams.delete('view');
    } else {
      url.searchParams.set('item', selectedId);
      url.searchParams.set('view', recipeViewUrlValue(mode));
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
    clearIconSheetCache();
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
        }
      );
      validateRepository(loaded);
      await loaded.activate();
      await applyRepository(loaded, false);
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
    mode = recipeViewFromUrl(params.get('view'));
    const handlePopState = () => {
      const id = new URLSearchParams(location.search).get('item');
      const linkedView = recipeViewFromUrl(new URLSearchParams(location.search).get('view'));
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void datasetManager.refreshAvailability();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const availabilityTimer = window.setInterval(
      () => void datasetManager.refreshAvailability(),
      15 * 60 * 1_000
    );
    registerSW({
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

<svelte:head><title>{selected && detailsOpen ? `${selected.name} - GTNH Recipe Browser` : 'GTNH Recipe Browser'}</title></svelte:head>

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
        {selected}
        {entryById}
        navigate={(id, view) => select(id, true, view)}
      />
      <RecipeBrowser
        {repository}
        {selected}
        {mode}
        active={detailsOpen}
        {setMode}
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
    persistentStorage={datasetManager.persistentStorage}
    close={() => datasetManager.open = false}
    install={(version) => datasetManager.install(version)}
    cancelInstall={() => datasetManager.cancelInstall()}
    switchDataset={(version) => datasetManager.switchDataset(version)}
    deleteDataset={(state) => datasetManager.deleteDataset(state)}
  />
{/if}
