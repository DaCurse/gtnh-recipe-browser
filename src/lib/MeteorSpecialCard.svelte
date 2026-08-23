<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { toSpecialDrops, toSpecialGoods, toSpecialGoodsList, type MeteorSpecialPayload, type SpecialRecord, type SpecialResolver } from './specialData';
  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();
  const payload = $derived(record.payload as MeteorSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as Record<string, unknown>);
  const focus = $derived(toSpecialGoods(payload.focus ?? (rawPayload.focusGoodsId as string | undefined)));
  const reagents = $derived(toSpecialGoodsList(payload.reagents ?? rawPayload.reagents ?? []).map((reagent) => ({ ...reagent, role: 'reagent' })));
  const outputs = $derived(toSpecialDrops(payload.outputs ?? rawPayload.outputs ?? record.outputs ?? []));
  const estimated = $derived(payload.estimatedAmounts
    ?? Object.fromEntries(outputs.filter((output) => output.estimatedAmount !== undefined).map((output) => [output.goodsId, output.estimatedAmount])));
  const requirements = $derived((Array.isArray(rawPayload.requirements) ? rawPayload.requirements : payload.requirements ?? []).map((requirement) => typeof requirement === 'string' ? requirement : JSON.stringify(requirement)));
  const effects = $derived((Array.isArray(rawPayload.reagents) ? rawPayload.reagents : []).map((reagent) => reagent as Record<string, unknown>).filter((reagent) => typeof reagent.effect === 'string'));
</script>

<div class="meteor-card">
  <div class="special-stat-grid">
    {#if payload.lpCost !== undefined}<span><b>LP cost</b>{payload.lpCost.toLocaleString()}</span>{/if}
    {#if payload.radius !== undefined}<span><b>Radius</b>{payload.radius}</span>{/if}
    {#if payload.fillerRatio !== undefined}<span><b>Filler ratio</b>{Math.round(payload.fillerRatio * 100)}%</span>{/if}
    {#if payload.ritual}<span><b>Ritual</b>{payload.ritual}</span>{/if}
    {#if payload.crystal}<span><b>Crystal</b>{payload.crystal}</span>{/if}
  </div>
  {#if requirements.length}<p class="special-line"><b>Requirements</b> {requirements.join(' · ')}</p>{/if}
  <SpecialGoods goods={focus ? [focus] : []} resolve={resolve} {navigate} label="Meteor focus" showAmounts={false} />
  <SpecialGoods goods={reagents} resolve={resolve} {navigate} label="Required reagents" showAmounts={false} showChance={false} />
  <SpecialGoods goods={outputs} resolve={resolve} {navigate} label="Weighted outputs" />
  {#if Object.keys(estimated).length}
    <div class="estimated"><b>Estimated amounts</b>{#each Object.entries(estimated) as [id, amount] (`${id}:${amount}`)}<span>{id}: {amount}</span>{/each}</div>
  {/if}
  {#if effects.length}
    <div class="reagent-effects"><b>Reagent effects</b>{#each effects as reagent, index (`${index}:${String(reagent.goodsId ?? reagent.effect)}`)}<span>{String(reagent.goodsId ?? 'Reagent')}: {String(reagent.effect)}</span>{/each}</div>
  {/if}
</div>

<style>
  .meteor-card { display:flex; flex-direction:column; gap:12px; }.special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }.special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }.special-stat-grid b,.special-line b,.estimated>b,.reagent-effects>b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }.special-line { margin:0; color:#b8bdc1; font-size:12px; }.estimated,.reagent-effects { display:flex; flex-wrap:wrap; gap:7px; color:#d0d4d8; font-size:12px; }.estimated>b,.reagent-effects>b { flex:0 0 100%; }.estimated span,.reagent-effects span { padding:5px 7px; border-radius:4px; background:#34373b; }.reagent-effects span { color:#c9e18f; }
</style>
