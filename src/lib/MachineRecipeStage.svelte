<script lang="ts">
  import RecipeGrid from './RecipeGrid.svelte';
  import SlotSurface from './SlotSurface.svelte';
  import UiTexture from './UiTexture.svelte';
  import RecipeProgress from './RecipeProgress.svelte';
  import { machineUiBounds, recipeUiIngredients, RECIPE_UI_SCALE, UI_GROUPS } from './machineUi';
  import type { MachineUiProfile, UiSlot } from './machineUi';
  import type { CatalogEntry, Recipe, RecipeView } from './types';
  let {
    recipe,
    profile,
    navigate,
    resolve,
  }: {
    recipe: Recipe;
    profile: MachineUiProfile;
    navigate: (id: string, view: RecipeView) => void;
    resolve: (id: string) => CatalogEntry | undefined;
  } = $props();
  const bounds = $derived(machineUiBounds(profile));
  const ingredients = $derived(recipeUiIngredients(recipe));
  const groups = $derived(
    UI_GROUPS.filter((group) => profile[group].length).map((group) => {
      const x = Math.min(...profile[group].map((slot) => slot.pos[0]));
      const y = Math.min(...profile[group].map((slot) => slot.pos[1]));
      const slots: UiSlot[] = profile[group].map((slot) => ({
        ...slot,
        pos: [slot.pos[0] - x, slot.pos[1] - y],
      }));
      return { group, x, y, slots };
    }),
  );
</script>

<div class="machine-stage-wrap" data-machine-map={profile.id}>
  <div
    class="machine-canvas"
    style:width={`${bounds.width * RECIPE_UI_SCALE}px`}
    style:height={`${bounds.height * RECIPE_UI_SCALE}px`}
    aria-label={`${recipe.type} recipe layout`}
  >
    {#each profile.widgets as widget, index (index)}
      <div
        class="widget"
        data-ui-kind={widget.kind}
        style:opacity={widget.opacity ?? 1}
        style:left={`${(widget.pos[0] - bounds.x) * RECIPE_UI_SCALE}px`}
        style:top={`${(widget.pos[1] - bounds.y) * RECIPE_UI_SCALE}px`}
        style:width={`${widget.size[0] * RECIPE_UI_SCALE}px`}
        style:height={`${widget.size[1] * RECIPE_UI_SCALE}px`}
      >
        {#if widget.filled}<RecipeProgress {widget} />{:else}<UiTexture
            texture={widget.texture}
          />{/if}
      </div>
    {/each}
    {#if profile.specialPos}
      <div
        class="special-slot"
        style:width={`${18 * RECIPE_UI_SCALE}px`}
        style:height={`${18 * RECIPE_UI_SCALE}px`}
        style:left={`${(profile.specialPos[0] - bounds.x) * RECIPE_UI_SCALE}px`}
        style:top={`${(profile.specialPos[1] - bounds.y) * RECIPE_UI_SCALE}px`}
      >
        <SlotSurface width={18} height={18} />
      </div>
    {/if}
    {#each groups as group (group.group)}
      <div
        class="group"
        style:left={`${(group.x - bounds.x) * RECIPE_UI_SCALE}px`}
        style:top={`${(group.y - bounds.y) * RECIPE_UI_SCALE}px`}
      >
        <RecipeGrid
          dimensions={recipe.layout[group.group]}
          ingredients={ingredients[group.group]}
          positions={group.slots}
          label={group.group.replace('item', 'Item ').replace('fluid', 'Fluid ')}
          showLabel={false}
          showSlots={profile.slotFrames !== false}
          fluid={group.group.startsWith('fluid')}
          showChances={group.group.endsWith('Outputs')}
          compactAmounts={group.group.endsWith('Outputs') && recipe.compactOutputAmounts}
          {navigate}
          {resolve}
        />
      </div>
    {/each}
  </div>
</div>

<style>
  .machine-stage-wrap {
    min-width: max-content;
    width: 100%;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .machine-canvas {
    position: relative;
    flex: none;
  }
  .group,
  .widget,
  .special-slot {
    position: absolute;
  }
  .widget {
    pointer-events: none;
  }
  .special-slot {
    opacity: 0.75;
  }
</style>
