<script lang="ts">
  import { RecipeChainState } from './recipeChainState.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import type { DatasetRepository } from './dataset';
  import type { RecipeConstraints } from './recipeFinder';
  import type { CatalogEntry, Ingredient, Recipe, RecipeView } from './types';
  let { repository, constraints, navigate }: {
    repository: DatasetRepository; constraints: RecipeConstraints; navigate: (id: string, view: RecipeView) => void;
  } = $props();
  const chain = new RecipeChainState({ repository: () => repository, constraints: () => constraints });
  const entries = $derived(new Map(repository.entries.map((entry) => [entry.id, entry])));
  function summarize(recipes: Recipe[]) {
    const available = new Set(constraints.inputs);
    return recipes.map((recipe) => {
      const extras: Ingredient[] = recipe.inputs.filter((input) => !available.has(input.id)
        && !input.alternatives?.some((id) => available.has(id)));
      for (const output of recipe.outputs) if ((output.chance ?? 1) > 0) {
        available.add(output.id); for (const id of output.alternatives ?? []) available.add(id);
      }
      return { recipe, extras };
    });
  }
  const label = (id: string) => entries.get(id)?.name ?? id;
  const entry = (id: string): CatalogEntry | undefined => entries.get(id);
</script>

<section class="chain-view" aria-label="Recipe chain results">
  <div class="chain-options">
    <label><input type="checkbox" bind:checked={chain.allowExtras} /> Allow additional ingredients</label>
    <label>Search depth <select aria-label="Maximum chain depth" bind:value={chain.maxDepth}>{#each [6, 12, 24, 32] as depth (depth)}<option value={depth}>{depth} steps</option>{/each}</select></label>
  </div>
  <details class="chain-help"><summary>Real recipes only · quantities and machine tiers are not balanced</summary><p class="chain-explanation">Item and fluid forms are connected through actual recipes, including melting, solidifying, and dust processing. Energy is not balanced and chance outputs remain probabilistic. {chain.allowExtras ? 'Additional ingredients and tools are shown at each step.' : 'Every ingredient kind and tool must come from supplied inputs or earlier steps.'} Each target has an independent route; not every supplied input must be used.</p></details>
  {#if chain.loading}<div class="chain-status" role="status"><span class="mini-spinner" aria-hidden="true"></span>{chain.stage}{#if chain.visited}<small>{chain.visited.toLocaleString()} item/form nodes explored</small>{/if}</div>{/if}
  {#if chain.error}<div class="chain-error" role="alert"><p>{chain.error}</p><button onclick={() => chain.retry()}>Try again</button></div>{/if}
  {#each chain.paths as path (path.targetId)}
    <section class="chain-route" aria-label={`Route to ${label(path.targetId)}`}>
      <h2>{#if entry(path.targetId)}<ItemIcon entry={entry(path.targetId)!} size={36} />{/if}<span>{label(path.targetId)}<small>{path.status === 'found' ? `${path.recipes.length} recipe steps` : 'No route displayed'}</small></span></h2>
      {#if path.status === 'not-found'}<p class="chain-empty">No route found within {chain.maxDepth} steps{chain.allowExtras ? '' : ' using only supplied ingredients'}. Try a greater depth, another starting form, or allow additional ingredients.</p>
      {:else if path.status === 'proof-limit'}<p class="chain-empty">The dependency route is too large to display (more than 128 recipes). Try allowing additional ingredients or supplying an intermediate.</p>
      {:else if !path.recipes.length}<p class="chain-empty">This output is already among the supplied inputs.</p>
      {:else}
        <ol class="chain-steps">
          {#each summarize(path.recipes) as step, index (index)}
            <li><div class="chain-step-heading"><b>Step {index + 1}</b><span>{step.recipe.type}</span></div>
              {#if step.extras.length}<div class="chain-extras"><b>Also needs</b>{#each step.extras as extra, index (`${extra.id}:${index}`)}<button onclick={() => navigate(extra.id, 'recipes')}>{label(extra.id)}{extra.amount === 0 ? ' (tool / catalyst)' : ''}</button>{/each}</div>{/if}
              <RecipeCard recipe={step.recipe} {navigate} resolve={(id) => entries.get(id)} />
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/each}
</section>

<style>
  .chain-options { display:flex; flex-wrap:wrap; gap:16px 24px; align-items:center; margin:18px 0 10px; }.chain-options label { display:flex; align-items:center; gap:9px; font-size:13px; }.chain-options input { width:18px; height:18px; accent-color:#abc9ed; }
  select,.chain-error button { padding:8px; border:1px solid #536172; border-radius:6px; background:#242c36; color:#e8eef6; }
  .chain-help { margin:12px 0; color:#97a7ba; font-size:12px; line-height:1.5; }.chain-help summary { cursor:pointer; }
  .chain-explanation,.chain-empty { color:#9ca9b8; font-size:13px; line-height:1.6; }.chain-status { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:20px 0; color:#c2d0e1; font-size:13px; }.chain-status small { color:#8e9eaf; }
  .chain-route { margin-top:24px; border-top:1px solid #3c4857; padding-top:18px; }.chain-route h2 { display:flex; gap:12px; align-items:center; font-size:18px; }.chain-route h2 small { display:block; color:#94a9c2; font-size:12px; font-weight:400; margin-top:6px; }
  .chain-steps { list-style:none; padding:0; margin:20px auto; max-width:760px; }.chain-steps li { position:relative; padding:0 0 28px 24px; border-left:2px solid #455b76; }.chain-steps li::before { content:''; position:absolute; left:-6px; top:7px; width:10px; height:10px; border-radius:50%; background:#b2cae8; }.chain-steps li:last-child { border-color:transparent; }
  .chain-step-heading { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:10px; font-size:13px; }.chain-step-heading span { color:#8fa8c7; }.chain-extras { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:10px; color:#d4bd89; font-size:12px; }.chain-extras b { margin-right:5px; }.chain-extras button { border:1px solid #665b42; border-radius:5px; background:#302b21; padding:5px 8px; color:#e0d0aa; cursor:pointer; }
  @media(max-width:600px) { .chain-steps li { padding-left:14px; }.chain-route h2 { font-size:16px; } }
</style>
