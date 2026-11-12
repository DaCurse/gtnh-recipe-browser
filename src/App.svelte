<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { trackEvent } from './lib/analytics';
  import { initializeShellUpdate } from './lib/shellUpdate';
  import AppHeader from './lib/AppHeader.svelte';
  import ApplicationState from './lib/ApplicationState.svelte';
  import CatalogPane from './lib/CatalogPane.svelte';
  import DatasetManager from './lib/DatasetManager.svelte';
  import { DatasetManagerState } from './lib/datasetManagerState.svelte';
  import ItemOverview from './lib/ItemOverview.svelte';
  import RecipeBrowser from './lib/RecipeBrowser.svelte';
  import ProjectLinks from './lib/ProjectLinks.svelte';
  import LandingPage from './lib/LandingPage.svelte';
  import RecipeFinder from './lib/RecipeFinder.svelte';
  import FeatureLink from './lib/FeatureLink.svelte';
  import QuestBrowser from './lib/questbook/QuestBrowser.svelte';
  import QuestPreviewLayer from './lib/questbook/QuestPreviewLayer.svelte';
  import { keyboardModifiers, updateKeyboardModifiers } from './lib/keyboardModifiers.svelte';
  import QuestVersionPicker from './lib/questbook/QuestVersionPicker.svelte';
  import { questbook } from './lib/questbook/state.svelte';
  import ItemTouchOverlay from './lib/ItemTouchOverlay.svelte';
  import { clearItemTouch, itemTouchState } from './lib/itemTouch.svelte';
  import type { RecipeConstraints } from './lib/recipeFinder';
  import { DatasetRepository } from './lib/dataset';
  import { provideCatalogEntrySource, useCatalogEntry } from './lib/catalogEntryLoad.svelte';
  import BackIcon from './lib/BackIcon.svelte';
  import { clearIconSheetCache } from './lib/iconCache';
  import { createSpecialContextEntry } from './lib/specialContext';
  import {
    finderFromUrl,
    finderUrl,
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

  let datasetLoadSequence = 0;
  let repository = $state<DatasetRepository | null>(null);
  provideCatalogEntrySource(() => questsOpen && questbook.repository ? questbook.repository : repository);
  $effect(() => {
    void repository;
    void selectedId; void landingOpen; void finderOpen; void questsOpen; void detailsOpen; void query;
    untrack(() => { clearItemTouch(); itemTouchState.menu = undefined; });
  });
  let datasetVersion = $state('…');
  let datasetStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let datasetError = $state('');
  let datasetProgress = $state(0);
  let datasetStage = $state('Starting');
  let errorCopied = $state(false);
  let loadTargetDatasetId = $state<string>();
  let loadTargetVersion = $state<string>();
  let loadPreserveSelection = $state(false);
  function isLanding(params: URLSearchParams) {
    return !params.has('page') && !params.has('item') && !params.has('search');
  }
  let landingOpen = $state(isLanding(new URLSearchParams(location.search)));
  let finderDiscovered = $state(false);
  let questsOpen = $state(new URLSearchParams(location.search).get('page') === 'quests');
  let questsDiscovered = $state(false);
  function showQuests(destination?: { id:string; version:string; chapter?:string }) {
    const returnTo=location.href;
    questsDiscovered = true;
    try { localStorage.setItem('gtnh-quests-discovered', '1'); } catch { /* Optional discovery state. */ }
    landingOpen = false; finderOpen = false; questsOpen = true; detailsOpen = false; query = ''; recipeQuery = '';
    if(destination) { questbook.questId=destination.id;questbook.chapterId=destination.chapter ?? ''; }
    const url=questbook.url(location.href);
    if(destination) url.searchParams.set('quest-version',destination.version);
    history.pushState({ route: 'quests', ...(destination ? {questReturnTo:returnTo} : {}) }, '', url);
  }
  function acknowledgeFinder() {
    finderDiscovered = true;
    try { localStorage.setItem('gtnh-finder-discovered', '1'); } catch { /* Storage is optional. */ }
  }
  function showLanding() {
    landingOpen = true;
    questsOpen = false;
    finderOpen = false;
    detailsOpen = false;
    query = '';
    recipeQuery = '';
    const url = new URL(location.href);
    const version = url.searchParams.get('version');
    url.search = '';
    if (version) url.searchParams.set('version', version);
    history.pushState({ route: 'home' }, '', url);
  }
  function catalogUrl(base: string | URL): URL {
    const url = itemListUrl(base);
    url.searchParams.set('page', 'items');
    return url;
  }
  let finderOpen = $state(false);
  let finderMode = $state<'recipes' | 'chain'>('recipes');
  let finderConstraints = $state<RecipeConstraints>({ inputs: [], outputs: [] });
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
  const selection = useCatalogEntry(() => detailsOpen ? selectedId : undefined);
  const itemDataLoading = $derived(selection.loading);
  const itemDataError = $derived(selection.error);

  const navigationBase = $derived.by(() => {
    const url = catalogSearchUrl(location.href, query);
    if (repository) url.searchParams.set('version', repository.datasetId);
    return url;
  });
  const entryById = $derived(repository?.catalogEntriesById ?? new Map<string, CatalogEntry>());
  const selected = $derived(selection.entry ?? entryById.get(selectedId));
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

  let analyticsPage = '';
  let analyticsItem = '';
  $effect(() => {
    if (!navigationUrlReady) return;
    const linkedItem = new URLSearchParams(location.search).get('item');
    const itemPage = detailsOpen || (!repository && Boolean(linkedItem));
    const screen = landingOpen ? 'landing' : questsOpen ? 'quests' : finderOpen ? finderMode === 'chain' ? 'chain' : 'finder' : itemPage ? 'item' : 'catalog';
    const key = [screen, screen === 'item' ? selectedId || linkedItem : '', screen === 'item' ? mode : ''].join('|');
    if (key !== analyticsPage) {
      analyticsPage = key;
      trackEvent('$pageview', repository ? { screen, dataset_version: repository.gtnhVersion } : { screen });
    }
    if (screen === 'item' && detailsOpen && selected && repository) {
      const itemKey = [repository.datasetId, selected.id, mode].join('|');
      if (itemKey === analyticsItem) return;
      analyticsItem = itemKey;
      trackEvent('item_viewed', { item_id: selected.id, item_name: selected.name, view: mode, dataset_version: repository.gtnhVersion });
    } else analyticsItem = '';
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
    landingOpen = false;
    questsOpen = false;
    finderOpen = false;
    mode = nextMode;
    selectedId = id;
    specialType = '';
    specialScope = 'item';
    if (push) recipeQuery = '';
    detailsOpen = true;
    if (push) {
      const url = itemListUrl(location.href);
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
    const wasFinder = finderOpen || landingOpen || questsOpen;
    landingOpen = false;
    questsOpen = false;
    finderOpen = false;
    detailsOpen = false;
    const nextQuery = clearSearch ? '' : query;
    if (clearSearch) query = nextQuery;
    recipeQuery = '';
    const url = catalogSearchUrl(catalogUrl(location.href), nextQuery);
    if (wasFinder) history.pushState({ route: 'items' }, '', url);
    else history.replaceState({ route: 'items' }, '', url);
  }

  function showFinder(next = finderConstraints) {
    landingOpen = false;
    questsOpen = false;
    acknowledgeFinder();
    finderOpen = true;
    detailsOpen = false;
    recipeQuery = '';
    finderConstraints = next;
    history.pushState({ route: 'finder' }, '', finderUrl(location.href, next, finderMode));
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
    datasetVersion = loaded.gtnhVersion;
    const linkedId = new URLSearchParams(location.search).get('item');
    const preferredId = preserveSelection ? selectedId : linkedId;
    selectedId = preferredId && loaded.entries.some((entry) => entry.id === preferredId)
      ? preferredId
      : loaded.entries.find((entry) => entry.searchable !== false)?.id ?? loaded.entries[0]?.id ?? '';
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
    const analyticsStarted = performance.now();
    datasetLoadSequence++;
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
        previousRepository ?? undefined,
        targetDatasetId === undefined
      );
      validateRepository(loaded);
      await loaded.activate();
      await applyRepository(loaded, preserveSelection);
      clearIconSheetCache(new Set(
        loaded.entries
          .map((entry) => entry.icon?.sha256)
          .filter((sha256): sha256 is string => sha256 !== undefined)
      ), loaded.datasetId);
      datasetStatus = 'ready';
      trackEvent('dataset_loaded', { dataset_version: loaded.gtnhVersion, duration_ms: Math.round(performance.now() - analyticsStarted) });
      await datasetManager.refreshAvailability();
      return true;
    } catch (error) {
      trackEvent('dataset_load_failed', { duration_ms: Math.round(performance.now() - analyticsStarted) });
      console.error('Unable to load the GTNH dataset', error);
      datasetError = diagnostic(error);
      datasetStatus = 'error';
      return false;
    }
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    try { finderDiscovered = localStorage.getItem('gtnh-finder-discovered') === '1'; } catch { /* Storage is optional. */ }
    try { questsDiscovered = localStorage.getItem('gtnh-quests-discovered') === '1'; } catch { /* Storage is optional. */ }
    questsOpen = params.get('page') === 'quests';
    if (questsOpen) { questsDiscovered = true; try { localStorage.setItem('gtnh-quests-discovered', '1'); } catch { /* Optional discovery. */ } }
    landingOpen = isLanding(params);
    finderMode = params.get('finder-mode') === 'chain' ? 'chain' : 'recipes';
    const linkedFinder = finderFromUrl(params);
    finderOpen = linkedFinder !== null;
    if (linkedFinder) finderConstraints = linkedFinder;
    query = catalogSearchFromUrl(params);
    recipeQuery = recipeFilterFromUrl(params);
    navigationUrlReady = true;
    mode = recipeViewFromUrl(params.get('view'));
    const linkedSpecial = specialNavigationFromUrl(params);
    specialType = linkedSpecial.specialType;
    specialScope = linkedSpecial.specialScope;
    const handlePopState = () => {
      const currentParams = new URLSearchParams(location.search);
      landingOpen = isLanding(currentParams);
      questsOpen = currentParams.get('page') === 'quests';
      if (questsOpen) { finderOpen = false; detailsOpen = false; return; }
      finderMode = currentParams.get('finder-mode') === 'chain' ? 'chain' : 'recipes';
      const currentFinder = finderFromUrl(currentParams);
      finderOpen = currentFinder !== null;
      if (currentFinder) {
        finderConstraints = currentFinder;
        detailsOpen = false;
        recipeQuery = '';
        return;
      }
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
        const modalInput = document.querySelector<HTMLInputElement>('dialog[open] input');
        if (modalInput) { modalInput.focus(); return; }
        if (finderOpen || landingOpen || questsOpen) {
          showItemList();
          void tick().then(() => searchInput?.focus());
          return;
        }
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
    let disposed = false;
    void initializeShellUpdate().then(async () => {
      const startupSequence = datasetLoadSequence + 1;
      // Do not delay cached browsing while the current network policy arrives.
      const rollout = DatasetRepository.startupRollout(params.get('version') ?? undefined)
        .catch(() => undefined);
      if (!await loadDataset()) return;
      const initialRepository = repository;
      const decision = await rollout;
      if (disposed || !decision || !repository || datasetStatus !== 'ready') return;
      if (datasetLoadSequence !== startupSequence || repository !== initialRepository) {
        // A successful manual switch while the request was pending wins this epoch.
        await repository.acknowledgeRollout(decision.rolloutEpoch);
        return;
      }
      if (decision.datasetId === repository.datasetId) {
        await repository.acknowledgeRollout(decision.rolloutEpoch);
        return;
      }
      // Startup loading preserves the item and falls back to the usable active
      // cache without acknowledging the epoch if the new bootstrap is unavailable.
      await loadDataset(undefined, true, decision.gtnhVersion);
    }).catch((error: unknown) => console.warn('Background dataset rollout unavailable', error));
    return () => {
      disposed = true;
      removeEventListener('popstate', handlePopState);
      removeEventListener('keydown', handleShortcut);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(availabilityTimer);
    };
  });
</script>

<svelte:window onkeydown={updateKeyboardModifiers} onkeyup={updateKeyboardModifiers} onpointermove={updateKeyboardModifiers} onpointerdown={updateKeyboardModifiers} onblur={() => keyboardModifiers.shift = false} />
<svelte:head><title>{questsOpen ? 'Questbook Browser - GT: New Horizons Recipe Browser' : finderOpen ? 'Recipe finder - GT: New Horizons Recipe Browser' : itemOverviewSelected && detailsOpen ? `${itemOverviewSelected.name} - GT: New Horizons Recipe Browser` : 'GT: New Horizons Recipe Browser — Your Pocket NEI'}</title></svelte:head>

<div class="app-shell">
  <QuestPreviewLayer />
  <AppHeader
    {datasetVersion}
    activeDataset={datasetManager.activeDataset}
    datasetUpdateAvailable={datasetManager.hasRevisionUpdate(repository?.datasetId)}
    {updateReady}
    showHome={showLanding}
    showProjectLinks={!landingOpen}
    openDatasetManager={() => datasetManager.show()}
  />

  {#if !landingOpen}
  <nav class="primary-nav" aria-label="Main navigation">
    <FeatureLink label="Items" icon={`${import.meta.env.BASE_URL}assets/navigation/items.png`} href={catalogUrl(navigationBase).href} active={!finderOpen && !questsOpen} onclick={() => showItemList()} />
    <FeatureLink label="Recipe Finder" shortLabel="Finder" icon={`${import.meta.env.BASE_URL}assets/navigation/finder.png`} href={finderUrl(navigationBase, finderConstraints, finderMode).href} active={finderOpen} undiscovered={!finderDiscovered} onclick={() => { acknowledgeFinder(); if (!finderOpen) showFinder(); }} />
    <FeatureLink label="Questbook Browser" shortLabel="Quests" icon={`${import.meta.env.BASE_URL}assets/navigation/quests.png`} href={questbook.url(navigationBase).href} active={questsOpen} undiscovered={!questsDiscovered} onclick={() => { if (!questsOpen) showQuests(); }} />
    {#if questsOpen}<QuestVersionPicker recipeVersion={datasetVersion} />{/if}
  </nav>

  {/if}

  {#if landingOpen}
    <LandingPage exactEntries={entryById} families={repository?.browseEntries ?? []} loading={datasetStatus === 'loading'} progress={datasetProgress} itemsUrl={catalogUrl(navigationBase).href} finderHref={finderUrl(navigationBase, { inputs: [], outputs: [] }).href}
      questHref={questbook.url(navigationBase).href} {finderDiscovered} {questsDiscovered} openQuests={showQuests}
      openItems={() => showItemList(true)} openFinder={() => showFinder({ inputs: [], outputs: [] })} navigate={(id, view) => select(id, true, view)} />
  {:else if questsOpen}
    <QuestBrowser recipeVersion={datasetVersion} navigate={(id, view) => { if (datasetStatus === 'ready' && !entryById.has(id)) return false; select(id, true, view); return true; }} />
  {:else if datasetStatus !== 'ready'}
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
  {:else if finderOpen && repository}
    <RecipeFinder {repository} mode={finderMode} setMode={(next) => { finderMode = next; showFinder(); }} constraints={finderConstraints} change={showFinder} navigate={(id, view) => select(id, true, view)} />
  {:else if selected && repository}
  <main class:home-view={!detailsOpen} class:resizing={sidebarResizing} style:--sidebar-width={`${sidebarWidth}px`}>
    <CatalogPane
      {selected}
      {detailsOpen}
      bind:query
      bind:searchInput
      catalog={repository.browseEntries}
      entryById={repository.browseEntriesById}
      exactEntryById={entryById}
      loadSearchDocuments={(ore) => repository!.loadSearchDocuments(ore)}
      bind:sidebarWidth
      bind:sidebarResizing
      select={(id) => select(id)}
      navigate={(id, view) => select(id, true, view)}
    />

    <section class:mobile-visible={detailsOpen} class="detail">
      <button class="mc-button back" onclick={() => showItemList()}>
        <BackIcon />
        Back to items
      </button>
      <ItemOverview
        selected={itemOverviewSelected!}
        loading={itemDataLoading}
        error={itemDataError}
        retry={() => selection.retry()}
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
        {itemDataLoading}
        {itemDataError}
        setRecipeQuery={setRecipeQuery}
        {setMode}
        setSpecialNavigation={setSpecialNavigation}
        navigate={(id, view) => select(id, true, view)}
        openQuest={(id, version, chapter) => showQuests({id,version,chapter})}
      />
    </section>
  </main>
  {/if}
  {#if finderOpen && !landingOpen}
    <footer class="finder-mobile-footer"><ProjectLinks /></footer>
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

<ItemTouchOverlay />

<style>
  .finder-mobile-footer { display:none; }
  @media(max-width:800px) {
    .finder-mobile-footer { display:flex; flex:none; justify-content:center; padding:4px 12px; border-top:1px solid #343a42; }
  }
  .primary-nav { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; font-weight: 600; }
</style>
