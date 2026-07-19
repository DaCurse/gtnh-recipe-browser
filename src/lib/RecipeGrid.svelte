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
    navigate: (id: string) => void;
    resolve: (id: string) => CatalogEntry | undefined;
    label?: string;
  } = $props();

  const cellCount = $derived(dimensions.columns * dimensions.rows);
</script>

{#if cellCount > 0}
  <div class="grid-wrap">
    {#if label}<span class="grid-label">{label}</span>{/if}
    <div
      class="slot-grid"
      style:grid-template-columns={`repeat(${dimensions.columns}, 44px)`}
      aria-label={label}
    >
      {#each Array(cellCount) as _, slot}
        {@const ingredient = ingredients.find((candidate) => (candidate.slot ?? 0) === slot)}
        {@const entry = ingredient ? resolve(ingredient.id) : undefined}
        {#if ingredient && entry}
          <button class="ingredient" title={entry.name} onclick={() => navigate(entry.id)}>
            <ItemIcon {entry} size={44} />
            {#if ingredient.amount !== undefined && (ingredient.amount !== 1 || entry.kind === 'fluid')}
              <span class="amount">{ingredient.amount}{entry.kind === 'fluid' ? 'L' : ''}</span>
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
  .slot-grid { display:grid; grid-auto-rows:44px; }
  .ingredient { position:relative; width:44px; height:44px; padding:0; border:0; background:none; cursor:pointer; }
  .ingredient:hover { filter:brightness(1.14); z-index:1; }
  .empty-slot { width:44px; height:44px; background:url('/assets/inventory-slot.webp') center/cover no-repeat; image-rendering:pixelated; opacity:.46; }
  .amount { position:absolute; right:3px; bottom:2px; z-index:2; color:white; font:12px Minecraft,monospace; text-shadow:2px 2px #111; }
  .chance { position:absolute; left:2px; top:2px; z-index:2; padding:1px 2px; border-radius:2px; background:#17181bd9; color:#eef0f2; font-size:7px; }
</style>
