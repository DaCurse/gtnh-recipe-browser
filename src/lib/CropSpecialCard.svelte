<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import SpecialNeiStage from './SpecialNeiStage.svelte';
  import { specialCategory, type SpecialGoods as Goods } from './specialData';
  import type { UiSlot } from './machineUi';
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
  const category = $derived(specialCategory(record.category));
  const seed = $derived(outputSeed ?? toSpecialGoodsList(record.inputs ?? []).find(item => /:genericSeed:/.test(item.goodsId))
    ?? toSpecialGoods(record.goodsIds?.find(id => /:genericSeed:/.test(id))));
  // PositionedStack coordinates describe the 16px sprite, inside an 18px slot.
  const slot = (x: number, y: number): UiSlot => ({ pos: [x - 1, y - 1] });
  function alternatives(goods: Goods[]): Goods[] {
    if (!goods.length) return [];
    return [{ ...goods[0]!, alternatives: goods.flatMap(item => item.alternatives ?? [item.goodsId]) }];
  }
  const nativeBreeding = $derived(category === 'cropBreeding' && Boolean(seed)
    && parentGroups.length === 1 && parents.length <= 4);
  const nativeCrop = $derived(category === 'crop' && Boolean(seed) && drops.length <= 9);
  const nativeGroups = $derived(nativeBreeding ? [
    { label: 'Result crop', goods: seed ? [seed] : [], positions: [slot(75, 22)] },
    { label: 'Parents', goods: parents, positions: [44, 106, 23, 127].map(x => slot(x, 22)) },
    { label: 'Soil block', goods: alternatives(soils), positions: [slot(75, 43)] },
    { label: 'Subsoil / under block', goods: alternatives(underBlocks), positions: [slot(75, 64)] }
  ] : [
    { label: 'Crop seed', goods: seed ? [seed] : [], positions: [slot(33, 20)] },
    { label: 'Crop outputs', goods: drops, positions: drops.map((_, i) => slot(104 + 18 * (i % 3), 16 + 18 * Math.floor(i / 3))), amounts: true, chances: true },
    { label: 'Soil block', goods: alternatives(soils), positions: [slot(33, 41)] },
    { label: 'Subsoil / under block', goods: alternatives(underBlocks), positions: [slot(33, 62)] }
  ]);
</script>

<div class="crop-card">
  {#if nativeBreeding || nativeCrop}
    <SpecialNeiStage background={nativeBreeding ? (parents.length > 2 ? 'breeding4' : 'breeding2') : 'cropList'}
      height={nativeBreeding ? 87 : 85} groups={nativeGroups} {resolve} {navigate} />
  {:else}
  {#if drops.length}
    <SpecialGoods goods={drops} resolve={resolve} {navigate} compact label={payload.poolLabel ?? (payload.poolId ? `Pool · ${payload.poolId}` : 'Crop outputs')} />
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
    <div class="pool-grid">
      <SpecialGoods goods={poolMembers} resolve={resolve} {navigate} label="Pool members" hideLabels pageSize={81}
        positions={Array.from({ length: Math.min(81, poolMembers.length) }, (_, i) => ({ pos: [18 * (i % 9), 18 * Math.floor(i / 9)] }))}
        showAmounts={false} showChance={false} />
    </div>
  {/if}
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
  .pool-grid { max-width:100%; overflow-x:auto; scrollbar-width:thin; }
  .crop-notes { display:flex; flex-direction:column; gap:8px; margin-top:2px; padding-top:9px; border-top:1px solid #3b3f44; }
  .special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }
  .special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:0; border-radius:0; background:transparent; color:var(--recipe-text); font:18px/24px Minecraft,monospace; }
  .special-stat-grid b,.special-line b { color:var(--recipe-text); font:9px/13px Minecraft,monospace; letter-spacing:.05em; text-transform:uppercase; }
  .special-stat-grid .warning { color:#f0d782; border-color:#675b32; }
  .special-line { margin:0; color:var(--recipe-text); font:18px/24px Minecraft,monospace; line-height:1.4; }
</style>
