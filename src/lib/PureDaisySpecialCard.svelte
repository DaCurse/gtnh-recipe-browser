<script lang="ts">
  import ItemIcon from './ItemIcon.svelte';
  import SpecialGoods from './SpecialGoods.svelte';
  import { machineUiAsset, RECIPE_UI_SCALE } from './machineUi';
  import type { SpecialRecord, SpecialResolver } from './specialData';
  import type { RecipeView } from './types';

  let {
    record,
    resolve,
    navigate,
  }: {
    record: SpecialRecord;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  const layout = $derived(
    record.payload as {
      daisy: string;
      width: number;
      height: number;
      positions: [number, number][];
    },
  );
  const goods = $derived([...(record.inputs ?? []), ...(record.outputs ?? [])]);
  const positions = $derived(layout.positions.map((pos) => ({ pos })));
  const daisy = $derived(resolve(layout.daisy));
</script>

<div class="pure-daisy" style:--unit={`${RECIPE_UI_SCALE}px`} style:--height={layout.height}>
  <div class="daisy-canvas" style:--width={layout.width}>
    <div
      class="daisy-overlay"
      style:background-image={`url("${machineUiAsset('botania-pure-daisy-overlay.png')}")`}
    ></div>
    {#if daisy}
      <div class="daisy-icon">
        <ItemIcon entry={daisy} size={16 * RECIPE_UI_SCALE} frame={false} />
      </div>
    {/if}
    <SpecialGoods
      {goods}
      {resolve}
      {navigate}
      {positions}
      pageSize={goods.length}
      hideLabels
      showAmounts={goods.some((item) => item.amount !== 1)}
      showChance={false}
      nativeBackground
    />
  </div>
</div>

<style>
  .pure-daisy {
    position: relative;
    height: calc(var(--height) * var(--unit));
    display: flex;
    justify-content: center;
    overflow: clip;
  }
  .daisy-canvas {
    position: relative;
    width: calc(var(--width) * var(--unit));
    flex: none;
  }
  .daisy-overlay {
    position: absolute;
    left: calc(48 * var(--unit));
    top: calc(10 * var(--unit));
    width: calc(65 * var(--unit));
    height: calc(44 * var(--unit));
    background-size: calc(256 * var(--unit));
    image-rendering: pixelated;
    opacity: 0.5;
    pointer-events: none;
  }
  .daisy-icon {
    position: absolute;
    left: calc(71 * var(--unit));
    top: calc(23 * var(--unit));
    pointer-events: none;
  }
</style>
