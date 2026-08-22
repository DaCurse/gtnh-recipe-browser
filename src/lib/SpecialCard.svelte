<script lang="ts">
  import CropSpecialCard from './CropSpecialCard.svelte';
  import LootBagSpecialCard from './LootBagSpecialCard.svelte';
  import MeteorSpecialCard from './MeteorSpecialCard.svelte';
  import OreProcessingGraph from './OreProcessingGraph.svelte';
  import SpecialGoods from './SpecialGoods.svelte';
  import VeinSpecialCard from './VeinSpecialCard.svelte';
  import VendingSpecialCard from './VendingSpecialCard.svelte';
  import WorldgenLootSpecialCard from './WorldgenLootSpecialCard.svelte';
  import { specialCategory, toSpecialGoods, type SpecialRecord, type SpecialResolver, type SpecialViewType } from './specialData';
  import type { RecipeView } from './types';

  let { record, viewType, resolve, navigate }: {
    record: SpecialRecord;
    viewType?: SpecialViewType;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();
  const category = $derived(specialCategory(record.category) ?? record.category);
  const inputGoods = $derived(record.inputs ?? []);
  const outputGoods = $derived(record.outputs ?? []);
  const title = $derived(specialTitle(record, category, resolve));

  function specialTitle(value: SpecialRecord, valueCategory: string, resolver: SpecialResolver): string {
    if (valueCategory !== 'cropBreeding') return value.title;
    const payload = value.payload as unknown as Record<string, unknown>;
    const outputSeed = toSpecialGoods(payload.outputSeed);
    const outputEntry = outputSeed ? resolver(outputSeed.goodsId) : undefined;
    if (outputEntry?.name) return outputEntry.name;
    // Keep old fixture packs readable while removing the redundant wording
    // used by the first exporter revision.
    return value.title
      .replace(/^Direct Breeding:\s*/i, '')
      .replace(/\s+Direct Breeding$/i, '');
  }
</script>

<article class="special-card">
  <header class="special-card-head">
    <div>
      <span class="special-eyebrow">{viewType?.label ?? record.category}</span>
      <h2>{title}</h2>
      {#if record.subtitle}<p>{record.subtitle}</p>{/if}
    </div>
    <span class="special-id" title={record.lookupId ?? record.id}>{record.lookupId ?? record.id}</span>
  </header>
  <div class="special-card-body">
    {#if category === 'crop' || category === 'cropPool' || category === 'cropBreeding'}
      <CropSpecialCard {record} {resolve} {navigate} />
    {:else if category === 'gtOreVein' || category === 'gtSmallOre'}
      <VeinSpecialCard {record} {resolve} {navigate} />
    {:else if category === 'meteorRitual'}
      <MeteorSpecialCard {record} {resolve} {navigate} />
    {:else if category === 'lootBag'}
      <LootBagSpecialCard {record} {resolve} {navigate} />
    {:else if category === 'vending'}
      <VendingSpecialCard {record} {resolve} {navigate} />
    {:else if category === 'worldgenLoot'}
      <WorldgenLootSpecialCard {record} {resolve} {navigate} />
    {:else if category === 'oreProcessing'}
      <OreProcessingGraph {record} {resolve} {navigate} />
    {:else}
      {#if inputGoods.length}<SpecialGoods goods={inputGoods} resolve={resolve} {navigate} label="Inputs" />{/if}
      <SpecialGoods goods={outputGoods} resolve={resolve} {navigate} label="Outputs" />
      {#if !inputGoods.length && !outputGoods.length}<p class="special-empty">No goods were recorded for this NEI page.</p>{/if}
    {/if}
  </div>
</article>

<style>
  .special-card { min-width:0; overflow:hidden; border:1px solid #41464b; border-radius:12px; background:linear-gradient(145deg,#292c30,#202225); box-shadow:0 8px 24px #0003; }.special-card-head { min-height:60px; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px 14px; border-bottom:1px solid #3a3d41; }.special-card-head>div { min-width:0; }.special-eyebrow { display:block; color:#9ca2a7; font:10px/1.3 Minecraft,ui-sans-serif,system-ui,sans-serif; letter-spacing:.08em; text-transform:uppercase; text-shadow:2px 2px #342c34; }.special-card h2 { margin:3px 0 0; overflow-wrap:anywhere; color:#e9ebed; font:17px/1.3 Minecraft,ui-sans-serif,system-ui,sans-serif; text-shadow:2px 2px #342c34; }.special-card-head p { margin:4px 0 0; color:#9da2a7; font-size:11px; }.special-id { max-width:42%; overflow:hidden; color:#7f858a; font:10px ui-monospace,monospace; text-overflow:ellipsis; white-space:nowrap; }.special-card-body { padding:13px; }.special-empty { margin:0; color:#92979c; font-size:12px; text-align:center; }
  @media (max-width:520px) { .special-card-head { padding:10px; }.special-card-body { padding:10px; }.special-id { display:none; } }
</style>
