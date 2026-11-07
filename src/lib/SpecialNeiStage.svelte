<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import { machineUiAsset, RECIPE_UI_SCALE, type UiSlot } from './machineUi';
  import type { SpecialGoods as Goods, SpecialResolver } from './specialData';
  import type { RecipeView } from './types';

  let { background, height, groups, resolve, navigate }: {
    background: string;
    height: number;
    groups: Array<{ label: string; goods: Goods[]; positions: UiSlot[]; amounts?: boolean; chances?: boolean }>;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();
</script>

<div class="special-nei-scroll">
  <div class="special-nei-stage" data-special-layout={background}
    style:width={`${166 * RECIPE_UI_SCALE}px`} style:height={`${height * RECIPE_UI_SCALE}px`}
    style:background-image={`url("${machineUiAsset(`crops-${background}.png`)}")`}>
    {#each groups as group (group.label)}
      <div class="native-group">
        <SpecialGoods goods={group.goods} {resolve} {navigate} positions={group.positions}
          label={group.label} hideLabels nativeBackground pageSize={Math.max(1, group.goods.length)}
          showAmounts={group.amounts ?? false} showChance={group.chances ?? false} />
      </div>
    {/each}
  </div>
</div>

<style>
  .special-nei-scroll { max-width:100%; overflow-x:auto; scrollbar-width:thin; }
  .special-nei-stage { position:relative; margin:auto; background-size:100% 100%; background-repeat:no-repeat; image-rendering:pixelated; }
  .native-group { position:absolute; inset:0; pointer-events:none; }
  .native-group :global(.special-goods-label),.native-group :global(.special-goods-pages) { display:none; }
  .native-group :global(.special-good) { pointer-events:auto; }
</style>
