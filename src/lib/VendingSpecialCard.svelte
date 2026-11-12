<script lang="ts">
  import RecipeProgress from './RecipeProgress.svelte';
  import { defaultProgressWidget } from './machineUi';
  import SpecialGoods from './SpecialGoods.svelte';
  import QuestIconButton from './questbook/QuestIconButton.svelte';
  import { vendingQuestId } from './questbook/vending';
  import type { QuestLinksRepository } from './questbook/linksRepository';
  import type { RecipeView } from './types';
  import { toSpecialGoods, toSpecialGoodsList, type SpecialGoods as SpecialGoodsValue, type SpecialRecord, type SpecialResolver, type VendingSpecialPayload } from './specialData';

  let { record, resolve, navigate, questLinks, openQuest, questLinksLoading = false }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void; questLinks?:QuestLinksRepository; openQuest?:(id:string)=>void; questLinksLoading?:boolean } = $props();

  let availableWidth = $state(434);
  let layoutHeight = $state(144);
  const scale = $derived(Math.min(1, availableWidth / 434));

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

  const inputGoods = $derived([...inputs, ...nonConsumed]);

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

  const questRequirements=$derived((Array.isArray(rawPayload.requirements) ? rawPayload.requirements : payload.requirements ?? [])
    .map(vendingQuestId).filter((id):id is string=>Boolean(id)));
  const requirements = $derived(
    (Array.isArray(rawPayload.requirements) ? rawPayload.requirements : payload.requirements ?? [])
      .filter(value=>!vendingQuestId(value))
      .map(requirementLabel)
      .filter((value) => value.length > 0)
      .concat(payload.staticRequirement ? [payload.staticRequirement] : [])
  );
</script>

<div class="vending-card">
  <div class="trade-viewport" bind:clientWidth={availableWidth} style:height={`${layoutHeight * scale}px`}>
    <div class="trade-layout" bind:clientHeight={layoutHeight} style:transform={`scale(${scale})`}>
      <section class="trade-side" aria-label="Vending inputs">
        <SpecialGoods goods={inputGoods} {resolve} {navigate} hideLabels grid={{columns:4,rows:3}} pageSize={12} />
      </section>
      <div class="trade-arrow"><RecipeProgress widget={defaultProgressWidget} /></div>
      <section class="trade-side" aria-label="Vending results">
        <SpecialGoods goods={outputs} {resolve} {navigate} hideLabels grid={{columns:4,rows:3}} pageSize={12} />
      </section>
    </div>
  </div>

  {#if requirements.length || questRequirements.length}
    <section class="vending-requirements" aria-label="Vending requirements">
      <h3>Requirements</h3>
      {#if questRequirements.length}
        <div class="quest-requirement-ruler" aria-label="Required quests">
          {#each questRequirements as id (id)}
            {#if questLinks?.quests.has(id) && openQuest}
              <QuestIconButton quest={questLinks.quests.get(id)!} repository={questLinks} {openQuest} source="vending" />
            {:else}<small>{questLinksLoading ? 'Loading quest info…' : 'Quest info unavailable for this version'}</small>{/if}
          {/each}
        </div>
      {/if}
      {#if requirements.length}<ul>{#each requirements as requirement, index (`${index}:${requirement}`)}<li>{requirement}</li>{/each}</ul>{/if}
    </section>
  {/if}
</div>

<style>
  .vending-card { display:flex; flex-direction:column; gap:13px; min-width:0; }
  .trade-viewport { width:100%; }
  .trade-layout { display:grid; width:434px; grid-template-columns:192px 38px 192px; align-items:center; gap:6px; transform-origin:top left; }
  .trade-side { min-width:0; }
  .vending-requirements h3 { margin:0 0 7px; color:var(--recipe-text); font:12px/16px Minecraft,ui-sans-serif,system-ui,sans-serif; text-transform:uppercase; }
  .trade-arrow { width:38px; height:34px; }
  .vending-requirements { padding:9px; border:0; border-radius:0; background:transparent; }
  .vending-requirements ul { display:flex; flex-wrap:wrap; gap:5px 14px; margin:0; padding-left:17px; color:var(--recipe-text); font-size:11px; }
  .vending-requirements small { display:block; margin-top:7px; color:var(--recipe-text); font:9px/13px Minecraft,monospace; }
  .quest-requirement-ruler { display:flex;flex-wrap:wrap;align-items:center;gap:10px; }
</style>
