<script lang="ts">
  import CropSpecialCard from './CropSpecialCard.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import LootBagSpecialCard from './LootBagSpecialCard.svelte';
  import MeteorSpecialCard from './MeteorSpecialCard.svelte';
  import OreProcessingDiagram from './OreProcessingDiagram.svelte';
  import type { OreScene } from './oreDiagram';
  import SpecialGoods from './SpecialGoods.svelte';
  import VeinSpecialCard from './VeinSpecialCard.svelte';
  import VendingSpecialCard from './VendingSpecialCard.svelte';
  import QuestSpecialCard from './questbook/QuestSpecialCard.svelte';
  import type { QuestLinksRepository } from './questbook/linksRepository';
  import WorldgenLootSpecialCard from './WorldgenLootSpecialCard.svelte';
  import { humanizeGtOreName, humanizeSpecialName, specialCategory, toSpecialGoods, type SpecialRecord, type SpecialResolver, type SpecialViewType } from './specialData';
  import type { RecipeView } from './types';
  import { machineUiTheme } from './machineUi';

  let { record, viewType, resolve, navigate, showAll, showingGlobal = false, questLinks, openQuest, questLinksLoading = false }: {
    record: SpecialRecord;
    viewType?: SpecialViewType;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
    showAll: () => void;
    showingGlobal?: boolean;
    questLinks?: QuestLinksRepository;
    openQuest?: (id:string) => void;
    questLinksLoading?: boolean;
  } = $props();
  const category = $derived(specialCategory(record.category) ?? record.category);
  const inputGoods = $derived(record.inputs ?? []);
  const outputGoods = $derived(record.outputs ?? []);
  const title = $derived(specialTitle(record, category, resolve));
  const iconEntry = $derived(viewType?.iconId ? resolve(viewType.iconId) : undefined);
  const iconLabel = $derived(viewType?.label ?? record.category);
  const nativeScene = $derived((record.payload as { nativeScene?: OreScene }).nativeScene);
  const questPayload = $derived(record.payload as {questId?:string;view?:RecipeView});

  function specialTitle(value: SpecialRecord, valueCategory: string, resolver: SpecialResolver): string {
    if (valueCategory === 'cropPool') {
      const payload = value.payload as unknown as Record<string, unknown>;
      const poolName = typeof payload.poolName === 'string' ? payload.poolName : value.title;
      return humanizeSpecialName(poolName);
    }
    if (valueCategory === 'crop') {
      const payload = value.payload as unknown as Record<string, unknown>;
      const seedId = value.goodsIds?.find((id) => id.startsWith('i:cropsnh:genericSeed:0:'));
      const seedEntry = seedId ? resolver(seedId) : undefined;
      if (seedEntry?.name) return seedEntry.name.replace(/\s+Seeds?$/i, '');
      const cropId = typeof payload.cropId === 'string' ? payload.cropId : value.title;
      return humanizeSpecialName(cropId);
    }
    if (valueCategory === 'gtOreVein' || valueCategory === 'gtSmallOre') {
      const payload = value.payload as unknown as Record<string, unknown>;
      const material = typeof payload.material === 'string' ? payload.material : undefined;
      if (valueCategory === 'gtSmallOre' && material) {
        return `Small ${humanizeGtOreName(material)} Ore`;
      }
      const source = typeof payload.veinName === 'string' ? payload.veinName : value.title;
      const name = humanizeGtOreName(source);
      return valueCategory === 'gtSmallOre' && !/\bore$/i.test(name)
        ? `Small ${name} Ore`
        : name;
    }
    if (valueCategory === 'worldgenLoot') {
      // The first sidecar copied Forge/NEI's handler title into the record,
      // producing "Forge Loot: ..." and "Twilight Loot: ..." in the browser.
      // Keep old packs readable while new runtime exports already emit the
      // clean table name.
      return value.title.replace(/^(?:Forge|Twilight) Loot:\s*/i, '');
    }
    if (valueCategory === 'meteorRitual') {
      const payload = value.payload as unknown as Record<string, unknown>;
      const focus = toSpecialGoods(payload.focus ?? payload.focusGoodsId);
      const focusEntry = focus ? resolver(
        focus.oreDictionaryId ?? focus.alternatives?.[0] ?? focus.goodsId
      ) : undefined;
      if (focusEntry?.name) return focusEntry.name;
      return value.title.replace(/^Meteor Ritual:\s*/i, '');
    }
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

<article class="special-card nei-panel" data-record-id={record.id}
  style:--recipe-text={machineUiTheme.textColor} style:--recipe-title={machineUiTheme.titleColor} style:--recipe-shadow={machineUiTheme.textShadow}>
  <header class="special-card-head">
    <button
      class="special-mark"
      type="button"
      onclick={showAll}
      title={showingGlobal ? 'Back to this item' : `All ${iconLabel}`}
      aria-label={showingGlobal ? 'Back to this item' : `All ${iconLabel}`}
    >
      {#if iconEntry}
        <ItemIcon entry={iconEntry} size={40} frame={false} />
      {:else}
        <span class="special-fallback">{viewType?.glyph ?? '✦'}</span>
      {/if}
    </button>
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
      <VendingSpecialCard {record} {resolve} {navigate} {questLinks} {openQuest} {questLinksLoading} />
    {:else if category === 'quest' && questLinks && openQuest}
      <QuestSpecialCard questId={questPayload.questId ?? ''} repository={questLinks} {openQuest} {resolve} {navigate} source={questPayload.view === 'usages' ? 'item_usages' : 'item_recipes'} goods={questPayload.view === 'usages' ? inputGoods : outputGoods} />
    {:else if category === 'worldgenLoot'}
      <WorldgenLootSpecialCard {record} {resolve} {navigate} />
    {:else if category === 'oreProcessing'}
      {#if nativeScene}
      <OreProcessingDiagram scene={nativeScene} {resolve} {navigate} />
      {:else}
      <p class="special-empty">No native ore-processing layout is available for this dataset.</p>
      {/if}
    {:else}
      {#if inputGoods.length}<SpecialGoods goods={inputGoods} resolve={resolve} {navigate} label="Inputs" />{/if}
      <SpecialGoods goods={outputGoods} resolve={resolve} {navigate} label="Outputs" />
      {#if !inputGoods.length && !outputGoods.length}<p class="special-empty">No goods were recorded for this NEI page.</p>{/if}
    {/if}
  </div>
</article>

<style>
  .special-card { width:100%; max-width:550px; min-width:0; justify-self:start; }
  .special-card-head { min-height:48px; display:flex; align-items:center; gap:8px; padding:4px 10px; }
  .special-card-head>div { min-width:0; flex:1; }
  .special-mark { width:42px; height:42px; flex:0 0 42px; display:grid; place-items:center; padding:0; border:0; background:none; color:var(--recipe-text); cursor:pointer; }
  .special-mark:hover,.special-mark:focus-visible { filter:brightness(1.2); }
  .special-mark:focus-visible { outline:1px solid currentColor; }
  .special-fallback { font-size:27px; }
  .special-eyebrow { display:block; font:9px/13px Minecraft,monospace; }
  .special-card h2 { margin:3px 0 0; overflow-wrap:anywhere; color:var(--recipe-title); font:18px/24px Minecraft,monospace; text-shadow:var(--recipe-shadow); }
  .special-card-head p { margin:4px 0 0; font-size:11px; }
  .special-id { display:none; }
  .special-card-body { padding:10px; }
  .special-empty { margin:0; font-size:12px; }
</style>
