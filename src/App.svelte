<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import CatalogTooltip from './lib/CatalogTooltip.svelte';
  import ItemIcon from './lib/ItemIcon.svelte';
  import MinecraftText from './lib/MinecraftText.svelte';
  import { oreCycle } from './lib/oreCycle';
  import RecipeCard from './lib/RecipeCard.svelte';
  import { DatasetRepository } from './lib/dataset';
  import { itemListUrl } from './lib/navigation';
  import { boundedPage } from './lib/recipePresentation';
  import { normalize } from './lib/search';
  import type { CatalogEntry, Recipe } from './lib/types';

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
  let recipeSearchPending = $state(false);
  let searchIds = $state<string[]>([]);
  let searchTotal = $state(0);
  let searchPending = $state(true);
  let searchLoadingMore = $state(false);
  let searchWorker: Worker | null = null;
  let recipeAbortController: AbortController | null = null;
  let recipeDocumentCache = new Map<string, string>();
  let searchRequest = 0;
  let recipeRequest = 0;
  let query = $state('');
  let selectedId = $state('');
  let mode = $state<'recipes' | 'usages'>('recipes');
  let type = $state('');
  let detailsOpen = $state(false);
  let versionOpen = $state(false);
  let updateReady = $state(false);
  let sidebarWidth = $state(410);
  let sidebarResizing = $state(false);
  let searchInput = $state<HTMLInputElement>();

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
  const recipeTerms = $derived(normalize(recipeFilter).split(/\s+/).filter(Boolean));
  const matchingRecipes = $derived(type ? related.filter((recipe) =>
    recipe.type === type &&
    recipeTerms.every((term) => recipeSearchDocumentCached(recipe).includes(term))) : []);
  const recipePageSize = 20;
  const recipePageCount = $derived(Math.max(1, Math.ceil(matchingRecipes.length / recipePageSize)));
  const visibleRecipes = $derived(boundedPage(matchingRecipes, recipePage, recipePageSize));

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
    recipeSearchPending = nextQuery !== recipeFilter;
    const timeout = window.setTimeout(() => {
      recipeFilter = nextQuery;
      recipeSearchPending = false;
    }, nextQuery ? 100 : 0);
    return () => window.clearTimeout(timeout);
  });

  function recipeSearchDocument(recipe: Recipe): string {
    const ingredientText = [...recipe.inputs, ...recipe.outputs].flatMap((ingredient) => {
      const ids = [ingredient.id, ...(ingredient.alternatives ?? [])];
      return ids.flatMap((id) => {
        const entry = entryById.get(id);
        return entry ? [id, entry.name, entry.mod, ...entry.tooltip] : [id];
      });
    });
    return normalize([
      recipe.id,
      recipe.type,
      recipe.duration,
      recipe.voltage,
      recipe.eu,
      recipe.euExact,
      recipe.euPerTick,
      recipe.euPerTickExact,
      ...(recipe.metadata ?? []),
      recipe.note,
      ...ingredientText
    ].filter(Boolean).join(' '));
  }

  function recipeSearchDocumentCached(recipe: Recipe): string {
    if (recipeTerms.length === 0) return '';
    let document = recipeDocumentCache.get(recipe.id);
    if (document === undefined) {
      document = recipeSearchDocument(recipe);
      recipeDocumentCache.set(recipe.id, document);
    }
    return document;
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
    recipeDocumentCache = new Map();
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

  function select(id: string, push = true, nextMode: 'recipes' | 'usages' = 'recipes') {
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
      url.searchParams.set('view', mode);
      history.pushState({ id }, '', url);
    }
  }

  function setMode(next: 'recipes' | 'usages') {
    mode = next;
    recipeQuery = '';
    recipeFilter = '';
    type = '';
    void refreshRecipes();
    const url = new URL(location.href);
    url.searchParams.set('view', mode);
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

  function recipeCount(view: 'recipes' | 'usages'): number | undefined {
    if (!selected) return undefined;
    const declared = view === 'recipes' ? selected.productionCount : selected.usageCount;
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

  async function loadDataset() {
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
      const loaded = await DatasetRepository.loadLatest(({ percent, stage }) => {
        datasetProgress = percent;
        datasetStage = stage;
      });
      if (!loaded.entries.some((entry) => entry.searchable !== false)) {
        throw new Error('The verified catalog does not contain any searchable items or fluids');
      }
      repository = loaded;
      catalog = loaded.entries;
      datasetVersion = loaded.gtnhVersion;
      const linkedId = new URLSearchParams(location.search).get('item');
      selectedId = linkedId && loaded.entries.some((entry) => entry.id === linkedId)
        ? linkedId
        : loaded.entries.find((entry) => entry.searchable !== false)?.id ?? loaded.entries[0]?.id ?? '';
      searchWorker?.postMessage({
        type: 'init',
        catalog: loaded.entries
          .filter((entry) => entry.searchable !== false)
          .map(({ id, name, mod }) => ({ id, name, mod }))
      });
      datasetStatus = 'ready';
      type = '';
      if (selectedId) await refreshRecipes();
    } catch (error) {
      console.error('Unable to load the GTNH dataset', error);
      datasetError = diagnostic(error);
      datasetStatus = 'error';
    }
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'usages') mode = 'usages';
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
    const handlePopState = () => {
      const id = new URLSearchParams(location.search).get('item');
      const linkedView = new URLSearchParams(location.search).get('view') === 'usages' ? 'usages' : 'recipes';
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
      recipeAbortController?.abort();
      recipeAbortController = null;
    };
  });
</script>

<svelte:head><title>{selected && detailsOpen ? `GTNH Recipe Browser - ${selected.name}` : 'GTNH Recipe Browser'}</title></svelte:head>

<div class="app-shell">
  <header>
    <a class="brand" href="./" aria-label="GTNH Recipe Browser home" onclick={(event) => {
      event.preventDefault();
      showItemList(true);
    }}>
      <span class="brand-cube"><img src="./assets/gtnh-logo.png" alt="" /></span>
      <span><b>GTNH</b><small>RECIPE BROWSER</small></span>
    </a>
    <button class="version" onclick={() => versionOpen = true}>
      <span><i></i> {datasetVersion}</span><small>Latest stable</small>
      <svg class="chevron-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"></path></svg>
    </button>
    <button class="install" onclick={() => versionOpen = true}>
      <svg class="download-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"></path></svg>
      <span>Offline data</span>
    </button>
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
          <button class="primary" onclick={loadDataset}>Try again</button>
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
            <button class:active={selected.id === entry.id} class="item-tile" onclick={() => select(entry.id)} title={entry.name}>
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
      <footer><span><i></i> Catalog ready</span><span>{searchableCatalog.length.toLocaleString()} entries</span></footer>
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
                  title={`${member.name}\nLeft-click: recipes · Right-click: usages`}
                  onclick={() => select(member.id, true, 'recipes')}
                  oncontextmenu={(event) => {
                    event.preventDefault();
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
              placeholder={`Filter ${mode} by item, mod, or metadata…`}
              aria-label={`Filter ${mode}`}
            />
            {#if recipeQuery}
              <button onclick={() => recipeQuery = ''} aria-label="Clear recipe filter">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
              </button>
            {/if}
          </div>
          <small>{recipeSearchPending
            ? 'Filtering…'
            : `${matchingRecipes.length.toLocaleString()} matching ${mode}`}</small>
        </div>
      {/if}
      <div class="recipe-list">
        {#if recipeLoading}
          <div class:partial={related.length > 0} class="recipe-loading" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>
            <b>Loading {mode}…</b>
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
            <span>!</span><b>Could not load {mode}</b><p>{recipeError}</p>
            <button onclick={refreshRecipes}>Try again</button>
          </div>
        {:else if !recipeLoading && visibleRecipes.length === 0}
          <div class="no-recipes">
            <span>⌁</span>
            <b>{recipeFilter ? `No matching ${mode}` : `No ${mode} found`}</b>
            <p>{recipeFilter
              ? 'Try fewer terms or clear the recipe filter.'
              : `This item has no known ${mode} in the active dataset.`}</p>
          </div>
        {:else}
          {#each visibleRecipes as recipe (recipe.id)}
            <RecipeCard {recipe} navigate={(id, view) => select(id, true, view)} resolve={(id) => entryById.get(id)} />
          {/each}
          {#if matchingRecipes.length > recipePageSize}
            <nav class="recipe-pagination" aria-label="Recipe pages">
              <button
                disabled={recipePage === 0}
                onclick={() => setRecipePage(recipePage - 1)}
              >Previous</button>
              <span>
                {recipePage * recipePageSize + 1}–{Math.min((recipePage + 1) * recipePageSize, matchingRecipes.length)}
                of {matchingRecipes.length.toLocaleString()}
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
      <p>Catalogs are stored on this device. Recipe and icon chunks load as you browse.</p>
      <div class="dataset"><span class="dataset-icon"><img src="./assets/gtnh-logo.png" alt="" /></span><div><b>{datasetVersion}</b><small><i></i> {datasetStatus === 'ready' ? 'ACTIVE · CATALOG READY' : datasetStatus.toUpperCase()}</small></div><strong>{datasetStatus === 'ready' ? 'Real data' : 'Unavailable'}</strong></div>
      <button class="download" disabled={datasetStatus !== 'ready'} onclick={() => versionOpen = false}>
        <svg class="download-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"></path></svg>
        Download for offline use
      </button>
      <small class="storage">Verified catalogs and recipe chunks are cached on this device and reused after reload.</small>
    </div>
  </div>
{/if}
