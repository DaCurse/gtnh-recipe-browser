<script lang="ts">
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { oreCycle } from './oreCycle';
  import { ingredientsByGridSlot } from './recipePresentation';
  import type { CatalogEntry, GridDimensions, Ingredient } from './types';

  let {
    dimensions,
    ingredients,
    navigate,
    resolve,
    label,
    showChances = false
  }: {
    dimensions: GridDimensions;
    ingredients: Ingredient[];
    navigate: (id: string, view: 'recipes' | 'usages') => void;
    resolve: (id: string) => CatalogEntry | undefined;
    label?: string;
    showChances?: boolean;
  } = $props();

  const cellCount = $derived(dimensions.columns * dimensions.rows);
  const slotIngredients = $derived(ingredientsByGridSlot(ingredients, dimensions));
  let chooserOpen = $state(false);
  let chosenItemId = $state('');
  let chosenOreId = $state('');
  let tooltipEntry = $state<CatalogEntry>();
  let tooltipOreId = $state('');
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  const chosenItem = $derived(chosenItemId ? resolve(chosenItemId) : undefined);
  const chosenOre = $derived(chosenOreId ? resolve(chosenOreId) : undefined);

  function openOreChooser(itemId: string, oreId: string) {
    chosenItemId = itemId;
    chosenOreId = oreId;
    chooserOpen = true;
  }

  function choose(id: string, view: 'recipes' | 'usages') {
    chooserOpen = false;
    navigate(id, view);
  }

  function showPointerTooltip(event: PointerEvent, entry: CatalogEntry, oreId?: string) {
    if (event.pointerType === 'touch') return;
    tooltipEntry = entry;
    tooltipOreId = oreId ?? '';
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function movePointerTooltip(event: PointerEvent) {
    if (!tooltipEntry || event.pointerType === 'touch') return;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function showFocusTooltip(event: FocusEvent, entry: CatalogEntry, oreId?: string) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipEntry = entry;
    tooltipOreId = oreId ?? '';
    tooltipX = rect.right;
    tooltipY = rect.bottom;
  }

  function hideTooltip() {
    tooltipEntry = undefined;
    tooltipOreId = '';
  }

  function displayAmount(value: number, fluid: boolean): string {
    const suffix = fluid ? 'L' : '';
    if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))}B${suffix}`;
    if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M${suffix}`;
    if (value >= 10_000) return `${Number((value / 1_000).toFixed(1))}k${suffix}`;
    return `${value}${suffix}`;
  }
</script>

{#if cellCount > 0}
  <div class="grid-wrap">
    {#if label}<span class="grid-label">{label}</span>{/if}
    <div
      class="slot-grid"
      style:grid-template-columns={`repeat(${dimensions.columns}, 56px)`}
      aria-label={label}
    >
      {#each Array(cellCount) as _, slot}
        {@const ingredient = slotIngredients.get(slot)}
        {@const alternatives = ingredient?.alternatives ?? []}
        {@const alternativeIndex = alternatives.length > 0 ? $oreCycle % alternatives.length : 0}
        {@const displayId = alternatives[alternativeIndex] ?? ingredient?.id}
        {@const entry = displayId ? resolve(displayId) : undefined}
        {#if ingredient && entry}
          <button
            class="ingredient"
            aria-label={ingredient.oreDictionaryId
              ? `${ingredient.oreDictionaryId}, showing ${entry.name}, alternative ${alternativeIndex + 1} of ${alternatives.length}`
              : entry.name}
            onpointerenter={(event) => showPointerTooltip(event, entry, ingredient.oreDictionaryId)}
            onpointermove={movePointerTooltip}
            onpointerleave={hideTooltip}
            onfocus={(event) => showFocusTooltip(event, entry, ingredient.oreDictionaryId)}
            onblur={hideTooltip}
            onclick={() => ingredient.oreDictionaryId
              ? openOreChooser(entry.id, ingredient.oreDictionaryId)
              : navigate(ingredient.id, 'recipes')}
            oncontextmenu={(event) => {
              event.preventDefault();
              if (ingredient.oreDictionaryId) openOreChooser(entry.id, ingredient.oreDictionaryId);
              else navigate(ingredient.id, 'usages');
            }}
          >
            <ItemIcon {entry} size={56} />
            {#if ingredient.oreDictionaryId}
              <span class="ore-count">ORE ×{alternatives.length}</span>
            {/if}
            {#if ingredient.amount !== undefined && (ingredient.amount !== 1 || entry.kind === 'fluid')}
              <span class="amount">
                {displayAmount(ingredient.amount, entry.kind === 'fluid')}
              </span>
            {/if}
            {#if showChances && ingredient.chance !== undefined && ingredient.chance < 1}
              <span class="chance">{Math.round(ingredient.chance * 100)}%</span>
            {/if}
          </button>
        {:else}
          <span class="empty-slot" aria-hidden="true"></span>
        {/if}
      {/each}
    </div>
  </div>
{/if}

{#if tooltipEntry}
  <FloatingCatalogTooltip
    entry={tooltipEntry}
    x={tooltipX}
    y={tooltipY}
    action={tooltipOreId
      ? 'Left/right-click: choose item or ore dictionary · Then select Recipes or Usages'
      : 'Left-click: Recipes · Right-click: Usages'}
  />
{/if}

<svelte:window onkeydown={(event) => {
  if (chooserOpen && event.key === 'Escape') chooserOpen = false;
}} />

{#if chooserOpen && chosenItem && chosenOre}
  <div class="ore-choice-scrim" role="presentation" onclick={(event) => {
    if (event.currentTarget === event.target) chooserOpen = false;
  }}>
    <div class="ore-choice" role="dialog" aria-modal="true" aria-label="Choose ore dictionary destination" tabindex="-1">
      <button class="choice-close" onclick={() => chooserOpen = false} aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
      </button>
      <p class="choice-eyebrow">INTERCHANGEABLE INGREDIENT</p>
      <h2>What do you want to inspect?</h2>
      <div class="choice-option">
        <ItemIcon entry={chosenItem} size={56} />
        <div><b>{chosenItem.name}</b><small>Only this specific item</small></div>
        <span class="choice-actions">
          <button onclick={() => choose(chosenItem.id, 'recipes')}>Recipes</button>
          <button onclick={() => choose(chosenItem.id, 'usages')}>Usages</button>
        </span>
      </div>
      <div class="choice-option">
        <ItemIcon entry={chosenItem} size={56} />
        <div><b>{chosenOre.name}</b><small>All {chosenOre.members?.length ?? 0} valid alternatives</small></div>
        <span class="choice-actions">
          <button onclick={() => choose(chosenOre.id, 'recipes')}>Recipes</button>
          <button onclick={() => choose(chosenOre.id, 'usages')}>Usages</button>
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .grid-wrap { display:flex; flex-direction:column; align-items:center; gap:4px; }
  .grid-label { color:#8d9297; font-size:10px; letter-spacing:.65px; text-transform:uppercase; }
  .slot-grid { display:grid; grid-auto-rows:56px; }
  .ingredient { position:relative; width:56px; height:56px; padding:0; border:0; background:none; cursor:pointer; }
  .ingredient:hover { filter:brightness(1.14); z-index:1; }
  .empty-slot { width:56px; height:56px; background:url('/assets/inventory-slot.webp') center/cover no-repeat; image-rendering:pixelated; opacity:.46; }
  .amount { position:absolute; right:8px; bottom:8px; z-index:2; max-width:42px; overflow:hidden; padding:2px 3px 1px; border-radius:3px; background:#111d; color:#fff; font:750 13px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:-.04em; text-overflow:clip; white-space:nowrap; box-shadow:0 0 0 1px #ffffff18; text-shadow:1px 1px #000; }
  .chance { position:absolute; left:3px; top:3px; z-index:2; padding:2px 3px; border-radius:2px; background:#17181bd9; color:#eef0f2; font:11px Minecraft,monospace; text-shadow:2px 2px #342C34; }
  .ore-count { position:absolute; left:3px; top:3px; z-index:2; max-width:50px; overflow:hidden; padding:2px 3px; border-radius:2px; background:#17181be8; color:#dfe2e5; font:700 8px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:-.02em; white-space:nowrap; text-shadow:1px 1px #000; }
  .ore-choice-scrim { position:fixed; inset:0; z-index:60; display:grid; place-items:center; padding:18px; background:#050607cc; backdrop-filter:blur(6px); }
  .ore-choice { position:relative; width:min(560px,100%); padding:28px; border:1px solid #4b4f54; border-radius:14px; background:#202226; box-shadow:0 30px 90px #000; text-align:left; }
  .choice-eyebrow { margin:0 42px 7px 0; color:#a5aaaf; font:12px/1.3 Minecraft,ui-sans-serif,system-ui,sans-serif; letter-spacing:.08em; text-shadow:2px 2px #342c34; }
  .ore-choice h2 { margin:0 42px 20px 0; color:#f0f1f2; font:20px/1.25 Minecraft,ui-sans-serif,system-ui,sans-serif; text-shadow:2px 2px #342c34; }
  .choice-close { position:absolute; right:10px; top:10px; width:44px; height:44px; display:grid; place-items:center; padding:0; border:0; background:none; color:#aeb3b8; cursor:pointer; }
  .choice-close svg { width:21px; height:21px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
  .choice-option { display:grid; grid-template-columns:56px minmax(0,1fr) auto; align-items:center; gap:12px; padding:13px; border:1px solid #464a4f; border-radius:9px; background:#292c30; }
  .choice-option+.choice-option { margin-top:10px; }
  .choice-option>div { min-width:0; }
  .choice-option b,.choice-option small { display:block; }
  .choice-option b { overflow:hidden; color:#e5e7e9; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }
  .choice-option small { margin-top:5px; color:#989da2; font-size:11px; }
  .choice-actions { display:flex; gap:7px; }
  .choice-actions button { min-width:82px; min-height:44px; padding:0 11px; border:1px solid #5a5f65; border-radius:7px; background:#35393d; color:#e3e5e7; font-weight:700; cursor:pointer; }
  .choice-actions button:first-child { background:#d1d4d7; color:#17191b; border-color:#d1d4d7; }
  @media (max-width:600px) {
    .ore-choice-scrim { align-items:center; padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom)); }
    .ore-choice { width:min(520px,100%); max-height:calc(100dvh - 32px); overflow:auto; padding:24px 16px; border-width:1px; border-radius:16px; }
    .choice-option { grid-template-columns:56px minmax(0,1fr); }
    .choice-actions { grid-column:1/-1; }
    .choice-actions button { flex:1; }
  }
</style>
