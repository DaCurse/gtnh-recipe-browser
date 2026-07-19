<script lang="ts">
  import ItemIcon from './ItemIcon.svelte';
  import type { CatalogEntry, GridDimensions, Ingredient } from './types';

  let {
    dimensions,
    ingredients,
    navigate,
    resolve,
    label
  }: {
    dimensions: GridDimensions;
    ingredients: Ingredient[];
    navigate: (id: string, view: 'recipes' | 'usages') => void;
    resolve: (id: string) => CatalogEntry | undefined;
    label?: string;
  } = $props();

  const cellCount = $derived(dimensions.columns * dimensions.rows);

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
        {@const ingredient = ingredients.find((candidate) => (candidate.slot ?? 0) === slot)}
        {@const entry = ingredient ? resolve(ingredient.id) : undefined}
        {#if ingredient && entry}
          <button
            class="ingredient"
            title={`${entry.name}\nLeft-click: recipes · Right-click: usages`}
            onclick={() => navigate(entry.id, 'recipes')}
            oncontextmenu={(event) => {
              event.preventDefault();
              navigate(entry.id, 'usages');
            }}
          >
            <ItemIcon {entry} size={56} />
            {#if ingredient.amount !== undefined && (ingredient.amount !== 1 || entry.kind === 'fluid')}
              <span class="amount" title={`${ingredient.amount.toLocaleString()}${entry.kind === 'fluid' ? ' L' : ''}`}>
                {displayAmount(ingredient.amount, entry.kind === 'fluid')}
              </span>
            {/if}
            {#if ingredient.chance !== undefined && ingredient.chance < 1}
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

<style>
  .grid-wrap { display:flex; flex-direction:column; align-items:center; gap:4px; }
  .grid-label { color:#8d9297; font-size:10px; letter-spacing:.65px; text-transform:uppercase; }
  .slot-grid { display:grid; grid-auto-rows:56px; }
  .ingredient { position:relative; width:56px; height:56px; padding:0; border:0; background:none; cursor:pointer; }
  .ingredient:hover { filter:brightness(1.14); z-index:1; }
  .empty-slot { width:56px; height:56px; background:url('/assets/inventory-slot.webp') center/cover no-repeat; image-rendering:pixelated; opacity:.46; }
  .amount { position:absolute; right:8px; bottom:8px; z-index:2; max-width:42px; overflow:hidden; padding:2px 3px 1px; border-radius:3px; background:#111d; color:#fff; font:750 13px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:-.04em; text-overflow:clip; white-space:nowrap; box-shadow:0 0 0 1px #ffffff18; text-shadow:1px 1px #000; }
  .chance { position:absolute; left:3px; top:3px; z-index:2; padding:2px 3px; border-radius:2px; background:#17181bd9; color:#eef0f2; font:11px Minecraft,monospace; text-shadow:2px 2px #342C34; }
</style>
