<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { toSpecialGoodsList, type SpecialRecord, type SpecialResolver, type VendingSpecialPayload } from './specialData';
  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();
  const payload = $derived(record.payload as VendingSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as Record<string, unknown>);
  const rawInputs = $derived(Array.isArray(rawPayload.inputs) ? rawPayload.inputs : payload.inputs ?? []);
  const inputs = $derived(toSpecialGoodsList([...(payload.currencies ?? []), ...rawInputs]));
  const consumed = $derived(new Set(inputs.filter((item) => {
    const raw = rawInputs.find((candidate) => {
      if (typeof candidate !== 'object' || candidate === null) return false;
      const value = candidate as Record<string, unknown>;
      return value.goodsId === item.goodsId || `o:${String(value.oreDictionary ?? '')}` === item.goodsId;
    });
    return (raw as Record<string, unknown> | undefined)?.consumed !== false;
  }).map((item) => item.goodsId)));
  const nonConsumed = $derived(new Set(inputs.filter((item) => !consumed.has(item.goodsId)).map((item) => item.goodsId)));
  const outputs = $derived(toSpecialGoodsList(payload.outputs ?? rawPayload.outputs ?? record.outputs ?? []));
  const requirements = $derived((Array.isArray(rawPayload.requirements) ? rawPayload.requirements : payload.requirements ?? []).map((requirement) => typeof requirement === 'string' ? requirement : JSON.stringify(requirement)));
</script>

<div class="vending-card">
  <SpecialGoods goods={payload.machine ? [payload.machine] : []} resolve={resolve} {navigate} label="Vending machine" showAmounts={false} showChance={false} />
  <SpecialGoods goods={inputs} resolve={resolve} {navigate} label="Currencies and inputs" />
  <SpecialGoods goods={outputs} resolve={resolve} {navigate} label="Outputs" />
  {#if requirements.length || payload.staticRequirement}<p class="special-line"><b>Static quest requirement</b> {requirements.concat(payload.staticRequirement ? [payload.staticRequirement] : []).join(' · ')}</p>{/if}
  {#if nonConsumed.size}<p class="special-line"><b>Not consumed</b> {[...nonConsumed].join(', ')}</p>{/if}
</div>

<style>
  .vending-card { display:flex; flex-direction:column; gap:12px; }.special-line { margin:0; color:#b8bdc1; font-size:12px; line-height:1.4; }.special-line b { color:#90959a; font-size:10px; text-transform:uppercase; }
</style>
