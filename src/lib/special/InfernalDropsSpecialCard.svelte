<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import { machineUiAsset } from '../recipes/machineUi';
  import type { SpecialRecord, SpecialResolver } from './specialData';
  import type { RecipeView } from '../types';

  let {
    record,
    resolve,
    navigate,
  }: {
    record: SpecialRecord;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();
  const tiers = $derived(
    (
      record.payload as {
        tiers: Array<{ name: string; chance: number; alwaysChance: number }>;
      }
    ).tiers,
  );

  function percent(value: number, digits: number) {
    return `${(value * 100).toFixed(digits)}%`;
  }
</script>

<div class="infernal-scroll">
  <div
    class="infernal-stage"
    style:background-image={`url("${machineUiAsset('infernal-drops-header.png')}")`}
  >
    <header>
      <div>Infernal Mobs - Drop Table</div>
      <div>Format:</div>
      <div>Drop table name - x% (y%)</div>
      <div>x - Chance to get</div>
      <div>y - Chance to get when the mob</div>
      <div class="legend-continuation">always spawns infernal</div>
    </header>
    {#each tiers as tier, index (tier.name)}
      {@const drops = (record.outputs ?? []).filter((drop) => drop.groupId === tier.name)}
      <SpecialGoods
        goods={drops}
        {resolve}
        {navigate}
        label={`${tier.name} drops - ${percent(tier.chance, index === 0 ? 2 : 3)} (${percent(tier.alwaysChance, index === 2 ? 3 : 2)})`}
        joined
        showChance={false}
        showAmounts={false}
        pageSize={drops.length}
        grid={{ columns: 8, rows: Math.ceil(drops.length / 8) }}
      />
    {/each}
  </div>
</div>

<style>
  .infernal-scroll {
    max-width: 100%;
    overflow-x: auto;
  }
  .infernal-stage {
    width: 448px;
    margin: auto;
    padding: 0 16px 16px;
    background-color: #474744;
    background-size: 448px 280px;
    background-repeat: no-repeat;
    image-rendering: pixelated;
  }
  header {
    padding: 12px 0 12px;
    font:
      400 16px/22px Minecraft,
      monospace;
  }
  .legend-continuation {
    padding-left: 24px;
  }
  .infernal-stage :global(.special-goods-label) {
    font:
      400 16px/22px Minecraft,
      monospace;
    letter-spacing: 0;
    text-transform: none;
  }
</style>
