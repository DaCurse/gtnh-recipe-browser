<script lang="ts">
  import type { CatalogEntry, Recipe } from './types';
  import ItemIcon from './ItemIcon.svelte';
  import RecipeGrid from './RecipeGrid.svelte';
  let { recipe, navigate, resolve }: { recipe: Recipe; navigate: (id: string, view: 'recipes' | 'usages') => void; resolve: (id: string) => CatalogEntry | undefined } = $props();
  const crafter = $derived(recipe.crafterId ? resolve(recipe.crafterId) : undefined);

  const itemInputs = $derived(recipe.inputs.filter((ingredient) =>
    ingredient.kind !== 'fluid' && resolve(ingredient.id)?.kind !== 'fluid'));
  const fluidInputs = $derived(recipe.inputs.filter((ingredient) =>
    ingredient.kind === 'fluid' || resolve(ingredient.id)?.kind === 'fluid'));
  const itemOutputs = $derived(recipe.outputs.filter((ingredient) =>
    ingredient.kind !== 'fluid' && resolve(ingredient.id)?.kind !== 'fluid'));
  const fluidOutputs = $derived(recipe.outputs.filter((ingredient) =>
    ingredient.kind === 'fluid' || resolve(ingredient.id)?.kind === 'fluid'));
  const itemInputLabel = $derived(recipe.layout.shapeless
    ? 'Shapeless'
    : recipe.type === 'Crafting'
      ? `${recipe.layout.itemInputs.columns} × ${recipe.layout.itemInputs.rows} shaped`
      : 'Items');
</script>

<article class="card">
  <div class="card-head">
    <div>
      <span class="machine-mark">
        {#if crafter}<ItemIcon entry={crafter} size={40} crisp={false} />{:else}⚙{/if}
      </span>
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
        <RecipeGrid dimensions={recipe.layout.itemOutputs} ingredients={itemOutputs} {navigate} {resolve} label="Output" />
        <RecipeGrid dimensions={recipe.layout.fluidOutputs} ingredients={fluidOutputs} {navigate} {resolve} label="Fluid output" />
      </div>
    </div>
  </div>
  <div class="meta">
    {#if recipe.voltage}<span><b>⚡</b> {recipe.voltage}</span>{/if}
    {#if recipe.eu}<span title={recipe.euExact}>{recipe.eu}</span>{/if}
    {#if recipe.euPerTick}<span title={recipe.euPerTickExact}>{recipe.euPerTick}</span>{/if}
    {#each recipe.metadata ?? [] as line}<span>{line}</span>{/each}
    {#if recipe.note}<span class="note">{recipe.note}</span>{/if}
  </div>
</article>

<style>
  .card { background: linear-gradient(145deg,#292b2f,#202225); border:1px solid #414449; border-radius:12px; overflow:hidden; box-shadow:0 8px 24px #0003; }
  .card-head { min-height:48px; padding:0 14px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #3a3d41; color:#e2e4e6; }
  .machine-mark { display:inline-grid; place-items:center; width:42px; height:42px; margin-right:8px; color:#b4b8bc; vertical-align:middle; }
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
  @media (max-width:520px) {
    .recipe-flow { grid-template-columns:max-content 46px max-content; padding:12px 8px; }
    .arrow span { font-size:28px; }
  }
</style>
