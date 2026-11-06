<script lang="ts">
  import type { Recipe } from './types';
  import { recipeMetadataDescription, voltageTierDescription, voltageTierFormats } from './recipeMetadata';
  let { recipe }: { recipe: Recipe } = $props();
  const formats = $derived(voltageTierFormats(recipe.voltage ?? ''));
  const time = $derived(recipe.duration?.replace(/ s$/, ' seconds').replace(/ m$/, ' minutes'));
</script>

<div class="recipe-stats meta" aria-label="Recipe details">
  {#if recipe.eu}<div title={`Total energy${recipe.euExact ? `: ${recipe.euExact}` : ''}`}>Total: {recipe.euExact ?? recipe.eu}</div>{/if}
  {#if recipe.euPerTick}
    <div title={`Energy per tick${recipe.euPerTickExact ? `: ${recipe.euPerTickExact}` : ''}`}>
      Usage: {recipe.euPerTickExact ?? recipe.euPerTick}
      {#if recipe.voltage && !recipe.amperage}<span class="tier-brackets"> (<span class={`voltage-label ${formats.map(format => `fmt-${format}`).join(' ')}`} title={voltageTierDescription(recipe.voltage)}>{recipe.voltage}</span>)</span>{/if}
    </div>
  {/if}
  {#if recipe.amperage}
    {#if recipe.voltage}<div>Voltage: {recipe.voltageExact ?? recipe.voltage} (<span class={`voltage-label ${formats.map(format => `fmt-${format}`).join(' ')}`} title={voltageTierDescription(recipe.voltage)}>{recipe.voltage}</span>)</div>{/if}
    <div title="Current (amperage)">Amperage: {recipe.amperage}</div>
  {/if}
  {#if time}<div class="duration-line" title="Processing time">Time: {time}</div>{/if}
  {#each recipe.metadata ?? [] as line, index (`${index}:${line}`)}<div title={recipeMetadataDescription(line)}>{line}</div>{/each}
</div>

<style>
  .recipe-stats { padding:4px 14px 12px; color:var(--recipe-text); text-shadow:var(--recipe-shadow); font:400 18px/24px Minecraft,monospace; font-kerning:none; font-variant-ligatures:none; overflow-wrap:anywhere; }
  .voltage-label { text-shadow:1px 1px #0006; }
  .tier-brackets { white-space:nowrap; }
</style>
