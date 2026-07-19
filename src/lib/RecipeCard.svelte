<script lang="ts">
  import type { Recipe } from './types';
  import { byId } from './demo';
  import RecipeGrid from './RecipeGrid.svelte';
  let { recipe, navigate }: { recipe: Recipe; navigate: (id: string) => void } = $props();

  const itemInputs = $derived(recipe.inputs.filter((ingredient) =>
    ingredient.kind !== 'fluid' && byId.get(ingredient.id)?.kind !== 'fluid'));
  const fluidInputs = $derived(recipe.inputs.filter((ingredient) =>
    ingredient.kind === 'fluid' || byId.get(ingredient.id)?.kind === 'fluid'));
  const itemOutputs = $derived(recipe.outputs.filter((ingredient) =>
    ingredient.kind !== 'fluid' && byId.get(ingredient.id)?.kind !== 'fluid'));
  const fluidOutputs = $derived(recipe.outputs.filter((ingredient) =>
    ingredient.kind === 'fluid' || byId.get(ingredient.id)?.kind === 'fluid'));
  const itemInputLabel = $derived(recipe.layout.shapeless
    ? 'Shapeless'
    : recipe.type === 'Crafting'
      ? `${recipe.layout.itemInputs.columns} × ${recipe.layout.itemInputs.rows} shaped`
      : 'Items');
</script>

<article class="card">
  <div class="card-head">
    <div>
      <span class="machine-mark">⚙</span>
      <strong>{recipe.type}</strong>
    </div>
    <button class="more" aria-label="Recipe actions">•••</button>
  </div>
  <div class="recipe-stage">
    <div class="recipe-flow">
      <div class="io-side">
        <RecipeGrid dimensions={recipe.layout.itemInputs} ingredients={itemInputs} {navigate} label={itemInputLabel} />
        <RecipeGrid dimensions={recipe.layout.fluidInputs} ingredients={fluidInputs} {navigate} label="Fluids" />
      </div>
      <div class="arrow"><span>→</span><small>{recipe.duration}</small></div>
      <div class="io-side">
        <RecipeGrid dimensions={recipe.layout.itemOutputs} ingredients={itemOutputs} {navigate} label="Output" />
        <RecipeGrid dimensions={recipe.layout.fluidOutputs} ingredients={fluidOutputs} {navigate} label="Fluid output" />
      </div>
    </div>
  </div>
  <div class="meta">
    {#if recipe.voltage}<span><b>⚡</b> {recipe.voltage}</span>{/if}
    {#if recipe.eu}<span>{recipe.eu}</span>{/if}
    {#if recipe.note}<span class="note">{recipe.note}</span>{/if}
  </div>
</article>

<style>
  .card { background: linear-gradient(145deg,#292b2f,#202225); border:1px solid #414449; border-radius:12px; overflow:hidden; box-shadow:0 8px 24px #0003; }
  .card-head { min-height:48px; padding:0 14px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #3a3d41; color:#e2e4e6; }
  .machine-mark { display:inline-grid; place-items:center; width:27px; height:27px; margin-right:8px; background:#3a3d41; border-radius:5px; color:#b4b8bc; }
  .more { background:none; border:0; color:#898e93; min-width:44px; min-height:44px; cursor:pointer; }
  .recipe-stage { min-height:132px; overflow-x:auto; scrollbar-width:thin; scrollbar-color:#4b4f54 transparent; }
  .recipe-flow { min-width:max-content; min-height:132px; display:grid; grid-template-columns:max-content 66px max-content; justify-content:center; align-items:center; gap:8px; padding:14px; }
  .io-side { min-width:44px; display:flex; flex-direction:column; justify-content:center; gap:8px; }
  .arrow { color:#c5c9cd; text-align:center; }
  .arrow span { display:block; font:36px system-ui; line-height:1; }
  .arrow small { color:#969ba0; white-space:nowrap; }
  .meta { display:flex; gap:8px; align-items:center; padding:10px 14px; min-height:31px; border-top:1px solid #3a3d41; color:#b0b4b8; font-size:12px; }
  .meta span { padding:5px 8px; border-radius:5px; background:#34373b; }
  .meta span:not(.note) { font:13px/1.2 Minecraft,monospace; }
  .meta b { color:#d6d8da; }
  .meta .note { margin-left:auto; background:transparent; font-style:italic; }
  @media (max-width:520px) {
    .recipe-flow { grid-template-columns:max-content 46px max-content; padding:12px 8px; }
    .arrow span { font-size:28px; }
  }
</style>
