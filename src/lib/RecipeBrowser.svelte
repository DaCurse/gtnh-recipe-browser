<script lang="ts">
  import {
    browserExportFilename,
    createRecipeExport,
    createSpecialExport,
    downloadBrowserExport,
    recipeRecordsForExport,
    specialRecordsForExport
  } from './browserExport';
  import type { DatasetRepository } from './dataset';
  import ItemIcon from './ItemIcon.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import SpecialCard from './SpecialCard.svelte';
  import { RecipeBrowserState } from './recipeBrowserState.svelte';
  import type { CatalogEntry, RecipeView, SpecialScope } from './types';

  let {
    repository,
    selected,
    mode,
    specialType,
    specialScope,
    active,
    setMode,
    setSpecialNavigation,
    navigate
  }: {
    repository: DatasetRepository;
    selected: CatalogEntry;
    mode: RecipeView;
    specialType: string;
    specialScope: SpecialScope;
    active: boolean;
    setMode: (view: RecipeView) => void;
    setSpecialNavigation: (specialType: string, specialScope: SpecialScope) => void;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  const browserState = new RecipeBrowserState({
    repository: () => repository,
    selected: () => selected,
    mode: () => mode,
    active: () => active,
    specialType: () => specialType,
    specialScope: () => specialScope,
    onSpecialNavigation: (nextType, nextScope) => setSpecialNavigation(nextType, nextScope)
  });
  const entryById = $derived(new Map(repository.entries.map((entry) => [entry.id, entry])));
  const related = $derived(browserState.related);
  const types = $derived(browserState.types);
  const specialTypes = $derived(browserState.specialTypes);
  const visibleSpecialRecords = $derived(browserState.visibleSpecialRecords);
  const visibleRecipes = $derived(browserState.visibleRecipes);
  const recipeSearchTotal = $derived(browserState.recipeSearchTotal);
  const recipePageCount = $derived(browserState.recipePageCount);
  const recipeSearchPending = $derived(browserState.recipeSearchPending);
  const modeLabel = $derived(browserState.modeLabel);
  const specialSearchTotal = $derived(browserState.specialSearchTotal);
  const specialPageCount = $derived(browserState.specialPageCount);
  const specialSearchPending = $derived(browserState.specialSearchPending);
  const recipeCount = (view: RecipeView) => browserState.recipeCount(view);

  type ExportTarget = 'pane' | 'machine';
  type ExportChoice = 'filtered' | 'all';
  let exportPrompt = $state<ExportTarget | null>(null);
  let exportWorking = $state(false);
  let exportError = $state('');

  function exportQuery(target: ExportTarget): string {
    if (target === 'machine') return browserState.recipeQuery;
    return browserState.showingSpecial ? browserState.specialQuery : browserState.recipeQuery;
  }

  function requestExport(target: ExportTarget) {
    exportError = '';
    if (exportQuery(target).trim()) {
      exportPrompt = target;
      return;
    }
    void performExport(target, 'all');
  }

  function confirmExport(choice: ExportChoice) {
    const target = exportPrompt;
    exportPrompt = null;
    if (target) void performExport(target, choice);
  }

  async function performExport(target: ExportTarget, choice: ExportChoice) {
    if (exportWorking) return;
    exportWorking = true;
    exportError = '';
    const query = exportQuery(target);
    const applyFilter = choice === 'filtered' && query.trim().length > 0;
    try {
      if (target === 'machine') {
        const machineRecipes = await repository.recipesFor(selected.id, 'machineUsages');
        const activeMachineRecipes = machineRecipes.filter((recipe) => recipe.type === browserState.type);
        const records = recipeRecordsForExport(
          repository,
          activeMachineRecipes,
          browserState.type || null,
          query,
          applyFilter
        );
        const value = createRecipeExport({
          repository,
          selected,
          view: 'machineUsages',
          scope: 'machine',
          recipeType: browserState.type || null,
          query,
          applied: applyFilter,
          records
        });
        downloadBrowserExport(value, browserExportFilename(value));
        return;
      }

      if (browserState.showingSpecial) {
        const viewType = specialTypes.find((candidate) => candidate.id === browserState.specialType);
        if (!viewType) return;
        const records = specialRecordsForExport(browserState.specialRecords, query, applyFilter);
        const value = createSpecialExport({
          repository,
          selected,
          view: mode,
          scope: browserState.showingGlobalSpecial ? 'special-global' : 'pane',
          specialViewType: { id: viewType.id, label: viewType.label },
          query,
          applied: applyFilter,
          records
        });
        downloadBrowserExport(value, browserExportFilename(value));
        return;
      }

      const records = recipeRecordsForExport(
        repository,
        browserState.allRecipes,
        browserState.type || null,
        query,
        applyFilter
      );
      const value = createRecipeExport({
        repository,
        selected,
        view: mode,
        scope: 'pane',
        recipeType: applyFilter ? browserState.type || null : null,
        query,
        applied: applyFilter,
        records
      });
      downloadBrowserExport(value, browserExportFilename(value));
    } catch (error) {
      exportError = error instanceof Error ? error.message : String(error);
    } finally {
      exportWorking = false;
    }
  }
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
      {selected.productionOreDictionaryId!.replace(/^o:/, '')}
    </button> member.
  </div>
{/if}

<div class="type-row">
  {#each types as tab (tab)}
    {@const tabRecipe = related.find((recipe) => recipe.type === tab)}
    {@const tabCrafter = tabRecipe?.typeIconId ? entryById.get(tabRecipe.typeIconId) : undefined}
    <button
      class="machine-tab"
      class:active={browserState.type === tab}
      onclick={() => browserState.selectRecipeType(tab)}
      title={tab}
      aria-label={tab}
    >
      {#if tabCrafter}
        <ItemIcon entry={tabCrafter} size={60} selected={browserState.type === tab} crisp={false} />
      {:else}
        <span class="machine-fallback">⚙</span>
      {/if}
      <small>{tab}</small>
    </button>
  {/each}
  {#each specialTypes as tab (tab.id)}
    {@const tabIcon = tab.iconId ? entryById.get(tab.iconId) : undefined}
    <button
      class:special-tab={true}
      class:active={browserState.specialType === tab.id}
      onclick={() => browserState.selectSpecialType(tab.id)}
      title={tab.label}
      aria-label={tab.label}
    >
      {#if tabIcon}
        <ItemIcon entry={tabIcon} size={60} selected={browserState.specialType === tab.id} crisp={false} />
      {:else}
        <span class="special-fallback">{tab.glyph ?? '✦'}</span>
      {/if}
      {#if browserState.specialCount(mode, tab.id) !== undefined}
        <span class="special-tab-count">{browserState.specialCount(mode, tab.id)}</span>
      {/if}
      <small>{tab.shortLabel ?? tab.label}</small>
    </button>
  {/each}
</div>

<div class="pane-toolbar">
  {#if browserState.showingSpecial}
    <div class="recipe-search-block">
    <div class="recipe-search-wrap">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"></circle>
        <path d="m15.5 15.5 4 4"></path>
      </svg>
      <input
        bind:value={browserState.specialQuery}
        placeholder={`Filter ${browserState.specialTypeLabel} by item, dimension, or metadata…`}
        aria-label={`Filter ${browserState.specialTypeLabel}`}
      />
      {#if browserState.specialQuery}
        <button onclick={() => browserState.specialQuery = ''} aria-label="Clear special-data filter">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7 7 10 10M17 7 7 17"></path>
          </svg>
        </button>
      {/if}
    </div>
    <small>{specialSearchPending
      ? 'Filtering…'
      : `${specialSearchTotal.toLocaleString()} matching ${browserState.specialTypeLabel}`}</small>
    </div>
  {:else if related.length > 0}
    <div class="recipe-search-block">
    <div class="recipe-search-wrap">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"></circle>
        <path d="m15.5 15.5 4 4"></path>
      </svg>
      <input
        bind:value={browserState.recipeQuery}
        placeholder={`Filter ${modeLabel} by item, mod, or metadata…`}
        aria-label={`Filter ${modeLabel}`}
      />
      {#if browserState.recipeQuery}
        <button onclick={() => browserState.recipeQuery = ''} aria-label="Clear recipe filter">
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
  <div class="export-actions">
    <button
      onclick={() => requestExport('pane')}
      disabled={exportWorking || browserState.recipeLoading || browserState.specialLoading}
    >
      {exportWorking ? 'Preparing JSON…' : 'Download pane JSON'}
    </button>
    {#if selected.machineCapabilities?.length && browserState.type}
      <button
        onclick={() => requestExport('machine')}
        disabled={exportWorking || browserState.recipeLoading}
      >Download machine JSON</button>
    {/if}
    {#if exportError}<p class="export-error">Could not download JSON: {exportError}</p>{/if}
  </div>
</div>

<div class="recipe-list">
  {#if browserState.showingSpecial && browserState.specialLoading && browserState.specialRecords.length === 0}
    <div class:partial={browserState.specialRecords.length > 0} class="recipe-loading" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Loading {browserState.specialTypeLabel}…</b>
      <p>{browserState.specialTotalShards > 0
        ? `${browserState.specialLoadedShards} of ${browserState.specialTotalShards} special-data chunks`
        : 'Finding the NEI data needed for this item.'}</p>
      {#if browserState.specialTotalShards > 0}
        <div class="load-progress compact">
          <span style:width={`${browserState.specialLoadedShards / browserState.specialTotalShards * 100}%`}></span>
        </div>
      {/if}
    </div>
  {:else if browserState.showingSpecial && browserState.specialError}
    <div class="no-recipes recipe-error">
      <span>!</span>
      <b>Could not load {browserState.specialTypeLabel}</b>
      <p>{browserState.specialError}</p>
      <button onclick={() => browserState.refresh()}>Try again</button>
    </div>
  {:else if browserState.showingSpecial && specialSearchPending && visibleSpecialRecords.length === 0}
    <div class="recipe-loading partial" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Filtering {browserState.specialTypeLabel}…</b>
    </div>
  {:else if browserState.showingSpecial && visibleSpecialRecords.length === 0}
    <div class="no-recipes">
      <span>⌁</span>
      <b>{browserState.specialFilter ? `No matching ${browserState.specialTypeLabel}` : `No ${browserState.specialTypeLabel} found`}</b>
      <p>{browserState.specialFilter
        ? 'Try fewer terms or clear the special-data filter.'
        : 'This item has no known NEI special data in the active dataset.'}</p>
    </div>
  {:else if browserState.showingSpecial}
    {#if browserState.specialLoading}
      <div class="recipe-loading partial" aria-live="polite">
        <span class="mini-spinner" aria-hidden="true"></span>
        <b>Loading more {browserState.specialTypeLabel}…</b>
        {#if browserState.specialTotalShards > 0}<small>{browserState.specialLoadedShards} of {browserState.specialTotalShards} chunks</small>{/if}
      </div>
    {/if}
    {#each visibleSpecialRecords as record (record.id)}
      <SpecialCard
        {record}
        viewType={specialTypes.find((tab) => tab.id === browserState.specialType)}
        resolve={(id) => entryById.get(id)}
        {navigate}
        showingGlobal={browserState.showingGlobalSpecial}
        showAll={() => browserState.showingGlobalSpecial
          ? browserState.returnToItemSpecial()
          : browserState.enterSpecialGlobal()}
      />
    {/each}
    {#if specialSearchTotal > browserState.specialPageSize}
      <nav class="recipe-pagination" aria-label="Special data pages">
        <button
          disabled={browserState.specialPage === 0}
          onclick={() => browserState.setSpecialPage(browserState.specialPage - 1)}
        >Previous</button>
        <span>
          {browserState.specialPage * browserState.specialPageSize + 1}–{Math.min(
            (browserState.specialPage + 1) * browserState.specialPageSize,
            specialSearchTotal
          )}
          of {specialSearchTotal.toLocaleString()}
        </span>
        <button
          disabled={browserState.specialPage >= specialPageCount - 1}
          onclick={() => browserState.setSpecialPage(browserState.specialPage + 1)}
        >Next</button>
      </nav>
    {/if}
  {:else if browserState.recipePreparing}
    <div class="recipe-loading" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Preparing recipe search…</b>
      <p>
        {browserState.recipeCatalogIndexed.toLocaleString()} of
        {browserState.recipeCatalogTotal.toLocaleString()} catalog entries
      </p>
      {#if browserState.recipeCatalogTotal > 0}
        <div class="load-progress compact">
          <span style:width={`${browserState.recipeCatalogIndexed / browserState.recipeCatalogTotal * 100}%`}></span>
        </div>
      {/if}
    </div>
  {:else if browserState.recipeLoading}
    <div class:partial={related.length > 0} class="recipe-loading" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Loading {modeLabel}…</b>
      <p>{browserState.recipeTotalShards > 0
        ? `${browserState.recipeLoadedShards} of ${browserState.recipeTotalShards} recipe chunks`
        : 'Finding the recipe data needed for this item.'}</p>
      {#if browserState.recipeTotalShards > 0}
        <div class="load-progress compact">
          <span style:width={`${browserState.recipeLoadedShards / browserState.recipeTotalShards * 100}%`}></span>
        </div>
      {/if}
    </div>
  {:else if browserState.recipeError}
    <div class="no-recipes recipe-error">
      <span>!</span>
      <b>Could not load {modeLabel}</b>
      <p>{browserState.recipeError}</p>
      <button onclick={() => browserState.refresh()}>Try again</button>
    </div>
  {:else if !browserState.recipeLoading && recipeSearchPending && visibleRecipes.length === 0}
    <div class="recipe-loading partial" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Filtering {modeLabel}…</b>
    </div>
  {:else if !browserState.recipeLoading && visibleRecipes.length === 0}
    <div class="no-recipes">
      <span>⌁</span>
      <b>{browserState.recipeFilter ? `No matching ${modeLabel}` : `No ${modeLabel} found`}</b>
      <p>{browserState.recipeFilter
        ? 'Try fewer terms or clear the recipe filter.'
        : `This item has no known ${modeLabel} in the active dataset.`}</p>
    </div>
  {:else}
    {#each visibleRecipes as recipe (recipe.id)}
      <RecipeCard {recipe} {navigate} resolve={(id) => entryById.get(id)} />
    {/each}
    {#if recipeSearchTotal > browserState.recipePageSize}
      <nav class="recipe-pagination" aria-label="Recipe pages">
        <button
          disabled={browserState.recipePage === 0}
          onclick={() => browserState.setPage(browserState.recipePage - 1)}
        >Previous</button>
        <span>
          {browserState.recipePage * browserState.recipePageSize + 1}–{Math.min(
            (browserState.recipePage + 1) * browserState.recipePageSize,
            recipeSearchTotal
          )}
          of {recipeSearchTotal.toLocaleString()}
        </span>
        <button
          disabled={browserState.recipePage >= recipePageCount - 1}
          onclick={() => browserState.setPage(browserState.recipePage + 1)}
        >Next</button>
      </nav>
    {/if}
  {/if}
</div>

{#if exportPrompt}
  <div class="export-scrim" role="presentation" onclick={(event) => {
    if (event.currentTarget === event.target) exportPrompt = null;
  }}>
    <div class="export-dialog" role="dialog" aria-modal="true" aria-label="Choose JSON records">
      <button class="export-close" aria-label="Close" onclick={() => exportPrompt = null}>×</button>
      <p class="eyebrow">DOWNLOAD JSON</p>
      <h2>Choose records</h2>
      <p>This pane has an active filter. Download only matching records or the complete pane.</p>
      <div class="export-choice-actions">
        <button class="primary" onclick={() => confirmExport('filtered')}>Filtered results</button>
        <button onclick={() => confirmExport('all')}>All results</button>
      </div>
    </div>
  </div>
{/if}
