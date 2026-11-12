<script lang="ts">
  import CatalogPane from './CatalogPane.svelte';
  import { trackEvent } from './analytics';
  import ItemIcon from './ItemIcon.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import { CatalogTooltipHover } from './catalogTooltipHover.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import RecipeChain from './RecipeChain.svelte';
  import { RecipeFinderState } from './recipeFinderState.svelte';
  import type { DatasetRepository } from './dataset';
  import type { RecipeConstraints } from './recipeFinder';
  import type { RecipeView } from './types';

  let { repository, constraints, change, navigate, mode = 'recipes', setMode }: {
    mode?: 'recipes' | 'chain';
    setMode: (mode: 'recipes' | 'chain') => void;
    repository: DatasetRepository;
    constraints: RecipeConstraints;
    change: (next: RecipeConstraints) => void;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();
  const finderState = new RecipeFinderState({ repository: () => repository, constraints: () => constraints, ingredientName: (id) => entries.get(id)?.name ?? 'Unknown ingredient', enabled: () => mode === 'recipes' });
  const entries = $derived(repository.catalogEntriesById);
  const machines = $derived.by(() => {
    const types = new Map<string, { name: string; count: number; iconId?: string }>();
    for (const recipe of finderState.recipes) {
      const machine = types.get(recipe.type) ?? { name: recipe.type, count: 0 };
      machine.count += 1;
      machine.iconId ??= recipe.typeIconId ?? recipe.crafterId;
      types.set(recipe.type, machine);
    }
    return [...types.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const filtered = $derived(finderState.machine ? finderState.recipes.filter((recipe) => recipe.type === finderState.machine) : finderState.recipes);
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
  const visible = $derived(filtered.slice(finderState.page * 20, (finderState.page + 1) * 20));
  const hasConstraints = $derived(constraints.inputs.length + constraints.outputs.length > 0);
  const missing = $derived([...constraints.inputs, ...constraints.outputs].some((id) => !entries.has(id)));
  let picker = $state<'inputs' | 'outputs' | null>(null);
  let pickerQuery = $state('');
  let pickerInput = $state<HTMLInputElement>();
  let pickerWidth = $state(410);
  let resizing = $state(false);
  let dialog = $state<HTMLDialogElement>();
  let opener: HTMLButtonElement | undefined;
  const tooltip = new CatalogTooltipHover();
  $effect(() => {
    const id = tooltip.entry?.id;
    if (id && !constraints.inputs.includes(id) && !constraints.outputs.includes(id)) tooltip.clear();
  });

  $effect(() => {
    if (picker && dialog && !dialog.open) {
      dialog.showModal();
      pickerInput?.focus();
    }
  });
  function openPicker(side: 'inputs' | 'outputs', event: MouseEvent) {
    tooltip.clear();
    opener = event.currentTarget as HTMLButtonElement;
    pickerQuery = '';
    picker = side;
  }
  function closePicker() {
    dialog?.close();
    picker = null;
    opener?.focus();
  }
  function add(id: string) {
    if (!picker) return;
    if (!constraints[picker].includes(id)) trackEvent('finder_ingredient_added', {
      ingredient_id: id, ingredient_name: entries.get(id)?.name ?? id, side: picker, mode,
      dataset_version: repository.gtnhVersion
    });
    change({ ...constraints, [picker]: [...new Set([...constraints[picker], id])] });
    closePicker();
  }
  function remove(side: 'inputs' | 'outputs', id: string) {
    tooltip.clear();
    change({ ...constraints, [side]: constraints[side].filter((selected) => selected !== id) });
  }
</script>

<main class="finder-page" aria-labelledby="finder-title">
  <div class="finder-content" class:chain-mode={mode === 'chain'}>
    <div class="finder-heading">
      <div><h1 id="finder-title">{mode === 'chain' ? 'Recipe chain' : 'Recipe finder'}</h1><p>{mode === 'chain' ? 'Trace a route from available inputs to the outputs you want.' : 'Know part of a recipe? Add its inputs or outputs to find it across all machines.'}</p></div>
      {#if hasConstraints}<button class="mc-button finder-button" onclick={() => change({ inputs: [], outputs: [] })}>Clear all</button>{/if}
    </div>
    <nav class="finder-modes" aria-label="Finder mode"><button class="mc-button" aria-pressed={mode === 'recipes'} onclick={() => setMode('recipes')}>Single recipe</button><button class="mc-button" aria-pressed={mode === 'chain'} onclick={() => setMode('chain')}>Recipe chain</button></nav>
    <div class="finder-constraints">
      {#each ['inputs', 'outputs'] as side (side)}
        {@const direction = side as 'inputs' | 'outputs'}
        <section class="constraint-side" aria-label={side === 'inputs' ? 'Required inputs' : 'Required outputs'}>
          <div class="side-heading"><h2>{side === 'inputs' ? 'Inputs' : 'Outputs'}</h2><button class="mc-button finder-button" onclick={(event) => openPicker(direction, event)}>+ Add {side === 'inputs' ? 'input' : 'output'}</button></div>
          <div class="ingredient-chips">
            {#each constraints[direction] as id (id)}
              {@const entry = entries.get(id)}
              <button class="ingredient-chip" aria-label={`Remove ${entry?.name ?? id} from ${side}`} onclick={() => remove(direction, id)}
                onpointerenter={(event) => tooltip.pointer(event, entry)} onpointermove={(event) => tooltip.pointer(event)}
                onpointerleave={() => tooltip.clear()} onfocus={(event) => tooltip.focus(event, entry)} onblur={() => tooltip.clear()}>
                {#if entry}<ItemIcon {entry} size={32} />{/if}<span>{entry?.name ?? id}<small>{entry?.mod ?? 'Unavailable in this version'}</small></span><b aria-hidden="true">×</b>
              </button>
            {:else}<p class="side-hint">{side === 'inputs' ? 'What goes in?' : 'What comes out?'} Items and fluids both work.</p>{/each}
          </div>
        </section>
      {/each}
    </div>
    <p class="finder-hint">{mode === 'chain' ? 'Add starting ingredients and target outputs to trace the recipe steps between them.' : 'Matches include every selected input and output. Extra ingredients are allowed; amounts are ignored. Interchangeable ingredients are supported.'}</p>
    {#if missing}<p class="finder-warning" role="alert">A selected ingredient is unavailable in this version. Remove it or switch versions to continue.</p>{/if}
    {#if mode === 'chain'}
      {#if constraints.inputs.length && constraints.outputs.length}
        <RecipeChain {repository} {constraints} {navigate} />
      {:else}<div class="finder-message"><b>Choose a starting point and a destination</b><p>Add at least one input and one output above to search for a recipe chain.</p></div>{/if}
    {:else}
    <div class="finder-results-bar">
      <h2 aria-live="polite">{hasConstraints ? `${filtered.length.toLocaleString()} matching recipes${finderState.loading ? ' so far' : ''}` : 'Start with one ingredient'}</h2>
    </div>
    {#if finderState.recipes.length}
      <nav class="machine-ruler" aria-label="Filter by machine">
        <button class="machine-choice" class:active={!finderState.machine} aria-pressed={!finderState.machine} onclick={() => { finderState.machine = ''; finderState.page = 0; }} title="All machines">
          <span class="all-machines-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span class="machine-name">All machines</span><small>{finderState.recipes.length.toLocaleString()}</small>
        </button>
        {#each machines as machine (machine.name)}
          {@const icon = machine.iconId ? entries.get(machine.iconId) : undefined}
          <button class="machine-choice" class:active={finderState.machine === machine.name} aria-pressed={finderState.machine === machine.name} aria-label={machine.name} title={`${machine.name} · ${machine.count.toLocaleString()} recipes`} onclick={() => { finderState.machine = machine.name; finderState.page = 0; }}>
            {#if icon}<ItemIcon entry={icon} size={54} selected={finderState.machine === machine.name} />{:else}<span class="all-machines-icon" aria-hidden="true">⚙</span>{/if}
            <span class="machine-name">{machine.name}</span><small>{machine.count.toLocaleString()}</small>
          </button>
        {/each}
      </nav>
    {/if}
    {#if finderState.error}
      <div class="finder-message" role="alert"><b>Could not finish loading recipes</b><p>{finderState.error}</p><button class="mc-button finder-button" onclick={() => finderState.retry()}>Try again</button></div>
    {:else if !hasConstraints}
      <div class="finder-message"><span class="finder-symbol" aria-hidden="true">⌕</span><b>A few clues are enough</b><p>Add any known input or output above. Combine both sides to narrow the results.</p></div>
    {:else if !finderState.loading && !filtered.length}
      <div class="finder-message"><b>No matching recipes</b><p>Try removing an ingredient or checking which side it belongs on.</p></div>
    {/if}
    {#if finderState.loading}<div class="finder-progress" role="status"><span class="mini-spinner" aria-hidden="true"></span> Finding recipes… {#if finderState.total}<small>{finderState.loaded} of {finderState.total} chunks</small>{/if}</div>{/if}
    <div class="recipe-list finder-recipes">{#each visible as recipe (recipe.id)}<RecipeCard {recipe} {navigate} resolve={(id) => entries.get(id)} />{/each}</div>
    {#if filtered.length > 20}
      <nav class="finder-pagination" aria-label="Finder result pages"><button class="mc-button finder-button" disabled={finderState.page === 0} onclick={() => finderState.page -= 1}>Previous</button><span>Page {finderState.page + 1} of {pageCount}</span><button class="mc-button finder-button" disabled={finderState.page + 1 >= pageCount} onclick={() => finderState.page += 1}>Next</button></nav>
    {/if}
    {/if}
  </div>
</main>

{#if tooltip.entry}
  <FloatingCatalogTooltip entry={tooltip.entry} x={tooltip.x} y={tooltip.y} action="Click: Remove ingredient" />
{/if}

{#if picker}
  <dialog bind:this={dialog} class="finder-picker" aria-labelledby="picker-title" onkeydown={(event) => {
    // Let the nested variant picker handle Escape without closing both layers.
    if (event.key === 'Escape' && dialog?.querySelector('.variant-picker')) event.preventDefault();
  }} oncancel={(event) => { event.preventDefault(); closePicker(); }}>
    <div class="picker-heading"><h2 id="picker-title">Add {picker === 'inputs' ? 'input' : 'output'}</h2><button class="mc-button finder-button" onclick={closePicker}>Close</button></div>
    <div class="picker-catalog">
      <CatalogPane searchContext={picker === 'inputs' ? 'finder_input' : 'finder_output'} selected={repository.entries[0]!} detailsOpen={false} bind:query={pickerQuery} bind:searchInput={pickerInput} catalog={repository.browseEntries} entryById={repository.browseEntriesById} exactEntryById={entries} loadSearchDocuments={() => repository.loadSearchDocuments()} bind:sidebarWidth={pickerWidth} bind:sidebarResizing={resizing} select={add} />
    </div>
  </dialog>
{/if}

<style>
  .finder-page { display:block; flex:1; min-height:0; overflow:auto; padding:28px 24px 60px; }
  .finder-content { max-width:1120px; margin:auto; }
  @media(min-width:1000px) { .finder-content.chain-mode { max-width:none; } }
  .finder-heading,.side-heading,.finder-results-bar { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  h1 { font-size:26px; margin:0 0 8px; } h2 { font-size:16px; margin:0; }
  p { color:#969da5; line-height:1.5; } .finder-heading p { margin:0; }
  .finder-modes { display:flex; gap:4px; margin-top:20px; width:max-content; padding:4px; border:1px solid #414d5c; border-radius:8px; background:#191f27; }.finder-modes button { padding:9px 14px; min-height:40px; border:0; border-radius:5px; background:transparent; color:#a3b0c0; cursor:pointer; }.finder-modes button[aria-pressed="true"] { background:#35465c; color:#ecf3fd; }
  .finder-constraints { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:24px; }
  .constraint-side { min-width:0; padding:16px; border:1px solid #41464c; border-radius:10px; background:#1c1f23; }
  .finder-button { min-height:40px; border:1px solid #50575f; border-radius:7px; padding:8px 12px; background:#292e34; cursor:pointer; white-space:nowrap; }
  .finder-button:hover { background:#343b43; } .finder-button:disabled { opacity:.4; cursor:default; }
  .ingredient-chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
  .ingredient-chip { display:flex; align-items:center; gap:8px; max-width:100%; padding:6px 8px; border:1px solid #5b6570; border-radius:7px; background:#2c333a; text-align:left; cursor:pointer; }
  .ingredient-chip span { min-width:0; overflow-wrap:anywhere; font-size:13px; }.ingredient-chip small { display:block; color:#a1aab4; margin-top:3px; }.ingredient-chip b { padding:0 4px; font-size:20px; color:#aeb6bf; }
  .side-hint { font-size:13px; margin:4px 0 8px; }.finder-hint { font-size:12px; margin:12px 0 26px; }
  .finder-results-bar { margin-bottom:16px; flex-wrap:wrap; }
  .machine-ruler { display:flex; gap:6px; max-width:100%; min-width:0; overflow-x:auto; overscroll-behavior-x:contain; scroll-snap-type:x proximity; scrollbar-color:#566170 #1a1e23; padding:0 0 8px; margin-bottom:20px; border-bottom:1px solid #3e4752; }
  .machine-choice { position:relative; flex:0 0 96px; display:flex; flex-direction:column; align-items:center; gap:7px; padding:10px 5px 8px; border:1px solid transparent; border-bottom:3px solid transparent; border-radius:8px 8px 0 0; background:transparent; cursor:pointer; scroll-snap-align:start; }
  .machine-choice:hover { background:#ffffff09; }.machine-choice.active { background:#a8bfdc12; border-color:#7289a644; border-bottom-color:#b6cce7; }.machine-choice:focus-visible { outline:2px solid #c2d8f3; outline-offset:-3px; }
  .machine-name { display:block; max-width:100%; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; min-height:15px; font-size:11px; line-height:15px; text-align:center; color:#b5bec9; }.active .machine-name { color:#eff5fc; }
  .machine-choice small { position:absolute; top:5px; right:4px; border:1px solid #435166; color:#bacbdf; font-size:10px; background:#18212deb; padding:2px 7px; border-radius:10px; }
  .all-machines-icon { width:54px; height:54px; display:grid; place-items:center; border:1px solid #586575; border-radius:5px; background:#252d36; font-size:30px; color:#b8cce4; }.all-machines-icon svg { width:28px; height:28px; fill:currentColor; }
  .finder-message { padding:50px 16px; border:1px dashed #3a424b; border-radius:10px; text-align:center; }.finder-message b { display:block; }.finder-message p { margin:10px auto; max-width:450px; font-size:14px; }.finder-symbol { display:block; font-size:40px; color:#c8d5e4; margin-bottom:12px; }
  .finder-progress { display:flex; gap:10px; align-items:center; padding:12px 0 18px; color:#bac2cb; font-size:13px; }.finder-progress small { color:#919ba7; }
  .finder-warning { color:#e4ca8b; }.finder-recipes { max-width:none; }.finder-pagination { display:flex; gap:16px; align-items:center; justify-content:center; margin-top:24px; font-size:13px; }
  .finder-picker { padding:0; width:min(760px,calc(100% - 24px)); height:min(760px,88dvh); max-height:88dvh; border:1px solid #59626e; border-radius:12px; color:#e7e9eb; background:#1a1b1e; overflow:hidden; }
  .finder-picker::backdrop { background:#000b; }.picker-heading { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid #41464c; height:66px; }.picker-catalog { height:calc(100% - 66px); display:grid; }
  .picker-catalog :global(aside) { height:100%; min-height:0; border:0; }.picker-catalog :global(.item-grid) { grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); }.picker-catalog :global(.sidebar-resizer) { display:none; }
  @media(max-width:700px) { .finder-page { padding:20px 14px 40px; }.finder-constraints { grid-template-columns:1fr; gap:12px; margin-top:18px; } h1 { font-size:23px; }.finder-heading { align-items:flex-start; }.finder-heading p { font-size:13px; }.constraint-side { padding:12px; }.finder-hint { margin-bottom:20px; }.finder-message { padding:28px 14px; } }
</style>
