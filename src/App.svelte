<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import ItemIcon from './lib/ItemIcon.svelte';
  import { oreCycle } from './lib/oreCycle';
  import RecipeCard from './lib/RecipeCard.svelte';
  import { DatasetRepository } from './lib/dataset';
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
  let recipeLimit = $state(30);
  let loadedRecipeCounts = $state<Record<string, number>>({});
  let searchIds = $state<string[]>([]);
  let searchTotal = $state(0);
  let searchPending = $state(true);
  let searchWorker: Worker | null = null;
  let searchRequest = 0;
  let recipeRequest = 0;
  let query = $state('');
  let selectedId = $state('');
  let mode = $state<'recipes' | 'usages'>('recipes');
  let type = $state('');
  let detailsOpen = $state(false);
  let versionOpen = $state(false);
  let updateReady = $state(false);
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
  const matchingRecipes = $derived(type ? related.filter((x) => x.type === type) : []);
  const visibleRecipes = $derived(matchingRecipes.slice(0, recipeLimit));

  $effect(() => {
    const nextQuery = query;
    if (datasetStatus !== 'ready' || !searchWorker) return;
    searchPending = true;
    const request = ++searchRequest;
    const timeout = window.setTimeout(() => {
      searchWorker?.postMessage({ type: 'search', id: request, query: nextQuery });
    }, nextQuery ? 80 : 0);
    return () => window.clearTimeout(timeout);
  });

  $effect(() => {
    selectedId;
    mode;
    type;
    recipeLimit = 30;
  });

  async function refreshRecipes() {
    if (!repository || !selectedId) return;
    const request = ++recipeRequest;
    const entryId = selectedId;
    const view = mode;
    allRecipes = [];
    recipeError = '';
    recipeLoading = true;
    recipeLoadedShards = 0;
    recipeTotalShards = 0;
    try {
      const loaded = await repository.recipesFor(entryId, view, (loadedShards, totalShards) => {
        if (request !== recipeRequest) return;
        recipeLoadedShards = loadedShards;
        recipeTotalShards = totalShards;
      });
      if (request === recipeRequest) {
        allRecipes = loaded;
        loadedRecipeCounts = { ...loadedRecipeCounts, [`${entryId}:${view}`]: loaded.length };
        type = loaded[0]?.type ?? '';
      }
    } catch (error) {
      console.error('Unable to load recipes', error);
      if (request === recipeRequest) {
        allRecipes = [];
        recipeError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === recipeRequest) recipeLoading = false;
    }
  }

  function loadMoreRecipes(node: HTMLElement) {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        recipeLimit = Math.min(recipeLimit + 30, matchingRecipes.length);
      }
    }, { rootMargin: '500px 0px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function select(id: string, push = true, nextMode: 'recipes' | 'usages' = 'recipes') {
    mode = nextMode;
    selectedId = id;
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
    type = '';
    void refreshRecipes();
    const url = new URL(location.href);
    url.searchParams.set('view', mode);
    history.replaceState({ id: selectedId }, '', url);
  }

  function recipeCount(view: 'recipes' | 'usages'): number | undefined {
    if (!selected) return undefined;
    const declared = view === 'recipes' ? selected.productionCount : selected.usageCount;
    return declared ?? loadedRecipeCounts[`${selected.id}:${view}`];
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
    searchWorker = new Worker(new URL('./workers/search.worker.ts', import.meta.url), { type: 'module' });
    searchWorker.onmessage = (event: MessageEvent<
      { type: 'ready' } | { type: 'results'; id: number; total: number; ids: string[] }
    >) => {
      if (event.data.type !== 'results' || event.data.id !== searchRequest) return;
      searchIds = event.data.ids;
      searchTotal = event.data.total;
      searchPending = false;
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
    };
  });
</script>

<svelte:head><title>{selected ? `${selected.name} · ` : ''}GTNH Recipe Browser</title></svelte:head>

<div class="app-shell">
  <header>
    <a class="brand" href="./" aria-label="GTNH Recipe Browser home" onclick={(event) => {
      event.preventDefault();
      detailsOpen = false;
      query = '';
      const url = new URL(location.href);
      url.searchParams.delete('item');
      url.searchParams.delete('view');
      history.pushState({}, '', url);
    }}>
      <span class="brand-cube"><img src="./assets/gtnh-logo.png" alt="" /></span>
      <span><b>GTNH</b><small>RECIPE BROWSER</small></span>
    </a>
    <button class="version" onclick={() => versionOpen = true}>
      <span><i></i> GTNH {datasetVersion}</span><small>Latest stable</small>
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
  <main class:home-view={!detailsOpen}>
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
                <small><span class="mod-name">{entry.mod}</span> · {entry.kind}</small>
                <span class="tooltip-preview">
                  {#if entry.formula}<b>{entry.formula}</b>{/if}
                  {entry.tooltip.join(' · ')}
                </span>
              </span>
              <span class="row-arrow">›</span>
            </button>
          {:else}
            <div class="empty"><b>No matches</b><span>Try fewer terms or another @mod filter.</span></div>
          {/each}
        {/if}
      </div>
      <footer><span><i></i> Catalog ready</span><span>{searchableCatalog.length.toLocaleString()} entries</span></footer>
    </aside>

    <section class:mobile-visible={detailsOpen} class="detail">
      <button class="back" onclick={() => { detailsOpen = false; history.back(); }}>‹ Back to items</button>
      <div class="item-head">
        <ItemIcon entry={selectedIconEntry ?? selected} size={88} selected />
        <div>
          <p>{selected.kind === 'fluid' ? 'FLUID' : selected.kind === 'oreDict' ? 'ORE DICTIONARY' : 'ITEM'} · <span class="mod-name">{selected.mod}</span></p>
          <h1>{selected.name}</h1>
          <div class="ident">{selected.id}</div>
        </div>
      </div>
      <div class="tooltip">
        {#if selected.formula}<b>{selected.formula}</b>{/if}
        {#each selected.tooltip as line}<span>{line}</span>{/each}
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
      <div class="type-row">
        {#each types as tab}
          {@const tabRecipe = related.find((recipe) => recipe.type === tab)}
          {@const tabCrafter = tabRecipe?.crafterId ? entryById.get(tabRecipe.crafterId) : undefined}
          <button class:active={type === tab} onclick={() => type = tab} title={tab} aria-label={tab}>
            {#if tabCrafter}<ItemIcon entry={tabCrafter} size={60} selected={type === tab} crisp={false} />{:else}<span class="machine-fallback">⚙</span>{/if}
          </button>
        {/each}
      </div>
      <div class="recipe-list">
        {#if recipeLoading}
          <div class="recipe-loading" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>
            <b>Loading {mode}…</b>
            <p>{recipeTotalShards > 0
              ? `${recipeLoadedShards} of ${recipeTotalShards} recipe chunks`
              : 'Finding the recipe data needed for this item.'}</p>
            {#if recipeTotalShards > 0}
              <div class="load-progress compact"><span style:width={`${recipeLoadedShards / recipeTotalShards * 100}%`}></span></div>
            {/if}
          </div>
        {:else if recipeError}
          <div class="no-recipes recipe-error">
            <span>!</span><b>Could not load {mode}</b><p>{recipeError}</p>
            <button onclick={refreshRecipes}>Try again</button>
          </div>
        {:else}
          {#each visibleRecipes as recipe (recipe.id)}
            <RecipeCard {recipe} navigate={(id, view) => select(id, true, view)} resolve={(id) => entryById.get(id)} />
          {:else}
            <div class="no-recipes"><span>⌁</span><b>No {mode} found</b><p>This item has no known {mode} in the active dataset.</p></div>
          {/each}
          {#if visibleRecipes.length < matchingRecipes.length}
            <button class="recipe-more" use:loadMoreRecipes onclick={() => recipeLimit += 30}>
              Showing {visibleRecipes.length.toLocaleString()} of {matchingRecipes.length.toLocaleString()} · Load more
            </button>
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
      <div class="dataset"><span class="dataset-icon"><img src="./assets/gtnh-logo.png" alt="" /></span><div><b>GTNH {datasetVersion}</b><small><i></i> {datasetStatus === 'ready' ? 'ACTIVE · CATALOG READY' : datasetStatus.toUpperCase()}</small></div><strong>{datasetStatus === 'ready' ? 'Real data' : 'Unavailable'}</strong></div>
      <button class="download" disabled={datasetStatus !== 'ready'} onclick={() => versionOpen = false}>
        <svg class="download-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"></path></svg>
        Download for offline use
      </button>
      <small class="storage">Verified catalogs and recipe chunks are cached on this device and reused after reload.</small>
    </div>
  </div>
{/if}
