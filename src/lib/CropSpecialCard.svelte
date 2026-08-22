<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import {
    toSpecialDrops,
    toSpecialGoodsList,
    toSpecialGoods,
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
  function displayValues(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((candidate) => {
      if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') {
        const text = String(candidate);
        return resolve(text)?.name ?? text;
      }
      const goods = toSpecialGoods(candidate);
      if (goods) return resolve(goods.goodsId)?.name ?? goods.label ?? goods.goodsId;
      if (typeof candidate === 'object' && candidate !== null) {
        const object = candidate as Record<string, unknown>;
        return String(object.name ?? object.label ?? object.id ?? object.goodsId ?? 'Unknown');
      }
      return '';
    }).filter(Boolean);
  }
  const drops = $derived(toSpecialDrops(
    payload.drops?.length
      ? payload.drops
      : rawPayload.outputs ?? record.outputs ?? []
  ));
  const poolMembers = $derived(toSpecialGoodsList(
    Array.isArray(rawPayload.memberSeeds) ? rawPayload.memberSeeds : []
  ));
  const outputSeed = $derived(toSpecialGoods(rawPayload.outputSeed));
  const rawParentValues = $derived(Array.isArray(rawPayload.parents) ? rawPayload.parents : []);
  const parentGroups = $derived((rawParentValues.some(Array.isArray)
    ? rawParentValues.flatMap((group) => Array.isArray(group) ? [toSpecialGoodsList(group)] : [])
    : [toSpecialGoodsList(rawParentValues)]
  ).filter((group) => group.length > 0));
  const parents = $derived(parentGroups.length === 1 ? parentGroups[0] : []);
  const biomes = $derived(displayValues(rawPayload.biomes ?? rawPayload.likedBiomeTags));
  const soils = $derived(toSpecialGoodsList(rawPayload.soils));
  const underBlocks = $derived(toSpecialGoodsList(rawPayload.underBlocks ?? rawPayload.blocksUnder));
  const machineCatalysts = $derived(toSpecialGoodsList(rawPayload.machineCatalysts));
  const requirements = $derived(displayValues(rawPayload.requirements));
</script>

<div class="crop-card">
  {#if drops.length}
    <SpecialGoods goods={drops} resolve={resolve} {navigate} label={payload.poolLabel ?? (payload.poolId ? `Pool · ${payload.poolId}` : 'Crop outputs')} />
  {/if}
  {#if outputSeed}
    <SpecialGoods goods={[outputSeed]} resolve={resolve} {navigate} label="Result crop" showAmounts={false} showChance={false} />
  {/if}
  {#if soils.length}
    <SpecialGoods goods={soils} resolve={resolve} {navigate} label="Soil block" showAmounts={false} showChance={false} />
  {/if}
  {#if underBlocks.length}
    <SpecialGoods goods={underBlocks} resolve={resolve} {navigate} label="Subsoil / under block" showAmounts={false} showChance={false} />
  {/if}
  {#if parentGroups.length > 1}
    {#each parentGroups as group, index (`${index}:${group.length}`)}
      <SpecialGoods goods={group} resolve={resolve} {navigate} label={`${group.length}-parent breeding`} showAmounts={false} showChance={false} />
    {/each}
  {:else if parents.length}
    <SpecialGoods goods={parents} resolve={resolve} {navigate} label={`${payload.parentCount ?? parents.length}-parent breeding`} showAmounts={false} showChance={false} />
  {/if}
  {#if poolMembers.length}
    <SpecialGoods goods={poolMembers} resolve={resolve} {navigate} label="Pool members" showAmounts={false} showChance={false} />
  {/if}
  {#if machineCatalysts.length}
    <SpecialGoods goods={machineCatalysts} resolve={resolve} {navigate} label="Machine catalysts" showAmounts={false} showChance={false} />
  {/if}
  <div class="crop-notes">
    <div class="special-stat-grid">
      {#if payload.tier !== undefined}<span><b>Tier</b>{payload.tier}</span>{/if}
      {#if payload.duration !== undefined || typeof rawPayload.durationTicks === 'number'}<span><b>Growth</b>{payload.duration ?? rawPayload.durationTicks} ticks</span>{/if}
      {#if payload.multiplier !== undefined || typeof rawPayload.growthMultiplier === 'number'}<span><b>Multiplier</b>{payload.multiplier ?? rawPayload.growthMultiplier}×</span>{/if}
      {#if payload.parentCount !== undefined || parentGroups.length}<span><b>Breeding</b>{payload.parentCount ?? parentGroups.map((group) => group.length).join(' / ')}-parent</span>{/if}
      {#if payload.dropChance !== undefined}<span><b>Harvest chance</b>{Number((payload.dropChance * 100).toFixed(2))}%</span>{/if}
      {#if payload.machineOnly}<span class="warning"><b>Availability</b>Machine-only</span>{/if}
    </div>
    {#if biomes.length}<p class="special-line"><b>Biomes</b> {biomes.join(', ')}</p>{/if}
    {#if requirements.length}<p class="special-line"><b>Requirements</b> {requirements.join(' · ')}</p>{/if}
  </div>
</div>

<style>
  .crop-card { display:flex; flex-direction:column; gap:11px; }
  .crop-notes { display:flex; flex-direction:column; gap:8px; margin-top:2px; padding-top:9px; border-top:1px solid #3b3f44; }
  .special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }
  .special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }
  .special-stat-grid b,.special-line b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
  .special-stat-grid .warning { color:#f0d782; border-color:#675b32; }
  .special-line { margin:0; color:#b8bdc1; font-size:12px; line-height:1.4; }
</style>
