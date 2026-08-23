<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { toSpecialDrops, toSpecialGoods, toSpecialGoodsList, type MeteorSpecialPayload, type SpecialRecord, type SpecialResolver } from './specialData';
  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();
  const payload = $derived(record.payload as MeteorSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as Record<string, unknown>);
  const focus = $derived(toSpecialGoods(payload.focus ?? (rawPayload.focusGoodsId as string | undefined)));
  const reagents = $derived(toSpecialGoodsList(payload.reagents ?? rawPayload.reagents ?? []).map((reagent) => ({ ...reagent, role: 'reagent' })));
  const rawOutputs = $derived(toSpecialDrops(payload.outputs ?? rawPayload.outputs ?? record.outputs ?? []));
  const estimated = $derived(payload.estimatedAmounts
    ?? Object.fromEntries(rawOutputs
      .filter((output): output is typeof output & { estimatedAmount: number } => output.estimatedAmount !== undefined)
      .map((output) => [output.goodsId, output.estimatedAmount])));
  const outputs = $derived(rawOutputs.map((output) => {
    const amount = output.estimatedAmount ?? estimated[output.goodsId];
    if (amount === undefined) return output;
    const note = `Estimated amount: ${amount.toLocaleString()}`;
    return {
      ...output,
      estimatedAmount: amount,
      tooltipNotes: output.tooltipNotes?.includes(note)
        ? output.tooltipNotes
        : [...(output.tooltipNotes ?? []), note]
    };
  }));
  const requirements = $derived((Array.isArray(rawPayload.requirements) ? rawPayload.requirements : payload.requirements ?? []).map((requirement) => typeof requirement === 'string' ? requirement : JSON.stringify(requirement)));
</script>

<div class="meteor-card">
  <SpecialGoods goods={focus ? [focus] : []} resolve={resolve} {navigate} label="Meteor focus" showAmounts={false} />
  {#if focus}<div class="meteor-flow-arrow" aria-hidden="true">↓</div>{/if}
  <SpecialGoods goods={outputs} resolve={resolve} {navigate} label="Weighted outputs" />
  {#if reagents.length}<SpecialGoods goods={reagents} resolve={resolve} {navigate} label="Required reagents" showAmounts={false} showChance={false} />{/if}
  <div class="special-stat-grid">
    {#if payload.lpCost !== undefined}<span><b>LP cost</b>{payload.lpCost.toLocaleString()}</span>{/if}
    {#if payload.radius !== undefined}<span><b>Radius</b>{payload.radius}</span>{/if}
    {#if payload.fillerRatio !== undefined}<span><b>Filler ratio</b>{Math.round(payload.fillerRatio * 100)}%</span>{/if}
    {#if payload.ritual}<span><b>Ritual</b>{payload.ritual}</span>{/if}
    {#if payload.crystal}<span><b>Crystal</b>{payload.crystal}</span>{/if}
  </div>
  {#if requirements.length}<p class="special-line"><b>Requirements</b> {requirements.join(' · ')}</p>{/if}
</div>

<style>
  .meteor-card { display:flex; flex-direction:column; gap:12px; }.meteor-flow-arrow { align-self:center; color:#d9dcdf; font:24px/1 Minecraft,ui-sans-serif,system-ui,sans-serif; text-shadow:2px 2px #342c34; }.special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }.special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }.special-stat-grid b,.special-line b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }.special-line { margin:0; color:#b8bdc1; font-size:12px; }
</style>
