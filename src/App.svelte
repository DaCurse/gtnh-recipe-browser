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
    RecipeView
  } from './lib/types';

  let catalog = $state<CatalogEntry[]>([]);
  let repository = $state<DatasetRepository | null>(null);
  let datasetVersion = $state('…');
  let datasetStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let datasetError = $state('');
  let datasetProgress = $state(0);
  let datasetStage = $state('Starting');
  let errorCopied = $state(false);
  let query = $state('');
  let selectedId = $state('');
  let mode = $state<RecipeView>('recipes');
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
  const selected = $derived(entryById.get(selectedId));
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
    detailsOpen = true;
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('item', id);
      url.searchParams.set('view', viewUrlValue(mode));
      history.pushState({ id }, '', url);
    }
  }

  function setMode(next: RecipeView) {
    mode = next;
    const url = new URL(location.href);
    url.searchParams.set('view', viewUrlValue(mode));
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
    }
    history.replaceState(detailsOpen ? { id: selectedId } : { route: 'items' }, '', url);
  }

  async function loadDataset(targetDatasetId?: string) {
    datasetStatus = 'loading';
    datasetError = '';
    datasetProgress = 0;
    datasetStage = 'Starting';
    errorCopied = false;
    repository = null;
    catalog = [];
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
  {:else if selected && repository}
  <main class:home-view={!detailsOpen} class:resizing={sidebarResizing} style:--sidebar-width={`${sidebarWidth}px`}>
    <CatalogPane
      {selected}
      {detailsOpen}
      bind:query
      bind:searchInput
      {catalog}
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
