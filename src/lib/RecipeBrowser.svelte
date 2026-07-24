<script lang="ts">
  import ItemIcon from './ItemIcon.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import type { CatalogEntry, Recipe, RecipeView } from './types';

  let {
    selected,
    mode,
    modeLabel,
    type = $bindable(),
    types,
    related,
    entryById,
    recipeQuery = $bindable(),
    recipeFilter,
    recipeSearchPending,
    recipeSearchTotal,
    recipeLoading,
    recipeLoadedShards,
    recipeTotalShards,
    recipeError,
    visibleRecipes,
    recipePage,
    recipePageSize,
    recipePageCount,
    recipeCount,
    setMode,
    navigate,
    retry,
    setRecipePage
  }: {
    selected: CatalogEntry;
    mode: RecipeView;
    modeLabel: string;
    type: string;
    types: string[];
    related: Recipe[];
    entryById: Map<string, CatalogEntry>;
    recipeQuery: string;
    recipeFilter: string;
    recipeSearchPending: boolean;
    recipeSearchTotal: number;
    recipeLoading: boolean;
    recipeLoadedShards: number;
    recipeTotalShards: number;
    recipeError: string;
    visibleRecipes: Recipe[];
    recipePage: number;
    recipePageSize: number;
    recipePageCount: number;
    recipeCount: (view: RecipeView) => number | undefined;
    setMode: (view: RecipeView) => void;
    navigate: (id: string, view: RecipeView) => void;
    retry: () => void;
    setRecipePage: (page: number) => void;
  } = $props();
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
    <button class:active={type === tab} onclick={() => type = tab} title={tab} aria-label={tab}>
      {#if tabCrafter}
        <ItemIcon entry={tabCrafter} size={60} selected={type === tab} crisp={false} />
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
        bind:value={recipeQuery}
        placeholder={`Filter ${modeLabel} by item, mod, or metadata…`}
        aria-label={`Filter ${modeLabel}`}
      />
      {#if recipeQuery}
        <button onclick={() => recipeQuery = ''} aria-label="Clear recipe filter">
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
  {#if recipeLoading}
    <div class:partial={related.length > 0} class="recipe-loading" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Loading {modeLabel}…</b>
      <p>{recipeTotalShards > 0
        ? `${recipeLoadedShards} of ${recipeTotalShards} recipe chunks`
        : 'Finding the recipe data needed for this item.'}</p>
      {#if recipeTotalShards > 0}
        <div class="load-progress compact">
          <span style:width={`${recipeLoadedShards / recipeTotalShards * 100}%`}></span>
        </div>
      {/if}
    </div>
  {/if}
  {#if recipeError}
    <div class="no-recipes recipe-error">
      <span>!</span>
      <b>Could not load {modeLabel}</b>
      <p>{recipeError}</p>
      <button onclick={retry}>Try again</button>
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
      <RecipeCard {recipe} {navigate} resolve={(id) => entryById.get(id)} />
    {/each}
    {#if recipeSearchTotal > recipePageSize}
      <nav class="recipe-pagination" aria-label="Recipe pages">
        <button disabled={recipePage === 0} onclick={() => setRecipePage(recipePage - 1)}>
          Previous
        </button>
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
