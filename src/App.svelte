<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import ItemIcon from './lib/ItemIcon.svelte';
  import RecipeCard from './lib/RecipeCard.svelte';
  import { entries as demoEntries, recipes as demoRecipes } from './lib/demo';
  import { DatasetRepository } from './lib/dataset';
  import { searchCatalog } from './lib/search';
  import type { CatalogEntry } from './lib/types';

  const defaultId = demoEntries[0].id;
  let catalog = $state<CatalogEntry[]>(demoEntries);
  let allRecipes = $state(demoRecipes);
  let repository = $state<DatasetRepository | null>(null);
  let datasetVersion = $state('Demo');
  let recipeRequest = 0;
  let query = $state('');
  let selectedId = $state(defaultId);
  let mode = $state<'recipes' | 'usages'>('recipes');
  let type = $state('');
  let detailsOpen = $state(false);
  let versionOpen = $state(false);
  let updateReady = $state(false);
  let searchInput: HTMLInputElement;

  const entryById = $derived(new Map(catalog.map((entry) => [entry.id, entry])));
  const searchableCatalog = $derived(catalog.filter((entry) => entry.searchable !== false));
  const results = $derived(searchCatalog(searchableCatalog, query));
  const visibleEntries = $derived(results.slice(0, 300));
  const selected = $derived(entryById.get(selectedId) ?? catalog[0]);
  const related = $derived(allRecipes.filter((recipe) => mode === 'recipes'
    ? recipe.outputs.some((x) => x.id === selected.id)
    : recipe.inputs.some((x) => x.id === selected.id)));
  const types = $derived([...new Set(related.map((x) => x.type))]);
  const visibleRecipes = $derived(type ? related.filter((x) => x.type === type) : []);

  async function refreshRecipes() {
    if (!repository) return;
    const request = ++recipeRequest;
    allRecipes = [];
    try {
      const loaded = await repository.recipesFor(selectedId, mode);
      if (request === recipeRequest) {
        allRecipes = loaded;
        type = loaded[0]?.type ?? '';
      }
    } catch (error) {
      console.error('Unable to load recipes', error);
      if (request === recipeRequest) allRecipes = [];
    }
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

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('item');
    if (requested && entryById.has(requested)) select(requested, false);
    if (params.get('view') === 'usages') mode = 'usages';
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
        searchInput.focus();
      }
    };
    addEventListener('popstate', handlePopState);
    addEventListener('keydown', handleShortcut);
    registerSW({ onNeedRefresh: () => updateReady = true });
    void DatasetRepository.loadLatest().then((loaded) => {
      repository = loaded;
      catalog = loaded.entries;
      datasetVersion = loaded.gtnhVersion;
      const linkedId = new URLSearchParams(location.search).get('item');
      selectedId = linkedId && loaded.entries.some((entry) => entry.id === linkedId)
        ? linkedId
        : loaded.entries.find((entry) => entry.searchable !== false)?.id ?? loaded.entries[0].id;
      type = '';
      void refreshRecipes();
    }).catch((error) => {
      console.error('Using demonstration catalog because the real dataset could not be loaded', error);
    });
    return () => {
      removeEventListener('popstate', handlePopState);
      removeEventListener('keydown', handleShortcut);
    };
  });
</script>

<svelte:head><title>{selected.name} · GTNH Recipe Browser</title></svelte:head>

<div class="app-shell">
  <header>
    <a class="brand" href="./" aria-label="GTNH Recipe Browser home">
      <span class="brand-cube"><img src="./assets/gtnh-logo.png" alt="" /></span>
      <span><b>GTNH</b><small>RECIPE BROWSER</small></span>
    </a>
    <button class="version" onclick={() => versionOpen = true}>
      <span><i></i> GTNH {datasetVersion}</span><small>Latest stable</small><b>⌄</b>
    </button>
    <button class="install" onclick={() => versionOpen = true}>⇩ <span>Offline data</span></button>
  </header>

  {#if updateReady}<button class="update-banner" onclick={() => location.reload()}>A new app version is ready · Refresh</button>{/if}

  <main>
    <aside class:mobile-hidden={detailsOpen}>
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5"></circle>
          <path d="m15.5 15.5 4 4"></path>
        </svg>
        <input bind:this={searchInput} bind:value={query} placeholder="Search items, fluids, or @mod…" aria-label="Search catalog" />
        {#if query}<button onclick={() => query = ''} aria-label="Clear search">×</button>{/if}
        <kbd>Ctrl K</kbd>
      </div>
      <div class="result-bar"><span>{results.length.toLocaleString()} ITEMS & FLUIDS</span></div>
      <div class="item-grid">
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
      </div>
      <footer><span><i></i> Catalog ready</span><span>{searchableCatalog.length.toLocaleString()} entries</span></footer>
    </aside>

    <section class:mobile-visible={detailsOpen} class="detail">
      <button class="back" onclick={() => { detailsOpen = false; history.back(); }}>‹ Back to items</button>
      <div class="item-head">
        <ItemIcon entry={selected} size={88} selected />
        <div>
          <p>{selected.kind === 'fluid' ? 'FLUID' : 'ITEM'} · <span class="mod-name">{selected.mod}</span></p>
          <h1>{selected.name}</h1>
          <div class="ident">{selected.id}</div>
        </div>
      </div>
      <div class="tooltip">
        {#if selected.formula}<b>{selected.formula}</b>{/if}
        {#each selected.tooltip as line}<span>{line}</span>{/each}
      </div>

      <nav class="view-tabs" aria-label="Item views">
        <button class:active={mode === 'recipes'} onclick={() => setMode('recipes')}>Recipes <span>{selected.productionCount ?? related.length}</span></button>
        <button class:active={mode === 'usages'} onclick={() => setMode('usages')}>Usages <span>{selected.usageCount ?? related.length}</span></button>
      </nav>
      <div class="type-row">
        {#each types as tab}
          {@const tabRecipe = related.find((recipe) => recipe.type === tab)}
          {@const tabCrafter = tabRecipe?.crafterId ? entryById.get(tabRecipe.crafterId) : undefined}
          <button class:active={type === tab} onclick={() => type = tab} title={tab} aria-label={tab}>
            {#if tabCrafter}<ItemIcon entry={tabCrafter} size={34} />{:else}<span class="machine-fallback">⚙</span>{/if}
          </button>
        {/each}
      </div>
      <div class="recipe-list">
        {#each visibleRecipes as recipe (recipe.id)}
          <RecipeCard {recipe} navigate={(id, view) => select(id, true, view)} resolve={(id) => entryById.get(id)} />
        {:else}
          <div class="no-recipes"><span>⌁</span><b>No {mode} found</b><p>This item has no known {mode} in the active dataset.</p></div>
        {/each}
      </div>
    </section>
  </main>
</div>

{#if versionOpen}
  <div class="scrim" role="presentation" onclick={(e) => e.currentTarget === e.target && (versionOpen = false)}>
    <div class="manager" role="dialog" aria-modal="true" aria-label="Dataset manager">
      <button class="close" onclick={() => versionOpen = false}>×</button>
      <p class="eyebrow">DATASET MANAGER</p><h2>Your GTNH versions</h2>
      <p>Catalogs are stored on this device. Recipe and icon chunks load as you browse.</p>
      <div class="dataset"><span class="dataset-icon"><img src="./assets/gtnh-logo.png" alt="" /></span><div><b>GTNH {datasetVersion}</b><small><i></i> ACTIVE · CATALOG READY</small></div><strong>{repository ? 'Real data' : 'Demo'}</strong></div>
      <button class="download" onclick={() => versionOpen = false}>⇩ Download for offline use</button>
      <small class="storage">The complete production dataset will be available when its pack is published.</small>
    </div>
  </div>
{/if}
