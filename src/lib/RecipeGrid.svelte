<script lang="ts">
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import SlotSurface from './SlotSurface.svelte';
  import { RECIPE_UI_SCALE, type UiSlot } from './machineUi';
  import { oreCycle } from './oreCycle';
  import { ingredientTooltipNotes, ingredientsByGridSlot } from './recipePresentation';
  import type { CatalogEntry, GridDimensions, Ingredient } from './types';

  let {
    dimensions,
    ingredients,
    navigate,
    resolve,
    label,
    showChances = false,
    positions,
    fluid = false,
    compactAmounts = false,
    showLabel = true
  }: {
    dimensions: GridDimensions;
    ingredients: Ingredient[];
    navigate: (id: string, view: 'recipes' | 'usages') => void;
    resolve: (id: string) => CatalogEntry | undefined;
    label?: string;
    showChances?: boolean;
    positions?: UiSlot[];
    fluid?: boolean;
    compactAmounts?: boolean;
    showLabel?: boolean;
  } = $props();

  const cellCount = $derived(positions?.length ?? dimensions.columns * dimensions.rows);
  const gridWidth = $derived(positions ? Math.max(0, ...positions.map(slot => slot.pos[0] + 18)) : dimensions.columns * 18);
  const gridHeight = $derived(positions ? Math.max(0, ...positions.map(slot => slot.pos[1] + 18)) : dimensions.rows * 18);
  const slots = $derived(Array.from({ length: cellCount }, (_, slot) => slot));
  const slotIngredients = $derived(ingredientsByGridSlot(ingredients, dimensions));
  let chooserOpen = $state(false);
  let chosenItemId = $state('');
  let chosenGroupId = $state('');
  let tooltipSlot = $state(-1);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  const chosenItem = $derived(chosenItemId ? resolve(chosenItemId) : undefined);
  const chosenGroup = $derived(chosenGroupId ? resolve(chosenGroupId) : undefined);
  const tooltipIngredient = $derived(tooltipSlot >= 0 ? slotIngredients.get(tooltipSlot) : undefined);
  const tooltipAlternatives = $derived(tooltipIngredient?.alternatives ?? []);
  const tooltipDisplayId = $derived(tooltipAlternatives.length > 0
    ? tooltipAlternatives[$oreCycle % tooltipAlternatives.length]
    : tooltipIngredient?.id);
  const tooltipEntry = $derived(tooltipDisplayId ? resolve(tooltipDisplayId) : undefined);
  const tooltipGroupId = $derived(tooltipIngredient?.ingredientGroupId ?? '');

  function openGroupChooser(itemId: string, groupId: string) {
    hideTooltip();
    chosenItemId = itemId;
    chosenGroupId = groupId;
    chooserOpen = true;
  }

  function choose(id: string, view: 'recipes' | 'usages') {
    chooserOpen = false;
    navigate(id, view);
  }

  function showPointerTooltip(event: PointerEvent, slot: number) {
    if (event.pointerType === 'touch') return;
    tooltipSlot = slot;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function movePointerTooltip(event: PointerEvent) {
    if (tooltipSlot < 0 || event.pointerType === 'touch') return;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function showFocusTooltip(event: FocusEvent, slot: number) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipSlot = slot;
    tooltipX = rect.right;
    tooltipY = rect.bottom;
  }

  function hideTooltip() {
    tooltipSlot = -1;
  }

  function displayAmount(value: number, fluid: boolean): string {
    const suffix = fluid ? 'L' : '';
    if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))}B${suffix}`;
    if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M${suffix}`;
    if (value >= 10_000) return `${Number((value / 1_000).toFixed(1))}k${suffix}`;
    return `${value}${suffix}`;
  }

  function compactLabel(value: number, fluid: boolean): boolean {
    const label = displayAmount(value, fluid);
    // Pixel-font digits/suffixes advance 12px at 18px; the decimal advances 4px.
    const width = [...label].reduce((sum, char) => sum + (char === '.' ? 4 : 12), 0);
    return fluid || compactAmounts || width > 18 * RECIPE_UI_SCALE - 2;
  }
</script>

{#if cellCount > 0}
  <div class="grid-wrap">
    {#if label && showLabel}<span class="grid-label">{label}</span>{/if}
    <div
      class="slot-grid"
      class:positioned={positions !== undefined}
      style:--slot-size={`${18 * RECIPE_UI_SCALE}px`}
      style:width={`${gridWidth * RECIPE_UI_SCALE}px`} style:height={`${gridHeight * RECIPE_UI_SCALE}px`}
      style:grid-template-columns={`repeat(${dimensions.columns}, var(--slot-size))`}
      aria-label={label}
    >
      <SlotSurface width={gridWidth} height={gridHeight} slots={positions} {fluid} />
      {#each slots as slot (slot)}
        {@const ingredient = slotIngredients.get(slot)}
        {@const alternatives = ingredient?.alternatives ?? []}
        {@const alternativeIndex = alternatives.length > 0 ? $oreCycle % alternatives.length : 0}
        {@const displayId = alternatives[alternativeIndex] ?? ingredient?.id}
        {@const entry = displayId ? resolve(displayId) : undefined}
        {#if ingredient && entry}
          <button
            class="ingredient"
            style:left={positions ? `${positions[slot]!.pos[0] * RECIPE_UI_SCALE}px` : undefined}
            style:top={positions ? `${positions[slot]!.pos[1] * RECIPE_UI_SCALE}px` : undefined}
            aria-label={ingredient.ingredientGroupId
              ? `${ingredient.ingredientGroupId}, showing ${entry.name}, alternative ${alternativeIndex + 1} of ${alternatives.length}`
              : entry.name}
            onpointerenter={(event) => showPointerTooltip(event, slot)}
            onpointermove={movePointerTooltip}
            onpointerleave={hideTooltip}
            onfocus={(event) => showFocusTooltip(event, slot)}
            onblur={hideTooltip}
            onclick={() => ingredient.ingredientGroupId
              ? openGroupChooser(entry.id, ingredient.ingredientGroupId)
              : navigate(ingredient.id, 'recipes')}
            oncontextmenu={(event) => {
              event.preventDefault();
              if (ingredient.ingredientGroupId) {
                openGroupChooser(entry.id, ingredient.ingredientGroupId);
              }
              else navigate(ingredient.id, 'usages');
            }}
          >
            <ItemIcon {entry} size={18 * RECIPE_UI_SCALE} frame={false} />
            {#if !showChances && ingredient.amount === 0}
              <span class="chance non-consumable" aria-label="Not consumed">NC</span>
            {/if}
            {#if ingredient.ingredientGroupId}
              <span class="ore-count">
                +{alternatives.length}
              </span>
            {/if}
            {#if ingredient.amount !== undefined && (showChances || ingredient.amount !== 0) && (ingredient.amount !== 1 || entry.kind === 'fluid')}
              <span class="amount" class:fluid-amount={entry.kind === 'fluid'} class:compact-amount={compactLabel(ingredient.amount, entry.kind === 'fluid')}>
                {displayAmount(ingredient.amount, entry.kind === 'fluid')}
              </span>
            {/if}
            {#if showChances && ingredient.chance !== undefined && ingredient.chance < 1}
              <span class="chance">{Number((ingredient.chance * 100).toFixed(2))}%</span>
            {/if}
          </button>
        {:else}
          <span class="empty-slot" aria-hidden="true"
            style:left={positions ? `${positions[slot]!.pos[0] * RECIPE_UI_SCALE}px` : undefined}
            style:top={positions ? `${positions[slot]!.pos[1] * RECIPE_UI_SCALE}px` : undefined}></span>
        {/if}
      {/each}
    </div>
  </div>
{/if}

{#if !chooserOpen && tooltipEntry}
  <FloatingCatalogTooltip
    entry={tooltipEntry}
    notes={ingredientTooltipNotes(tooltipIngredient, tooltipEntry.kind === 'fluid', showChances)}
    x={tooltipX}
    y={tooltipY}
    action={tooltipGroupId
      ? tooltipIngredient?.ingredientGroupKind === 'oreDict'
        ? 'Click to choose current item or ore dictionary entry'
        : 'Click to choose current item or interchangeable ingredient group'
      : 'Left-click: Recipes · Right-click: Usages'}
  />
{/if}

<svelte:window onkeydown={(event) => {
  if (chooserOpen && event.key === 'Escape') chooserOpen = false;
}} />

{#if chooserOpen && chosenItem && chosenGroup}
  <div class="ore-choice-scrim" role="presentation" onclick={(event) => {
    if (event.currentTarget === event.target) chooserOpen = false;
  }}>
    <div class="ore-choice" role="dialog" aria-modal="true" aria-label="Choose ingredient destination" tabindex="-1">
      <button class="choice-close" onclick={() => chooserOpen = false} aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
      </button>
      <p class="choice-eyebrow">
        {chosenGroup.kind === 'oreDict' ? 'ORE DICTIONARY ENTRY' : 'INTERCHANGEABLE INGREDIENT'}
      </p>
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
        <div><b>{chosenGroup.name}</b><small>All {chosenGroup.members?.length ?? 0} valid alternatives</small></div>
        <span class="choice-actions">
          <button onclick={() => choose(chosenGroup.id, 'recipes')}>Recipes</button>
          <button onclick={() => choose(chosenGroup.id, 'usages')}>Usages</button>
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .grid-wrap { display:flex; flex-direction:column; align-items:center; gap:4px; }
  .grid-label { color:var(--recipe-text,#aaa); font-size:10px; letter-spacing:.65px; text-transform:uppercase; }
  .slot-grid { position:relative; display:grid; grid-auto-rows:var(--slot-size); }
  .slot-grid.positioned { display:block; }
  .positioned .ingredient, .positioned .empty-slot { position:absolute; }
  .ingredient { position:relative; width:var(--slot-size); height:var(--slot-size); padding:0; border:0; background:none; cursor:pointer; }
  .ingredient:hover { filter:brightness(1.14); z-index:1; }
  .empty-slot { position:relative; width:var(--slot-size); height:var(--slot-size); }
  .amount { position:absolute; right:1px; bottom:1px; z-index:2; max-width:calc(var(--slot-size) - 2px); overflow:hidden; color:#fff; font:400 18px/18px Minecraft,monospace; letter-spacing:0; white-space:nowrap; text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000,1px 1px #000; }
  .amount.fluid-amount { left:1px; right:auto; font-size:9px; line-height:9px; text-align:left; }
  .amount.compact-amount { font-size:9px; line-height:9px; }
  .chance { position:absolute; left:1px; top:1px; z-index:3; color:#fdd835; font:400 9px/9px Minecraft,monospace; text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000; }
  .ore-count { position:absolute; right:1px; top:1px; z-index:2; max-width:18px; overflow:hidden; color:#dfe2e5; font:400 9px/9px Minecraft,monospace; white-space:nowrap; text-overflow:ellipsis; text-shadow:1px 1px #000; }
  .ore-choice-scrim { position:fixed; inset:0; z-index:60; display:grid; place-items:center; padding:18px; background:#050607cc; backdrop-filter:blur(6px); }
  .ore-choice { position:relative; width:min(560px,100%); padding:28px; border:1px solid #4b4f54; border-radius:14px; background:#202226; box-shadow:0 30px 90px #000; text-align:left; }
  .choice-eyebrow { margin:0 42px 7px 0; color:#a5aaaf; font:9px/13px Minecraft,ui-sans-serif,system-ui,sans-serif; letter-spacing:0; text-shadow:2px 2px #342c34; }
  .ore-choice h2 { margin:0 42px 20px 0; color:#f0f1f2; font:18px/24px Minecraft,ui-sans-serif,system-ui,sans-serif; text-shadow:2px 2px #342c34; }
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
