<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import ItemIcon from './lib/ItemIcon.svelte';
  import RecipeCard from './lib/RecipeCard.svelte';
  import { byId, entries, recipes } from './lib/demo';
  import { searchCatalog } from './lib/search';
  import type { CatalogEntry } from './lib/types';

  const defaultId = entries[0].id;
  let query = $state('');
  let selectedId = $state(defaultId);
  let mode = $state<'recipes' | 'usages'>('recipes');
  let type = $state('All');
  let detailsOpen = $state(false);
  let versionOpen = $state(false);
  let updateReady = $state(false);
  let searchInput: HTMLInputElement;

  const results = $derived(searchCatalog(entries, query));
  const selected = $derived(byId.get(selectedId) ?? entries[0]);
  const related = $derived(recipes.filter((recipe) => mode === 'recipes'
    ? recipe.outputs.some((x) => x.id === selected.id)
    : recipe.inputs.some((x) => x.id === selected.id)));
  const types = $derived(['All', ...new Set(related.map((x) => x.type))]);
  const visibleRecipes = $derived(type === 'All' ? related : related.filter((x) => x.type === type));

  function select(id: string, push = true) {
    selectedId = id;
    detailsOpen = true;
    type = 'All';
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('item', id);
      url.searchParams.set('view', mode);
      history.pushState({ id }, '', url);
    }
  }

  function setMode(next: 'recipes' | 'usages') {
    mode = next;
    type = 'All';
    const url = new URL(location.href);
    url.searchParams.set('view', mode);
    history.replaceState({ id: selectedId }, '', url);
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('item');
    if (requested && byId.has(requested)) select(requested, false);
    if (params.get('view') === 'usages') mode = 'usages';
    const handlePopState = () => {
      const id = new URLSearchParams(location.search).get('item');
      if (id && byId.has(id)) select(id, false);
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
      <span><i></i> GTNH 2.7.3</span><small>Latest stable</small><b>⌄</b>
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
      <div class="result-bar"><span>{results.length} ITEMS & FLUIDS</span><span class="view-label">TOOLTIP LIST</span></div>
      <div class="item-grid">
        {#each results as entry (entry.id)}
          <button class:active={selected.id === entry.id} class="item-tile" onclick={() => select(entry.id)} title={entry.name}>
            <ItemIcon {entry} size={56} selected={selected.id === entry.id} />
            <span class="item-summary">
              <strong>{entry.name}</strong>
              <small>{entry.mod} · {entry.kind}</small>
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
      <footer><span><i></i> Catalog ready offline</span><span>{entries.length} demo entries</span></footer>
    </aside>

    <section class:mobile-visible={detailsOpen} class="detail">
      <button class="back" onclick={() => { detailsOpen = false; history.back(); }}>‹ Back to items</button>
      <div class="item-head">
        <ItemIcon entry={selected} size={88} selected />
        <div>
          <p>{selected.kind === 'fluid' ? 'FLUID' : 'ITEM'} · {selected.mod}</p>
          <h1>{selected.name}</h1>
          <div class="ident">{selected.id}</div>
        </div>
      </div>
      <div class="tooltip">
        {#if selected.formula}<b>{selected.formula}</b>{/if}
        {#each selected.tooltip as line}<span>{line}</span>{/each}
      </div>

      <nav class="view-tabs" aria-label="Item views">
        <button class:active={mode === 'recipes'} onclick={() => setMode('recipes')}>Recipes <span>{recipes.filter(r => r.outputs.some(x => x.id === selected.id)).length}</span></button>
        <button class:active={mode === 'usages'} onclick={() => setMode('usages')}>Usages <span>{recipes.filter(r => r.inputs.some(x => x.id === selected.id)).length}</span></button>
      </nav>
      <div class="type-row">
        {#each types as tab}
          <button class:active={type === tab} onclick={() => type = tab}>{tab}{#if tab !== 'All'} <span>{related.filter(x => x.type === tab).length}</span>{/if}</button>
        {/each}
      </div>
      <div class="recipe-list">
        {#each visibleRecipes as recipe (recipe.id)}
          <RecipeCard {recipe} navigate={select} />
        {:else}
          <div class="no-recipes"><span>⌁</span><b>No {mode} found</b><p>This item has no known {mode} in the demonstration catalog.</p></div>
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
      <div class="dataset"><span class="dataset-icon"><img src="./assets/gtnh-logo.png" alt="" /></span><div><b>GTNH 2.7.3</b><small><i></i> ACTIVE · CATALOG READY</small></div><strong>Demo</strong></div>
      <button class="download" onclick={() => versionOpen = false}>⇩ Download for offline use</button>
      <small class="storage">The complete production dataset will be available when its pack is published.</small>
    </div>
  </div>
{/if}
