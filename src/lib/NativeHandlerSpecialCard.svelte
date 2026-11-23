<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import SlotSurface from './SlotSurface.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import RecipeProgress from './RecipeProgress.svelte';
  import MinecraftText from './MinecraftText.svelte';
  import { defaultProgressWidget, machineUiAsset, RECIPE_UI_SCALE } from './machineUi';
  import type { SpecialRecord, SpecialResolver } from './specialData';
  import type { CatalogEntry, RecipeView } from './types';

  let {
    record,
    resolve,
    navigate,
    machineIcon,
  }: {
    record: SpecialRecord;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
    machineIcon?: CatalogEntry;
  } = $props();

  const layout = $derived(
    record.payload as {
      width: number;
      height: number;
      positions: [number, number][];
      regions?: [number, number][];
      mana?: number;
      lifePoints?: number;
      altarTier?: number;
      orbTier?: number;
      consumption?: number;
      drain?: number;
      reagentAmount?: number;
      reagentName?: string;
      reagentColour?: number;
      temperature?: number;
      coolingTicks?: number;
      consumesCast?: boolean;
      entryTitle?: string;
      entryTagline?: string;
    },
  );
  const goods = $derived([...(record.inputs ?? []), ...(record.outputs ?? [])]);
  const lexica = $derived(record.category === 'botania-lexica');
  const orbGrid = $derived(record.category === 'blood-magic-orb-shaped');
  // Placement is the destination rectangle in each pinned handler's drawBackground.
  const backdrops: Record<
    string,
    readonly [asset: string, x: number, y: number, opacity?: number]
  > = {
    'botania-mana-pool': ['botania-mana-pool', 45, 20, 0.5],
    'botania-petal-apothecary': ['botania-petals', 45, 10, 0.5],
    'botania-runic-altar': ['botania-petals', 45, 10, 0.5],
    'botania-elven-trade': ['botania-elven-trade', 30, 10, 0.7],
    'botania-brewery': ['botania-brewery', 0, 0],
    'blood-magic-alchemy': ['blood-magic-alchemy', 0, 0],
    'blood-magic-altar': ['blood-magic-altar', 0, 0],
    'blood-magic-calcinator': ['blood-magic-calcinator', 0, 0],
    'tinkers-casting-table': ['tinkers-casting-table', 30, 0],
    'tinkers-smeltery-melting': ['tinkers-smeltery-melting', 0, 0],
  };
  const manaPositions: Record<string, number> = {
    'botania-mana-pool': 80,
    'botania-runic-altar': 113,
    'botania-brewery': 67,
  };
  const backdrop = $derived(backdrops[record.category]);
  const altarCircle = $derived(backdrop?.[0] === 'botania-petals');
  const manaY = $derived(manaPositions[record.category]);
  const manaFill = $derived(
    layout.mana
      ? Math.min(
          100,
          Math.max(
            1,
            Math.floor(layout.mana / (record.category === 'botania-mana-pool' ? 100 : 1000)),
          ),
        )
      : 0,
  );
  const casting = $derived(record.category === 'tinkers-casting-table');
  const tanks = $derived(
    layout.positions.flatMap(([x, y], index) => {
      const [width, height] = layout.regions?.[index] ?? [16, 16];
      return casting || (width === 16 && height === 16) ? [] : [{ x, y, width, height }];
    }),
  );
  const positions = $derived(
    layout.positions.map(([x, y], index) => {
      const [width, height] = layout.regions?.[index] ?? [16, 16];
      if (casting && (width !== 16 || height !== 16)) {
        return {
          pos: [x, y] as [number, number],
          fluidRegion: [width, height] as [number, number],
        };
      }
      // The handlers append the finisher to the inputs. Its browser slot is
      // 18 units wide, while the decorative altar sprite is 16 units wide.
      const slotX = altarCircle && index === (record.inputs?.length ?? 0) - 1 ? x - 1 : x;
      return {
        pos: [slotX + Math.round((width - 16) / 2), y + Math.round((height - 16) / 2)] as [
          number,
          number,
        ],
      };
    }),
  );
  const orbOutput = $derived(orbGrid ? positions.at(-1)?.pos : undefined);
  const metadata = $derived([
    ['Mana', layout.mana, ''],
    ['Cost', layout.lifePoints, ' LP'],
    ['Altar Tier', layout.altarTier, ''],
    ['Orb Tier', layout.orbTier, ''],
    ['Consumption', layout.consumption, ' LP/t'],
    ['Drain', layout.drain, ' LP/t'],
    ['Temperature', layout.temperature, ' °C'],
    ['Time', layout.coolingTicks, ' ticks'],
  ] as const);
</script>

{#if lexica}
  <div class="lexica-entry">
    <SpecialGoods
      {goods}
      {resolve}
      {navigate}
      hideLabels
      nativeBackground
      showAmounts={false}
      showChance={false}
    />
    <div class="lexica-title">
      <MinecraftText text={layout.entryTitle ?? record.title} inline />
    </div>
    {#if layout.entryTagline}
      <div><MinecraftText text={layout.entryTagline} inline /></div>
    {/if}
  </div>
{:else}
  <div class="native-page">
    <div
      class="canvas"
      style:--native-scale={RECIPE_UI_SCALE}
      style:min-width={`${layout.width * RECIPE_UI_SCALE}px`}
      style:min-height={`${layout.height * RECIPE_UI_SCALE}px`}
    >
      {#if backdrop}
        <img
          class="native-art"
          src={machineUiAsset(`${backdrop[0]}-nei.png`)}
          alt=""
          style:left={`${backdrop[1] * RECIPE_UI_SCALE}px`}
          style:top={`${backdrop[2] * RECIPE_UI_SCALE}px`}
          style:opacity={backdrop[3] ?? 1}
        />
      {/if}
      {#if altarCircle && machineIcon}
        <!-- The native handlers paint the altar in the circle below the finisher. -->
        <div class="altar-icon" aria-hidden="true">
          <ItemIcon entry={machineIcon} size={16 * RECIPE_UI_SCALE} frame={false} unpadded />
        </div>
      {/if}
      {#if record.category === 'botania-elven-trade'}
        <img
          class="native-art elven-portal"
          src={machineUiAsset('botania-elven-portal-nei.png')}
          alt=""
        />
      {/if}
      {#if manaY !== undefined && layout.mana !== undefined}
        <div
          class="mana-bar"
          aria-hidden="true"
          style:left={`${32 * RECIPE_UI_SCALE}px`}
          style:top={`${manaY * RECIPE_UI_SCALE}px`}
        >
          <img src={machineUiAsset('botania-mana-bar-nei.png')} alt="" />
          <span style:width={`${manaFill * RECIPE_UI_SCALE}px`}></span>
        </div>
      {/if}
      {#if orbGrid}
        <div
          class="native-grid"
          style:left={`${25 * RECIPE_UI_SCALE}px`}
          style:top={`${6 * RECIPE_UI_SCALE}px`}
        >
          <SlotSurface width={54} height={54} />
        </div>
        <div class="orb-arrow" aria-hidden="true">
          <RecipeProgress widget={defaultProgressWidget} />
        </div>
        {#if orbOutput}
          <div
            class="orb-output"
            style:left={`${orbOutput[0] * RECIPE_UI_SCALE}px`}
            style:top={`${orbOutput[1] * RECIPE_UI_SCALE}px`}
          >
            <SlotSurface width={18} height={18} />
          </div>
        {/if}
      {/if}
      {#each tanks as { x, y, width, height }, index (index)}
        <div
          class="tank"
          style:left={`${x * RECIPE_UI_SCALE}px`}
          style:top={`${y * RECIPE_UI_SCALE}px`}
          style:width={`${width * RECIPE_UI_SCALE}px`}
          style:height={`${height * RECIPE_UI_SCALE}px`}
        ></div>
      {/each}
      <SpecialGoods
        {goods}
        {positions}
        {resolve}
        {navigate}
        pageSize={goods.length}
        nativeBackground={Boolean(backdrop) || orbGrid || tanks.length > 0}
        hideLabels
        showAmounts={goods.some((item) => item.amount !== 1)}
        showChance={false}
      />
    </div>
  </div>
  <div class="metadata">
    {#each metadata as [label, value, unit] (label)}
      {#if value !== undefined && value > 0}<span>{label}: {value.toLocaleString()}{unit}</span
        >{/if}
    {/each}
    {#if layout.consumesCast !== undefined && goods.length > 2}
      <span>{layout.consumesCast ? 'Consumes cast' : 'Reuses cast'}</span>
    {/if}
    {#if layout.reagentName && layout.reagentColour !== undefined}
      <span style:color={`#${layout.reagentColour.toString(16).padStart(6, '0')}`}>
        Reagent: {layout.reagentAmount?.toLocaleString()}
        {layout.reagentName}
      </span>
    {:else if layout.reagentAmount !== undefined}
      <span>Reagent Amount: {layout.reagentAmount.toLocaleString()}</span>
    {/if}
  </div>
{/if}

<style>
  .native-page {
    overflow-x: auto;
  }
  .canvas {
    position: relative;
    width: max-content;
    margin-inline: auto;
  }
  .native-grid,
  .orb-arrow,
  .orb-output,
  .tank,
  .native-art,
  .altar-icon,
  .mana-bar {
    position: absolute;
    pointer-events: none;
  }
  .native-art {
    scale: var(--native-scale);
    transform-origin: top left;
    image-rendering: pixelated;
  }
  .elven-portal {
    left: calc(35px * var(--native-scale));
    top: calc(29px * var(--native-scale));
    width: 48px;
    height: 48px;
  }
  .altar-icon {
    left: calc(73px * var(--native-scale));
    top: calc(55px * var(--native-scale));
  }
  .mana-bar {
    width: calc(102px * var(--native-scale));
    height: calc(5px * var(--native-scale));
    opacity: 0.75;
  }
  .mana-bar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
  .mana-bar span {
    position: absolute;
    top: calc(1px * var(--native-scale));
    left: calc(1px * var(--native-scale));
    height: calc(3px * var(--native-scale));
    background: #5877ec;
  }
  .native-grid {
    width: 144px;
    height: 144px;
  }
  .orb-arrow {
    left: calc(96px * var(--native-scale));
    top: calc(32px * var(--native-scale));
    width: 38px;
    height: 34px;
    transform: translate(-50%, -50%);
  }
  .orb-output {
    width: 48px;
    height: 48px;
  }
  .lexica-entry {
    display: grid;
    gap: 6px;
    padding-block: 10px;
    text-align: center;
    font-family: Minecraft, monospace;
  }
  .lexica-title {
    font-size: 18px;
  }
  .tank {
    background: var(--recipe-slot-bg, #251e1a);
    box-shadow: inset 0 0 0 2px #746455;
  }
  .metadata {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    font-family: Minecraft, monospace;
  }
</style>
