<script lang="ts">
  import UiTexture from './UiTexture.svelte';
  import { machineUiAsset } from './machineUi';
  import type { UiSlot } from './machineUi';
  let { width, height, slots, fluid = false }: { width: number; height: number; slots?: UiSlot[]; fluid?: boolean } = $props();
  const id = $props.id();
  const image = $derived(machineUiAsset(`slot-${fluid ? 'fluid' : 'item'}.png`));
</script>
<svg class="slot-surface" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
  {#if slots}
    {#each slots as slot, index (index)}
      <image href={image} x={slot.pos[0]} y={slot.pos[1]} width="18" height="18" />
      {#if slot.overlay}<UiTexture texture={slot.overlay} x={slot.pos[0]} y={slot.pos[1]} width={18} height={18} />{/if}
    {/each}
  {:else}
    <defs><pattern id={id} width="18" height="18" patternUnits="userSpaceOnUse"><image href={image} width="18" height="18" /></pattern></defs>
    <rect width={width} height={height} fill={`url(#${id})`} />
  {/if}
</svg>
<style>
  .slot-surface { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; image-rendering:pixelated; }
</style>
