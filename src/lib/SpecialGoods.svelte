<script lang="ts">
  import CatalogVariantIcon from './CatalogVariantIcon.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { boundedSpecialPage, displaySpecialAmount, type SpecialGoods, type SpecialResolver } from './specialData';
  import type { CatalogBrowseEntry, CatalogEntry, RecipeView } from './types';

  let {
    goods,
    resolve,
    navigate,
    label,
    pageSize = 12,
    showChance = true,
    showAmounts = true,
    compact = false,
    wrapLabels = false,
    horizontal = false,
    hideLabels = false
  }: {
    goods: readonly SpecialGoods[];
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
    label?: string;
    pageSize?: number;
    showChance?: boolean;
    showAmounts?: boolean;
    /** Use the denser presentation used by the CropsNH cards. */
    compact?: boolean;
    /** Keep long loot-table names and Fortune summaries readable instead of ellipsizing them. */
    wrapLabels?: boolean;
    /** Render a single goods slot and its caption on one line for stat rows. */
    horizontal?: boolean;
    /** Omit the caption under the slot when the parent supplies row text. */
    hideLabels?: boolean;
  } = $props();

  let page = $state(0);
  let tooltipId = $state('');
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let chooserOpen = $state(false);
  let chosenItemId = $state('');
  let chosenGroupId = $state('');
  const safePageSize = $derived(Math.max(1, Math.floor(pageSize)));
  const pageCount = $derived(Math.max(1, Math.ceil(goods.length / safePageSize)));
  const visible = $derived(boundedSpecialPage(goods, page, safePageSize));
  const tooltipGoods = $derived(goods.find((item) => item.goodsId === tooltipId));
  const tooltipEntry = $derived(tooltipGoods ? resolve(
    tooltipGoods.oreDictionaryId ?? tooltipGoods.alternatives?.[0] ?? tooltipGoods.goodsId
  ) : undefined);
  const chosenItem = $derived(chosenItemId ? resolve(chosenItemId) : undefined);
  const chosenGroup = $derived(chosenGroupId ? resolve(chosenGroupId) : undefined);

  $effect(() => {
    if (page >= pageCount) page = pageCount - 1;
  });

  function showPointerTooltip(event: PointerEvent, item: SpecialGoods) {
    if (event.pointerType === 'touch') return;
    tooltipId = item.goodsId;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function movePointerTooltip(event: PointerEvent) {
    if (!tooltipId || event.pointerType === 'touch') return;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function showFocusTooltip(event: FocusEvent, item: SpecialGoods) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipId = item.goodsId;
    tooltipX = rect.right;
    tooltipY = rect.bottom;
  }

  function displayId(item: SpecialGoods): string {
    return item.alternatives?.[0] ?? item.goodsId;
  }

  function iconId(item: SpecialGoods): string {
    return item.oreDictionaryId ?? displayId(item);
  }

  function oreDictionaryIcon(entry: CatalogEntry): {
    browse: CatalogBrowseEntry;
    exactEntries: ReadonlyMap<string, CatalogEntry>;
  } | undefined {
    if (entry.kind !== 'oreDict' || !entry.members || entry.members.length === 0) return undefined;
    const exactEntries = new Map<string, CatalogEntry>();
    for (const memberId of entry.members) {
      const member = resolve(memberId);
      if (member) exactEntries.set(memberId, member);
    }
    if (exactEntries.size === 0) return undefined;
    return {
      browse: {
        ...entry,
        variantIds: [...exactEntries.keys()],
        variantCount: exactEntries.size,
        variantKind: 'exact'
      },
      exactEntries
    };
  }

  function displayLabel(item: SpecialGoods, entry: CatalogEntry): string {
    // Older sidecars stored CropsNH's internal crop ID as an explicit label.
    // Prefer the resolved catalog display name for those IDs while preserving
    // meaningful labels on loot groups, dimensions, and machine roles.
    if (!item.label || item.label === item.goodsId || /^(?:[ifo]):/i.test(item.label)
      || /^cropsnh(?:[:_]|$)/i.test(item.label)) return entry.name;
    return item.label;
  }

  function inspect(item: SpecialGoods, view: RecipeView) {
    const id = displayId(item);
    // A semantic soil/subsoil entry already points at the ore-dictionary
    // catalog row. Opening a chooser with the same row twice is noisy and
    // misleading; concrete goods with an ore-dictionary alternative still
    // use the chooser.
    if (item.oreDictionaryId && resolve(item.oreDictionaryId)) {
      hideTooltip();
      if (id !== item.oreDictionaryId) {
        chosenItemId = id;
        chosenGroupId = item.oreDictionaryId;
        chooserOpen = true;
        return;
      }
    }
    if (id) navigate(id, view);
  }

  function choose(id: string, view: RecipeView) {
    chooserOpen = false;
    navigate(id, view);
  }

  function chanceLabel(item: SpecialGoods): string {
    if (item.chance === undefined) return '';
    return `${percentValue(item.chance)}%`;
  }

  function percentValue(value: number): string {
    const percent = value <= 1 ? value * 100 : value;
    const bounded = Math.min(100, Math.max(0, percent));
    return String(Number(bounded.toFixed(2)));
  }

  function fortuneLabel(item: SpecialGoods): string {
    const fortune = 'fortune' in item && Array.isArray(item.fortune)
      ? item.fortune.filter((value): value is number => typeof value === 'number').slice(0, 4)
      : [];
    return fortune.length === 4
      ? `F0–F3 ${fortune.map(percentValue).join(' · ')}%`
      : '';
  }

  function hideTooltip() {
    tooltipId = '';
  }
</script>

{#if goods.length > 0}
  <section class:compact class:wrap-labels={wrapLabels} class:horizontal class:hide-labels={hideLabels} class="special-goods" aria-label={label ?? 'Goods'}>
    {#if label}<div class="special-goods-label">{label}</div>{/if}
      <div class="special-goods-grid">
      {#each visible as item, itemIndex (`${itemIndex}:${item.goodsId}:${item.role ?? ''}:${item.amount ?? ''}`)}
        {@const entry = resolve(displayId(item))}
        {@const iconEntry = resolve(iconId(item)) ?? entry}
        {@const oreIcon = iconEntry ? oreDictionaryIcon(iconEntry) : undefined}
        {@const fortune = fortuneLabel(item)}
        {#if entry}
          <div class="special-good-cell">
            <button
              class:ore-dictionary={Boolean(item.oreDictionaryId)}
              class="special-good"
              aria-label={`${entry.name}${item.amount !== undefined ? `, ${item.amount}` : ''}`}
              onpointerenter={(event) => showPointerTooltip(event, item)}
              onpointermove={movePointerTooltip}
              onpointerleave={hideTooltip}
              onfocus={(event) => showFocusTooltip(event, item)}
              onblur={hideTooltip}
              onclick={() => inspect(item, 'recipes')}
              oncontextmenu={(event) => {
                event.preventDefault();
                inspect(item, 'usages');
              }}
            >
              <div class="special-slot">
                {#if oreIcon}
                  <CatalogVariantIcon entry={oreIcon.browse} exactEntries={oreIcon.exactEntries} size={56} />
                {:else}
                  <ItemIcon entry={entry} size={56} />
                {/if}
                {#if showAmounts && (item.amount !== undefined || item.minAmount !== undefined || item.maxAmount !== undefined)}
                  <span class="special-amount">{item.minAmount !== undefined || item.maxAmount !== undefined
                    ? `${item.minAmount ?? item.maxAmount}–${item.maxAmount ?? item.minAmount}`
                    : displaySpecialAmount(item.amount, entry.kind === 'fluid')}</span>
                {/if}
                {#if showChance && item.chance !== undefined}
                  <span class="special-chance">{chanceLabel(item)}</span>
                {/if}
                {#if item.weight !== undefined}
                  <span class="special-weight">w {item.weight}</span>
                {/if}
              </div>
            </button>
            {#if !hideLabels}<small class="special-good-label">{displayLabel(item, entry)}</small>{/if}
            {#if fortune && !hideLabels}<small class="special-fortune">{fortune}</small>{/if}
          </div>
        {:else}
          <div class:compact class="special-good unresolved" title={item.goodsId}>
            <span>?</span>
            <small>{item.label ?? item.goodsId}</small>
          </div>
        {/if}
      {/each}
    </div>
    {#if pageCount > 1}
      <nav class="special-goods-pages" aria-label={`${label ?? 'Goods'} pages`}>
        <button disabled={page === 0} onclick={() => page -= 1} aria-label="Previous goods">‹</button>
        <span>{page + 1} / {pageCount}</span>
        <button disabled={page >= pageCount - 1} onclick={() => page += 1} aria-label="Next goods">›</button>
      </nav>
    {/if}
  </section>
{/if}

{#if !chooserOpen && tooltipEntry}
  <FloatingCatalogTooltip
    entry={tooltipEntry}
    x={tooltipX}
    y={tooltipY}
    action={tooltipGoods?.oreDictionaryId
      ? 'Left-click: Recipes · Right-click: Usages · Ore dictionary'
      : 'Left-click: Recipes · Right-click: Usages'}
  />
{/if}

<svelte:window onkeydown={(event) => {
  if (chooserOpen && event.key === 'Escape') chooserOpen = false;
}} />

{#if chooserOpen && chosenItem && chosenGroup}
  <div class="special-choice-scrim" role="presentation" onclick={(event) => {
    if (event.currentTarget === event.target) chooserOpen = false;
  }}>
    <div class="special-choice" role="dialog" aria-modal="true" aria-label="Choose special-data destination">
      <button class="special-choice-close" onclick={() => chooserOpen = false} aria-label="Close">×</button>
      <p>ORE DICTIONARY ENTRY</p>
      <h2>What do you want to inspect?</h2>
      <div class="special-choice-option">
        <ItemIcon entry={chosenItem} size={52} />
        <b>{chosenItem.name}</b>
        <span><button onclick={() => choose(chosenItem.id, 'recipes')}>Recipes</button><button onclick={() => choose(chosenItem.id, 'usages')}>Usages</button></span>
      </div>
      <div class="special-choice-option">
        <ItemIcon entry={chosenGroup} size={52} />
        <b>{chosenGroup.name}</b>
        <span><button onclick={() => choose(chosenGroup.id, 'recipes')}>Recipes</button><button onclick={() => choose(chosenGroup.id, 'usages')}>Usages</button></span>
      </div>
    </div>
  </div>
{/if}

<style>
  .special-goods { min-width:0; }
  .special-goods-label { margin-bottom:6px; color:#8d9297; font-size:10px; font-weight:700; letter-spacing:.65px; text-transform:uppercase; }
  .special-goods-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(72px,1fr)); gap:7px; min-width:0; }
  .special-good-cell { width:max-content; min-width:72px; max-width:100%; display:flex; flex-direction:column; align-items:center; justify-self:center; gap:2px; text-align:center; }
  .special-good,.unresolved { position:relative; width:56px; height:56px; min-width:56px; min-height:56px; display:flex; align-items:center; justify-content:center; padding:0; border:1px solid transparent; border-radius:6px; background:transparent; color:#d9dcdf; cursor:pointer; }
  .special-slot { position:relative; width:56px; height:56px; flex:0 0 56px; }
  .special-good.ore-dictionary { border-color:#7565a2; box-shadow:0 0 0 1px #7565a255,0 0 8px #8b78ce66; animation:ore-dictionary-pulse 1.8s ease-in-out infinite; }
  .special-good:hover,.special-good:focus-visible { border-color:#5b6167; background:#303338; filter:brightness(1.08); outline:0; }
  .special-good-label,.unresolved small { width:max-content; max-width:100%; overflow:hidden; color:#a6abb0; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
  .special-good-cell .special-fortune { width:max-content; max-width:100%; overflow:hidden; color:#d8ca75; font-size:8px; text-overflow:ellipsis; white-space:nowrap; }
  .special-amount,.special-chance,.special-weight { position:absolute; z-index:2; padding:2px 3px; border-radius:3px; background:#17181be8; color:#fff; font:700 11px/1 ui-sans-serif,system-ui,sans-serif; text-shadow:1px 1px #000; }
  .special-amount { right:1px; bottom:1px; }
  .special-chance { left:1px; top:1px; color:#ffff55; font-family:Minecraft,monospace; text-shadow:2px 2px #342c34; }
  .special-weight { left:1px; bottom:1px; color:#d0d4d8; font:9px Minecraft,monospace; text-shadow:2px 2px #342c34; }
  .unresolved { flex-direction:column; justify-content:center; border-color:#4a4d51; color:#b7bbbf; cursor:default; }
  .unresolved>span { font-size:27px; }
  .special-goods-pages { display:flex; align-items:center; justify-content:center; gap:10px; margin-top:8px; }
  .special-goods-pages button { min-width:38px; min-height:38px; border:1px solid #50555a; border-radius:6px; background:#292c30; color:#d2d5d8; font-size:20px; cursor:pointer; }
  .special-goods-pages button:disabled { opacity:.4; cursor:default; }
  .special-goods-pages span { color:#92979c; font-size:11px; }
  .special-goods.compact .special-goods-label { margin-bottom:3px; }
  .special-goods.compact .special-goods-grid { gap:2px; }
  .special-goods.compact .special-good-cell { width:max-content; min-width:72px; }
  .special-goods.wrap-labels .special-goods-grid { grid-template-columns:repeat(auto-fit,minmax(96px,1fr)); }
  .special-goods.wrap-labels .special-good-cell { width:100%; max-width:none; }
  .special-goods.wrap-labels .special-good-label,
  .special-goods.wrap-labels .special-fortune,
  .special-goods.wrap-labels .unresolved small {
    width:100%;
    max-width:none;
    overflow:visible;
    text-overflow:clip;
    white-space:normal;
    overflow-wrap:anywhere;
    line-height:1.2;
  }
  .special-goods.horizontal .special-goods-grid { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-start; gap:0; }
  .special-goods.horizontal .special-good-cell { width:auto; min-width:56px; max-width:none; flex-direction:row; justify-self:initial; }
  .special-goods.horizontal .special-good { flex:0 0 56px; }
  .special-goods.horizontal .special-good-label { display:none; }
  .special-goods.horizontal .special-fortune { display:none; }
  .special-goods.horizontal.hide-labels .special-good-cell { min-width:56px; }
  .special-choice-scrim { position:fixed; inset:0; z-index:60; display:grid; place-items:center; padding:18px; background:#050607cc; backdrop-filter:blur(6px); }.special-choice { position:relative; width:min(560px,100%); padding:26px; border:1px solid #4b4f54; border-radius:14px; background:#202226; box-shadow:0 30px 90px #000; }.special-choice>p { margin:0 40px 7px 0; color:#a5aaaf; font:12px Minecraft,monospace; letter-spacing:.08em; }.special-choice h2 { margin:0 40px 18px 0; color:#f0f1f2; font:20px Minecraft,monospace; }.special-choice-close { position:absolute; top:8px; right:8px; width:40px; height:40px; border:0; background:none; color:#b3b8bd; font-size:25px; cursor:pointer; }.special-choice-option { display:grid; grid-template-columns:52px minmax(0,1fr) auto; align-items:center; gap:10px; padding:10px; border:1px solid #464a4f; border-radius:8px; background:#292c30; }.special-choice-option+.special-choice-option { margin-top:9px; }.special-choice-option b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.special-choice-option span { display:flex; gap:6px; }.special-choice-option button { min-height:40px; padding:0 9px; border:1px solid #5a5f65; border-radius:6px; background:#35393d; color:#e3e5e7; cursor:pointer; }.special-choice-option button:first-child { background:#d1d4d7; color:#17191b; }
  @keyframes ore-dictionary-pulse { 0%,100% { box-shadow:0 0 0 1px #7565a255,0 0 5px #8b78ce44; } 50% { box-shadow:0 0 0 1px #b49bf4aa,0 0 13px #a58ce999; } }
  @media (prefers-reduced-motion: reduce) { .special-good.ore-dictionary { animation:none; } }
  @media (max-width:600px) { .special-choice { padding:22px 14px; }.special-choice-option { grid-template-columns:52px minmax(0,1fr); }.special-choice-option span { grid-column:1/-1; }.special-choice-option button { flex:1; } }
</style>
