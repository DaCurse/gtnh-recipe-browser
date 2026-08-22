<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import {
    toSpecialDrops,
    toSpecialGoodsList,
    type CropSpecialPayload,
    type SpecialRecord,
    type SpecialResolver
  } from './specialData';
  import type { RecipeView } from './types';

  let { record, resolve, navigate }: {
    record: SpecialRecord;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();
  const payload = $derived(record.payload as CropSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as Record<string, unknown>);
  const drops = $derived(toSpecialDrops(
    payload.drops?.length
      ? payload.drops
      : rawPayload.outputs ?? record.outputs ?? []
  ));
  const parentGroups = $derived((Array.isArray(rawPayload.parents) ? rawPayload.parents : []).flatMap((group) =>
    Array.isArray(group) ? [toSpecialGoodsList(group)] : [toSpecialGoodsList([group])]
  ).filter((group) => group.length > 0));
  const rawParentValues = $derived(Array.isArray(rawPayload.parents) ? rawPayload.parents : []);
  const parents = $derived(parentGroups.length === 1 && !Array.isArray(rawParentValues[0])
    ? parentGroups[0]
    : []);
</script>

<div class="crop-card">
  <div class="special-stat-grid">
    {#if payload.tier !== undefined}<span><b>Tier</b>{payload.tier}</span>{/if}
    {#if payload.duration !== undefined || typeof rawPayload.durationTicks === 'number'}<span><b>Growth</b>{payload.duration ?? rawPayload.durationTicks} ticks</span>{/if}
    {#if payload.multiplier !== undefined || typeof rawPayload.growthMultiplier === 'number'}<span><b>Multiplier</b>{payload.multiplier ?? rawPayload.growthMultiplier}×</span>{/if}
    {#if payload.parentCount !== undefined || parentGroups.length}<span><b>Breeding</b>{payload.parentCount ?? parentGroups.map((group) => group.length).join(' / ')}-parent</span>{/if}
    {#if payload.machineOnly}<span class="warning"><b>Availability</b>Machine-only</span>{/if}
  </div>
  {#if payload.biomes?.length}<p class="special-line"><b>Biomes</b> {payload.biomes.join(', ')}</p>{/if}
  {#if payload.soils?.length}<p class="special-line"><b>Soils</b> {payload.soils.join(', ')}</p>{/if}
  {#if payload.underBlocks?.length}<p class="special-line"><b>Under blocks</b> {payload.underBlocks.join(', ')}</p>{/if}
  {#if payload.requirements?.length}<p class="special-line"><b>Requirements</b> {payload.requirements.join(' · ')}</p>{/if}
  {#if parentGroups.length > 1}
    {#each parentGroups as group, index (`${index}:${group.length}`)}
      <SpecialGoods goods={group} resolve={resolve} {navigate} label={`${group.length}-parent breeding`} showAmounts={false} showChance={false} />
    {/each}
  {:else if parents.length}
    <SpecialGoods goods={parents} resolve={resolve} {navigate} label={`${payload.parentCount ?? parents.length}-parent breeding`} showAmounts={false} showChance={false} />
  {/if}
  <SpecialGoods goods={drops} resolve={resolve} {navigate} label={payload.poolLabel ?? (payload.poolId ? `Pool · ${payload.poolId}` : 'Crop outputs')} />
</div>

<style>
  .crop-card { display:flex; flex-direction:column; gap:11px; }
  .special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }
  .special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }
  .special-stat-grid b,.special-line b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
  .special-stat-grid .warning { color:#f0d782; border-color:#675b32; }
  .special-line { margin:0; color:#b8bdc1; font-size:12px; line-height:1.4; }
</style>
