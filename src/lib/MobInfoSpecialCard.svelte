<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import FloatingTooltip from './FloatingTooltip.svelte';
  import { machineUiAsset } from './machineUi';
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

  // MobsInfo 0.6.2 draws the entity at the left of its 168px panel, then
  // stacks these sections in handler order, with eight slots per row.
  const groups = [
    { id: 'NORMAL', label: 'Normal Drops' },
    { id: 'RARE', label: 'Rare Drops' },
    { id: 'ADDITIONAL', label: 'Additional Drops' },
  ];
  const mob = $derived(
    record.payload as {
      portraitPng?: string;
      mod: string;
      health: number;
      peaceful?: boolean;
      infernal?: boolean;
      alwaysInfernal?: boolean;
      soulVial?: boolean;
    },
  );
  let infoHovered = $state(false);
  let infoFocused = $state(false);
  let infoAnchor = $state<DOMRect>();
  const infoId = $props.id();

  function showInfo(event: FocusEvent | PointerEvent) {
    infoAnchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.type === 'focus') infoFocused = true;
    else infoHovered = true;
  }
</script>

<div class="mob-info-scroll">
  <div
    class="mob-info-stage"
    style:background-image={`url("${machineUiAsset('mob-info-header.png')}")`}
  >
    <div class="mob-summary">
      <button
        type="button"
        class="mob-drop-info"
        aria-label="How to read drop chances"
        aria-describedby={infoHovered || infoFocused ? infoId : undefined}
        onpointerenter={showInfo}
        onpointerleave={() => (infoHovered = false)}
        onfocus={showInfo}
        onblur={() => (infoFocused = false)}
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            infoHovered = false;
            infoFocused = false;
          }
        }}
      ></button>
      <div class="mob-portrait">
        {#if mob.portraitPng}
          <img src={`data:image/png;base64,${mob.portraitPng}`} alt={record.title} />
        {/if}
      </div>
      <div class="mob-stats">
        <b>{record.title}</b>
        <span>Mod: {mob.mod}</span>
        <span>Maximum health: {mob.health}</span>
        <span
          >{mob.alwaysInfernal
            ? 'Always infernal'
            : mob.infernal
              ? 'Can spawn infernal'
              : 'Cannot spawn infernal'}</span
        >
        {#if mob.peaceful}<span>Allowed in Peaceful</span>{/if}
        {#if mob.soulVial === false}<span>Cannot be captured in a Soul Vial</span>{/if}
      </div>
    </div>
    <div class="mob-drop-groups">
      {#each groups as group (group.id)}
        {@const drops = (record.outputs ?? []).filter(
          (drop) => (drop.groupId ?? 'NORMAL') === group.id,
        )}
        {#if drops.length}
          <SpecialGoods
            goods={drops}
            label={group.label}
            {resolve}
            {navigate}
            hideLabels
            joined
            showChance={false}
            pageSize={drops.length}
            grid={{ columns: 8, rows: Math.ceil(drops.length / 8) }}
          />
        {/if}
      {/each}
    </div>
  </div>
</div>

{#if infoAnchor && (infoHovered || infoFocused)}
  <FloatingTooltip x={infoAnchor.left} y={infoAnchor.bottom}>
    <div id={infoId} role="tooltip" class="minecraft-tooltip mob-info-tip">
      <div>Drop chances and stack sizes are averages across possible outcomes.</div>
      <div>
        A listed 100% does not guarantee a drop. If 0, 1, and 2 items are equally likely, the
        average is one item per kill (100%).
      </div>
    </div>
  </FloatingTooltip>
{/if}

<style>
  .mob-info-scroll {
    max-width: 100%;
    overflow-x: auto;
  }
  .mob-info-stage {
    width: 448px;
    margin: auto;
    background-color: #474744;
    background-size: 448px 280px;
    background-repeat: no-repeat;
    image-rendering: pixelated;
  }
  .mob-summary {
    position: relative;
    display: grid;
    grid-template-columns: 124px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    min-height: 221px;
    padding: 19px 12px 15px 19px;
  }
  .mob-drop-info {
    position: absolute;
    left: calc(28px * 8 / 3);
    top: calc(62px * 8 / 3);
    width: calc(8px * 8 / 3);
    height: calc(16px * 8 / 3);
    padding: 0;
    border: 0;
    background: transparent;
    cursor: help;
  }
  .mob-drop-info:focus-visible {
    outline: 2px solid #efc62f;
  }
  .mob-info-tip {
    font-size: 14px;
    line-height: 1.5;
  }
  .mob-info-tip > div + div {
    margin-top: 6px;
  }
  .mob-portrait {
    display: grid;
    place-items: center;
    height: 138px;
  }
  .mob-portrait img {
    width: 124px;
    height: 124px;
    object-fit: contain;
    image-rendering: pixelated;
  }
  .mob-stats {
    display: grid;
    gap: 5px;
    overflow-wrap: anywhere;
    font:
      400 18px/22px Minecraft,
      monospace;
  }
  .mob-drop-groups {
    padding: 0 18px 14px;
  }
</style>
