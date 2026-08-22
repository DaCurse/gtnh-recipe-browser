<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { toSpecialGoods, toSpecialGoodsList, type SpecialGoods as SpecialGoodsValue, type SpecialRecord, type SpecialResolver, type VendingSpecialPayload } from './specialData';

  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();

  type RawValue = Record<string, unknown>;

  const payload = $derived(record.payload as VendingSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as RawValue);

  function isRecord(value: unknown): value is RawValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  /**
   * VendingMachine's NEI handler expands BigItemStack#getCombinedStacks into
   * one slot per concrete alternative. The runtime sidecar keeps that exact
   * shape as `goodsIds`; flattening it here preserves the left/right slot
   * grids and still makes ore-dictionary inputs flash as chooser entries.
   */
  function expandStacks(value: unknown, role: string, currency = false): SpecialGoodsValue[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
      if (typeof candidate === 'string') {
        const goods = toSpecialGoods(candidate);
        return goods ? [{ ...goods, role }] : [];
      }
      if (!isRecord(candidate)) return [];
      const ids = Array.isArray(candidate.goodsIds)
        ? candidate.goodsIds.filter((id): id is string => typeof id === 'string')
        : [];
      const fallback = ids.length > 0 ? ids : [candidate];
      const amount = currency
        ? numberValue(candidate.value)
        : numberValue(candidate.amount);
      const oreDictionary = stringValue(candidate.oreDictionary);
      return fallback.flatMap((id) => {
        const goods = toSpecialGoods(id);
        if (!goods) return [];
        return [{
          ...goods,
          amount,
          role,
          oreDictionaryId: oreDictionary ? `o:${oreDictionary}` : goods.oreDictionaryId
        }];
      });
    });
  }

  function fallbackStacks(value: unknown, role: string): SpecialGoodsValue[] {
    return toSpecialGoodsList(value).map((goods) => ({ ...goods, role }));
  }

  const inputs = $derived(
    rawPayload.fromCurrency !== undefined || rawPayload.fromItems !== undefined
      ? [
          ...expandStacks(rawPayload.fromCurrency, 'currency', true),
          ...expandStacks(rawPayload.fromItems, 'input')
        ]
      : [
          ...fallbackStacks(payload.currencies, 'currency'),
          ...fallbackStacks(payload.inputs ?? rawPayload.inputs, 'input')
        ]
  );
  const nonConsumed = $derived(
    rawPayload.nonConsumedItems !== undefined
      ? expandStacks(rawPayload.nonConsumedItems, 'tool')
      : fallbackStacks(payload.nonConsumedInputs ?? rawPayload.nonConsumedInputs, 'tool')
  );
  const outputs = $derived(
    rawPayload.toItems !== undefined
      ? expandStacks(rawPayload.toItems, 'output')
      : fallbackStacks(payload.outputs ?? rawPayload.outputs ?? record.outputs, 'output')
  );

  function requirementLabel(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!isRecord(value)) return String(value);
    const type = stringValue(value.type) ?? '';
    const nbt = stringValue(value.nbt) ?? '';
    const quest = nbt.match(/questIDLow:\s*(-?\d+)L/i)?.[1];
    if (quest && /(?:betterquesting|bqcondition)/i.test(`${type} ${nbt}`)) {
      return `Better Questing quest ${quest}`;
    }
    if (type) {
      const shortType = type.split('.').pop() ?? type;
      return shortType.replace(/Condition$/i, ' requirement');
    }
    return nbt || 'Static requirement';
  }

  const requirements = $derived(
    (Array.isArray(rawPayload.requirements) ? rawPayload.requirements : payload.requirements ?? [])
      .map(requirementLabel)
      .filter((value) => value.length > 0)
      .concat(payload.staticRequirement ? [payload.staticRequirement] : [])
  );
</script>

<div class="vending-card">
  <div class="trade-layout">
    <section class="trade-side" aria-label="Vending inputs">
      <h3>Inputs</h3>
      <SpecialGoods goods={inputs} resolve={resolve} {navigate} compact wrapLabels pageSize={12} label="Currencies and items" />
      {#if nonConsumed.length}
        <SpecialGoods goods={nonConsumed} resolve={resolve} {navigate} compact wrapLabels pageSize={12} label="Not consumed" />
      {/if}
    </section>
    <div class="trade-arrow" aria-hidden="true">→</div>
    <section class="trade-side" aria-label="Vending results">
      <h3>Results</h3>
      <SpecialGoods goods={outputs} resolve={resolve} {navigate} compact wrapLabels pageSize={12} label="Items" />
    </section>
  </div>

  {#if requirements.length}
    <section class="vending-requirements" aria-label="Vending requirements">
      <h3>Requirements</h3>
      <ul>{#each requirements as requirement, index (`${index}:${requirement}`)}<li>{requirement}</li>{/each}</ul>
      <small>These are static mod requirements; the browser does not claim quest completion.</small>
    </section>
  {/if}
</div>

<style>
  .vending-card { display:flex; flex-direction:column; gap:13px; min-width:0; }
  .trade-layout { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:start; gap:10px; min-width:0; }
  .trade-side { min-width:0; padding:9px; border:1px solid #45494e; border-radius:7px; background:#24272b; }
  .trade-side h3,.vending-requirements h3 { margin:0 0 7px; color:#d9dcdf; font:12px Minecraft,ui-sans-serif,system-ui,sans-serif; text-transform:uppercase; }
  .trade-arrow { align-self:center; color:#e1e4e7; font:26px/1 Minecraft,ui-sans-serif,system-ui,sans-serif; text-shadow:2px 2px #342c34; }
  .vending-requirements { padding:9px; border:1px solid #45494e; border-radius:7px; background:#24272b; }
  .vending-requirements ul { display:flex; flex-wrap:wrap; gap:5px 14px; margin:0; padding-left:17px; color:#c2c6ca; font-size:11px; }
  .vending-requirements small { display:block; margin-top:7px; color:#888e94; font-size:10px; }
  @media (max-width:560px) { .trade-layout { grid-template-columns:minmax(0,1fr); }.trade-arrow { transform:rotate(90deg); justify-self:center; }.trade-side { width:100%; } }
</style>
