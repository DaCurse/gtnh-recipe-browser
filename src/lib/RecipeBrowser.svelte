<script lang="ts">
  import type { DatasetRepository } from './dataset';
  import ItemIcon from './ItemIcon.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import { RecipeBrowserState } from './recipeBrowserState.svelte';
  import type { CatalogEntry, RecipeView } from './types';

  let {
    repository,
    selected,
    mode,
    active,
    setMode,
    navigate
  }: {
    repository: DatasetRepository;
    selected: CatalogEntry;
    mode: RecipeView;
    active: boolean;
    setMode: (view: RecipeView) => void;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  const state = new RecipeBrowserState({
    repository: () => repository,
    selected: () => selected,
    mode: () => mode,
    active: () => active
  });
  const entryById = $derived(new Map(repository.entries.map((entry) => [entry.id, entry])));
  const related = $derived(state.related);
  const types = $derived(state.types);
  const visibleRecipes = $derived(state.visibleRecipes);
  const recipeSearchTotal = $derived(state.recipeSearchTotal);
  const recipePageCount = $derived(state.recipePageCount);
  const recipeSearchPending = $derived(state.recipeSearchPending);
  const modeLabel = $derived(state.modeLabel);
  const recipeCount = (view: RecipeView) => state.recipeCount(view);
</script>

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
    interchangeable <button onclick={() => navigate(selected.productionOreDictionaryId!, 'recipes')}>
      {selected.productionOreDictionaryId}
    </button> member.
  </div>
{/if}

<div class="type-row">
  {#each types as tab (tab)}
    {@const tabRecipe = related.find((recipe) => recipe.type === tab)}
    {@const tabCrafter = tabRecipe?.typeIconId ? entryById.get(tabRecipe.typeIconId) : undefined}
    <button
      class:active={state.type === tab}
      onclick={() => state.type = tab}
      title={tab}
      aria-label={tab}
    >
      {#if tabCrafter}
        <ItemIcon entry={tabCrafter} size={60} selected={state.type === tab} crisp={false} />
      {:else}
        <span class="machine-fallback">⚙</span>
      {/if}
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
        bind:value={state.recipeQuery}
        placeholder={`Filter ${modeLabel} by item, mod, or metadata…`}
        aria-label={`Filter ${modeLabel}`}
      />
      {#if state.recipeQuery}
        <button onclick={() => state.recipeQuery = ''} aria-label="Clear recipe filter">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7 7 10 10M17 7 7 17"></path>
          </svg>
        </button>
      {/if}
    </div>
    <small>{recipeSearchPending
      ? 'Filtering…'
      : `${recipeSearchTotal.toLocaleString()} matching ${modeLabel}`}</small>
  </div>
{/if}

<div class="recipe-list">
  {#if state.recipeLoading}
    <div class:partial={related.length > 0} class="recipe-loading" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Loading {modeLabel}…</b>
      <p>{state.recipeTotalShards > 0
        ? `${state.recipeLoadedShards} of ${state.recipeTotalShards} recipe chunks`
        : 'Finding the recipe data needed for this item.'}</p>
      {#if state.recipeTotalShards > 0}
        <div class="load-progress compact">
          <span style:width={`${state.recipeLoadedShards / state.recipeTotalShards * 100}%`}></span>
        </div>
      {/if}
    </div>
  {/if}
  {#if state.recipeError}
    <div class="no-recipes recipe-error">
      <span>!</span>
      <b>Could not load {modeLabel}</b>
      <p>{state.recipeError}</p>
      <button onclick={() => state.refresh()}>Try again</button>
    </div>
  {:else if !state.recipeLoading && recipeSearchPending && visibleRecipes.length === 0}
    <div class="recipe-loading partial" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Filtering {modeLabel}…</b>
    </div>
  {:else if !state.recipeLoading && visibleRecipes.length === 0}
    <div class="no-recipes">
      <span>⌁</span>
      <b>{state.recipeFilter ? `No matching ${modeLabel}` : `No ${modeLabel} found`}</b>
      <p>{state.recipeFilter
        ? 'Try fewer terms or clear the recipe filter.'
        : `This item has no known ${modeLabel} in the active dataset.`}</p>
    </div>
  {:else}
    {#each visibleRecipes as recipe (recipe.id)}
      <RecipeCard {recipe} {navigate} resolve={(id) => entryById.get(id)} />
    {/each}
    {#if recipeSearchTotal > state.recipePageSize}
      <nav class="recipe-pagination" aria-label="Recipe pages">
        <button
          disabled={state.recipePage === 0}
          onclick={() => state.setPage(state.recipePage - 1)}
        >Previous</button>
        <span>
          {state.recipePage * state.recipePageSize + 1}–{Math.min(
            (state.recipePage + 1) * state.recipePageSize,
            recipeSearchTotal
          )}
          of {recipeSearchTotal.toLocaleString()}
        </span>
        <button
          disabled={state.recipePage >= recipePageCount - 1}
          onclick={() => state.setPage(state.recipePage + 1)}
        >Next</button>
      </nav>
    {/if}
  {/if}
</div>
