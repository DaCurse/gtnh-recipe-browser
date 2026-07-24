<script lang="ts">
  import type { CatalogEntry, Recipe, RecipeView } from './types';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import RecipeGrid from './RecipeGrid.svelte';
  import { recipeItemInputLabel } from './recipePresentation';
  let { recipe, navigate, resolve }: { recipe: Recipe; navigate: (id: string, view: RecipeView) => void; resolve: (id: string) => CatalogEntry | undefined } = $props();
  const crafter = $derived(recipe.crafterId ? resolve(recipe.crafterId) : undefined);
  let tooltipVisible = $state(false);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let crafterModalOpen = $state(false);
  const crafterOptions = $derived((
    recipe.crafters?.length
      ? recipe.crafters
      : recipe.crafterId
        ? [{ id: recipe.crafterId, role: 'default' as const }]
        : []
  ).flatMap((option) => {
    const entry = resolve(option.id);
    return entry ? [{ ...option, entry }] : [];
  }));

  const itemInputs = $derived(recipe.inputs.filter((ingredient) =>
    ingredient.kind !== 'fluid' && resolve(ingredient.id)?.kind !== 'fluid'));
  const fluidInputs = $derived(recipe.inputs.filter((ingredient) =>
    ingredient.kind === 'fluid' || resolve(ingredient.id)?.kind === 'fluid'));
  const itemOutputs = $derived(recipe.outputs.filter((ingredient) =>
    ingredient.kind !== 'fluid' && resolve(ingredient.id)?.kind !== 'fluid'));
  const fluidOutputs = $derived(recipe.outputs.filter((ingredient) =>
    ingredient.kind === 'fluid' || resolve(ingredient.id)?.kind === 'fluid'));
  const itemInputLabel = $derived(recipeItemInputLabel(
    recipe.type,
    recipe.layout.shapeless,
    recipe.layout.itemInputs
  ));

  function showPointerTooltip(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    tooltipVisible = true;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function movePointerTooltip(event: PointerEvent) {
    if (!tooltipVisible || event.pointerType === 'touch') return;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function showFocusTooltip(event: FocusEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipVisible = true;
    tooltipX = rect.right;
    tooltipY = rect.bottom;
  }

  function openCrafterModal() {
    tooltipVisible = false;
    crafterModalOpen = true;
  }

  function inspectCrafter(id: string, view: 'recipes' | 'machineUsages') {
    crafterModalOpen = false;
    navigate(id, view);
  }

  function crafterRole(role: 'singleblock' | 'multiblock' | 'default'): string {
    if (role === 'singleblock') return 'Single-block machine tier';
    if (role === 'multiblock') return 'Multiblock machine';
    return 'Default crafter';
  }
</script>

<article class="card">
  <div class="card-head">
    <div>
      {#if crafter}
        <button
          class="machine-mark interactive"
          aria-label={`${crafter.name}: view valid machines for ${recipe.type}`}
          onpointerenter={showPointerTooltip}
          onpointermove={movePointerTooltip}
          onpointerleave={() => tooltipVisible = false}
          onfocus={showFocusTooltip}
          onblur={() => tooltipVisible = false}
          onclick={openCrafterModal}
          oncontextmenu={(event) => {
            event.preventDefault();
            navigate(crafter.id, 'machineUsages');
          }}
        >
          <ItemIcon entry={crafter} size={40} crisp={false} />
        </button>
      {:else}
        <span class="machine-mark">⚙</span>
      {/if}
      <strong>{recipe.type}</strong>
    </div>
  </div>
  <div class="recipe-stage">
    <div class="recipe-flow">
      <div class="io-side">
        <RecipeGrid dimensions={recipe.layout.itemInputs} ingredients={itemInputs} {navigate} {resolve} label={itemInputLabel} />
        <RecipeGrid dimensions={recipe.layout.fluidInputs} ingredients={fluidInputs} {navigate} {resolve} label="Fluids" />
      </div>
      <div class="arrow"><span>→</span><small>{recipe.duration}</small></div>
      <div class="io-side">
        <RecipeGrid dimensions={recipe.layout.itemOutputs} ingredients={itemOutputs} {navigate} {resolve} label="Output" showChances />
        <RecipeGrid dimensions={recipe.layout.fluidOutputs} ingredients={fluidOutputs} {navigate} {resolve} label="Fluid output" showChances />
      </div>
    </div>
  </div>
  <div class="meta">
    {#if recipe.voltage}<span title={recipe.voltageExact}><b>⚡</b> {recipe.voltage}</span>{/if}
    {#if recipe.amperage}<span>{recipe.amperage}</span>{/if}
    {#if recipe.eu}<span title={recipe.euExact}>{recipe.eu}</span>{/if}
    {#if recipe.euPerTick}<span title={recipe.euPerTickExact}>{recipe.euPerTick}</span>{/if}
    {#each recipe.metadata ?? [] as line, index (`${index}:${line}`)}<span>{line}</span>{/each}
    {#if recipe.note}<span class="note">{recipe.note}</span>{/if}
  </div>
</article>

{#if crafter && tooltipVisible}
  <FloatingCatalogTooltip
    entry={crafter}
    x={tooltipX}
    y={tooltipY}
    action="Click: Valid machines · Right-click: Current machine usages"
  />
{/if}

<svelte:window onkeydown={(event) => {
  if (crafterModalOpen && event.key === 'Escape') crafterModalOpen = false;
}} />

{#if crafterModalOpen}
  <div class="crafter-scrim" role="presentation" onclick={(event) => {
    if (event.currentTarget === event.target) crafterModalOpen = false;
  }}>
    <div class="crafter-modal" role="dialog" aria-modal="true" aria-label={`Valid machines for ${recipe.type}`}>
      <button class="crafter-close" onclick={() => crafterModalOpen = false} aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
      </button>
      <p>VALID MACHINES</p>
      <h2>{recipe.type}</h2>
      <div class="crafter-list">
        {#each crafterOptions as option (option.id)}
          <section class:current={option.id === recipe.crafterId} class="crafter-option">
            <ItemIcon entry={option.entry} size={56} crisp={false} />
            <div>
              <b>{option.entry.name}</b>
              <small>{crafterRole(option.role)}{option.id === recipe.crafterId ? ' · shown on this recipe' : ''}</small>
            </div>
            <span>
              <button onclick={() => inspectCrafter(option.id, 'recipes')}>Recipes</button>
              <button onclick={() => inspectCrafter(option.id, 'machineUsages')}>Machine Usages</button>
            </span>
          </section>
        {:else}
          <div class="crafter-empty">No concrete machine entries are available for this category.</div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .card { background: linear-gradient(145deg,#292b2f,#202225); border:1px solid #414449; border-radius:12px; overflow:hidden; box-shadow:0 8px 24px #0003; }
  .card-head { min-height:48px; padding:0 14px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #3a3d41; color:#e2e4e6; }
  .machine-mark { display:inline-grid; place-items:center; width:42px; height:42px; margin-right:8px; color:#b4b8bc; vertical-align:middle; }
  .machine-mark.interactive { padding:0; border:0; background:none; cursor:pointer; }
  .machine-mark.interactive:hover { filter:brightness(1.14); }
  .recipe-stage { min-height:132px; overflow-x:auto; scrollbar-width:thin; scrollbar-color:#4b4f54 transparent; }
  .recipe-flow { min-width:max-content; min-height:132px; display:grid; grid-template-columns:max-content 66px max-content; justify-content:center; align-items:center; gap:8px; padding:14px; }
  .io-side { min-width:56px; display:flex; flex-direction:column; justify-content:center; gap:8px; }
  .arrow { color:#c5c9cd; text-align:center; }
  .arrow span { display:block; font:36px system-ui; line-height:1; }
  .arrow small { color:#969ba0; white-space:nowrap; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:10px 14px; min-height:31px; border-top:1px solid #3a3d41; color:#b0b4b8; font-size:12px; }
  .meta span { padding:5px 8px; border-radius:5px; background:#34373b; }
  .meta span:not(.note) { font:13px/1.2 Minecraft,monospace; text-shadow:2px 2px #342C34; }
  .meta b { color:#d6d8da; }
  .meta .note { margin-left:auto; background:transparent; font-style:italic; }
  .crafter-scrim { position:fixed; inset:0; z-index:70; display:grid; place-items:center; padding:18px; background:#050607cc; backdrop-filter:blur(6px); }
  .crafter-modal { position:relative; width:min(620px,100%); max-height:min(82vh,720px); overflow:auto; padding:28px; border:1px solid #4b4f54; border-radius:14px; background:#202226; box-shadow:0 30px 90px #000; text-align:left; }
  .crafter-modal>p { margin:0 46px 7px 0; color:#a5aaaf; font:12px/1.3 Minecraft,ui-sans-serif,system-ui,sans-serif; letter-spacing:.08em; text-shadow:2px 2px #342c34; }
  .crafter-modal h2 { margin:0 46px 20px 0; color:#f0f1f2; font:21px/1.25 Minecraft,ui-sans-serif,system-ui,sans-serif; text-shadow:2px 2px #342c34; }
  .crafter-close { position:absolute; right:10px; top:10px; width:44px; height:44px; display:grid; place-items:center; padding:0; border:0; background:none; color:#aeb3b8; cursor:pointer; }
  .crafter-close svg { width:21px; height:21px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
  .crafter-list { display:flex; flex-direction:column; gap:8px; }
  .crafter-option { display:grid; grid-template-columns:56px minmax(0,1fr) auto; align-items:center; gap:12px; padding:12px; border:1px solid #464a4f; border-radius:9px; background:#292c30; }
  .crafter-option.current { border-color:#71777d; background:#303338; }
  .crafter-option>div { min-width:0; }.crafter-option b,.crafter-option small { display:block; }
  .crafter-option b { overflow:hidden; color:#e5e7e9; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }
  .crafter-option small { margin-top:5px; color:#989da2; font-size:11px; }
  .crafter-option>span { display:flex; gap:7px; }
  .crafter-option button { min-width:82px; min-height:44px; padding:0 11px; border:1px solid #5a5f65; border-radius:7px; background:#35393d; color:#e3e5e7; font-weight:700; cursor:pointer; }
  .crafter-option button:first-child { background:#d1d4d7; color:#17191b; border-color:#d1d4d7; }
  .crafter-empty { padding:28px 12px; color:#92979c; text-align:center; }
  @media (max-width:520px) {
    .recipe-flow { grid-template-columns:max-content 46px max-content; padding:12px 8px; }
    .arrow span { font-size:28px; }
    .crafter-scrim { align-items:center; padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom)); }
    .crafter-modal { max-height:calc(100dvh - 32px); padding:24px 16px; }
    .crafter-option { grid-template-columns:56px minmax(0,1fr); }
    .crafter-option>span { grid-column:1/-1; }
    .crafter-option button { flex:1; }
  }
</style>
