<script lang="ts">
  import ItemIcon from './ItemIcon.svelte';
  import IconSkeleton from './IconSkeleton.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import { CatalogTooltipHover } from './catalogTooltipHover.svelte';
  import ProjectLinks from './ProjectLinks.svelte';
  import FeatureLink from './FeatureLink.svelte';
  import VariantPicker from './VariantPicker.svelte';
  import { resolveCatalogVariant } from './catalogVariants';
  import { landingShowcase } from './landingShowcase';
  import { ItemTouch, openItemActions } from './itemTouch.svelte';
  import { oreCycle } from './oreCycle';
  import type { CatalogBrowseEntry, CatalogEntry, RecipeView } from './types';
  let {
    assetBase = import.meta.env.BASE_URL,
    exactEntries,
    families,
    loading = false,
    progress = 0,
    itemsUrl,
    finderHref,
    questHref,
    finderDiscovered,
    questsDiscovered,
    openQuests,
    openItems,
    openFinder,
    navigate,
  }: {
    assetBase?: string;
    exactEntries: ReadonlyMap<string, CatalogEntry>;
    families: CatalogBrowseEntry[];
    itemsUrl: string;
    finderHref: string;
    loading?: boolean;
    progress?: number;
    questHref: string;
    finderDiscovered: boolean;
    questsDiscovered: boolean;
    openQuests: () => void;
    openItems: () => void;
    openFinder: () => void;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();
  const rows = $derived(landingShowcase(families, exactEntries));
  const loadingShowcase = $derived(loading && rows.every((row) => row.length === 0));
  const loadingPercent = $derived(Math.max(0, Math.min(100, Math.round(progress))));
  const placeholderSlots = Array.from({ length: 20 }, (_, index) => index);
  const touch = new ItemTouch();
  let variantGroup = $state<CatalogBrowseEntry>();
  let variantActions = $state(false);
  function activate(family: CatalogBrowseEntry, entry: CatalogEntry, actions = false) {
    tooltip.clear();
    if (family.variantKind !== 'single') {
      variantActions = actions;
      variantGroup = families.find((entry) => entry.id === family.id) ?? family;
    } else if (actions) openItemActions(entry, navigate);
    else navigate(entry.id, 'recipes');
  }
  function itemHref(id: string) {
    const url = new URL(itemsUrl);
    url.searchParams.delete('page');
    url.searchParams.set('item', id);
    url.searchParams.set('view', 'recipes');
    return url.href;
  }
  const tooltip = new CatalogTooltipHover();
  let tooltipFamily = $state<CatalogBrowseEntry>();
  const tooltipEntry = $derived(
    tooltip.entry && tooltipFamily
      ? touch.display(
          tooltipFamily.id,
          resolveCatalogVariant(tooltipFamily, exactEntries, $oreCycle),
        )
      : undefined,
  );
</script>

<main class="landing">
  <section class="hero" aria-labelledby="landing-title">
    <p class="eyebrow">GT: New Horizons Recipe Browser</p>
    <h1 id="landing-title">Your Pocket NEI</h1>
    <p class="intro">
      A quick, out-of-game recipe browser for GregTech: New Horizons. Browse items and machine
      recipes, find recipes by their ingredients, follow a production chain, or explore the
      questbook.
    </p>
    <div class="actions">
      <FeatureLink
        label="Open item catalogue"
        icon={`${assetBase}assets/navigation/items.png`}
        href={itemsUrl}
        primary
        onclick={openItems}
      />
      <FeatureLink
        label="Recipe Finder"
        icon={`${assetBase}assets/navigation/finder.png`}
        href={finderHref}
        undiscovered={!finderDiscovered}
        onclick={openFinder}
      />
      <FeatureLink
        label="Questbook Browser"
        icon={`${assetBase}assets/navigation/quests.png`}
        href={questHref}
        undiscovered={!questsDiscovered}
        onclick={openQuests}
      />
    </div>
    <p class="details">GTNH 2.9.0 &amp; earlier versions · Offline browsing · JSON data exports</p>
  </section>
  <div class="landing-load" class:complete={!loading} aria-hidden={!loading}>
    <div class="loading-caption">
      <span role="status">Loading item catalogue</span><span aria-hidden="true"
        >{loadingPercent > 0 ? `${loadingPercent}%` : 'Starting…'}</span
      >
    </div>
    <div
      class="landing-load-bar"
      role="progressbar"
      aria-label="Item catalogue loading"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={loadingPercent > 0 ? loadingPercent : undefined}
    >
      <span
        class:indeterminate={loadingPercent === 0}
        style:width={loadingPercent > 0 ? `${loadingPercent}%` : '28%'}
      ></span>
    </div>
    <p>You can open the catalogue while this finishes.</p>
  </div>
  <section class="showcase" aria-label="Explore GTNH items" aria-busy={loadingShowcase}>
    {#if loadingShowcase}
      <div class="showcase-loading" role="status" aria-label="Loading item catalogue">
        {#each [0, 1, 2, 3] as row (row)}
          <div class="row" class:reverse={row % 2 === 1}>
            <div class="track" aria-hidden="true">
              {#each [0, 1] as copy (copy)}
                <div class="sequence">
                  {#each placeholderSlots as slot (slot)}<IconSkeleton size={64} />{/each}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      {#each rows as row, index (index)}
        <div class="row" class:reverse={index % 2 === 1}>
          <div class="track">
            {#each [0, 1] as copy (copy)}
              <div class="sequence" aria-hidden={copy === 1 ? 'true' : undefined}>
                {#each row as entry (entry.id)}
                  {@const displayed = touch.display(
                    entry.id,
                    resolveCatalogVariant(entry, exactEntries, $oreCycle),
                  )!}
                  <a
                    href={itemHref(displayed.id)}
                    aria-label={displayed.name}
                    tabindex={copy === 1 ? -1 : 0}
                    data-family={entry.id}
                    data-item={displayed.id}
                    data-sheet={displayed.icon?.url}
                    use:touch.action={{
                      key: entry.id,
                      entry: displayed,
                      activate: (item) => activate(entry, item),
                      hold: (item) => activate(entry, item, true),
                      clearHover: () => tooltip.clear(),
                    }}
                    onpointerenter={(event) => {
                      tooltipFamily = entry;
                      tooltip.pointer(event, displayed);
                    }}
                    onpointermove={(event) => tooltip.pointer(event, displayed)}
                    onpointerleave={() => tooltip.clear()}
                    onfocus={(event) => {
                      tooltipFamily = entry;
                      tooltip.focus(event, displayed);
                    }}
                    onblur={() => tooltip.clear()}
                    onclick={(event) => {
                      event.preventDefault();
                      activate(entry, displayed);
                    }}
                  >
                    <ItemIcon entry={displayed} size={64} bare />
                  </a>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </section>
  <footer><span>GT: New Horizons Recipe Browser</span><ProjectLinks /></footer>
</main>
{#if tooltipEntry}<FloatingCatalogTooltip entry={tooltipEntry} x={tooltip.x} y={tooltip.y} />{/if}
{#if variantGroup}
  <VariantPicker
    group={variantGroup}
    members={variantGroup.variantIds
      .map((id) => exactEntries.get(id))
      .filter((entry): entry is CatalogEntry => Boolean(entry))}
    close={() => (variantGroup = undefined)}
    select={(id) => {
      variantGroup = undefined;
      const entry = exactEntries.get(id);
      if (variantActions && entry) openItemActions(entry, navigate);
      else navigate(id, 'recipes');
    }}
  />
{/if}

<style>
  .landing {
    display: flex;
    flex: 1;
    flex-direction: column;
    overflow: auto;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    background: transparent;
  }
  .hero {
    text-align: center;
    padding: clamp(32px, 5vh, 64px) 24px 20px;
    margin: auto auto 0;
    max-width: 850px;
  }
  .eyebrow {
    font-family: inherit;
    text-shadow: none;
    color: #b9a476;
    font-size: 11px;
    letter-spacing: 0.22em;
    font-weight: 650;
  }
  h1 {
    font-family: inherit;
    text-shadow: none;
    font-size: clamp(38px, 6vw, 72px);
    letter-spacing: -0.055em;
    line-height: 1.08;
    margin: 20px 0;
    font-weight: 750;
  }
  .intro {
    max-width: 630px;
    margin: auto;
    color: #a5abb3;
    font-size: clamp(15px, 2vw, 18px);
    line-height: 1.7;
  }
  .actions {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
    margin: 28px 0 20px;
  }
  .actions :global(a) {
    padding: 14px 22px;
    border: 1px solid #66604f;
    border-radius: 8px;
    text-decoration: none;
    color: #e9e6df;
    font-weight: 650;
    font-size: 14px;
    background: #242422;
  }
  .actions :global(a:hover) {
    filter: brightness(1.12);
  }
  .details {
    font-size: 12px;
    color: #8b9095;
    line-height: 1.6;
  }
  .landing-load {
    width: min(440px, calc(100% - 48px));
    margin: 10px auto 4px;
    color: #858b92;
    font-size: 11px;
    line-height: 1.5;
  }
  .landing-load.complete {
    visibility: hidden;
  }
  .loading-caption {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 6px;
  }
  .landing-load-bar {
    height: 3px;
    overflow: hidden;
    border-radius: 2px;
    background: #a5abb31c;
  }
  .landing-load-bar > span {
    display: block;
    height: 100%;
    background: #a59b79;
    transition: width 0.2s ease;
  }
  .landing-load-bar > .indeterminate {
    animation: load-drift 1.8s ease-in-out infinite;
  }
  .landing-load p {
    margin: 6px 0 0;
    text-align: center;
    color: #767d85;
  }
  @keyframes load-drift {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(360%);
    }
  }
  .showcase {
    overflow: hidden;
    flex-shrink: 0;
    padding: 14px 0 20px;
    mask-image: linear-gradient(90deg, transparent, black 8%, black 92%, transparent);
  }
  .row {
    width: 100%;
    overflow: hidden;
    padding: 4px 0;
  }
  .track {
    display: flex;
    width: max-content;
    animation: drift 75s linear infinite;
  }
  .reverse .track {
    animation-direction: reverse;
    animation-duration: 85s;
  }
  .row:hover .track,
  .row:focus-within .track,
  .row:global(.touch-inspecting) .track {
    animation-play-state: paused;
  }
  .sequence {
    min-width: 100vw;
    justify-content: space-around;
    display: flex;
    gap: 22px;
    padding-right: 22px;
    min-height: 64px;
  }
  .sequence a {
    display: block;
    border-radius: 6px;
  }
  .sequence a:hover {
    filter: brightness(1.2);
  }
  .sequence a:focus-visible {
    outline: 2px solid #d3ba83;
  }
  @keyframes drift {
    to {
      transform: translateX(-50%);
    }
  }
  footer {
    margin-top: auto;
    padding: 20px 28px;
    border-top: 1px solid #ffffff0b;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    color: #8b9095;
    font-size: 12px;
  }
  footer :global(.project-links) {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  footer :global(a) {
    color: #a4aab2;
    text-decoration: none;
  }
  footer :global(svg) {
    width: 14px;
    height: 14px;
    vertical-align: -2px;
    fill: currentColor;
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .landing-load-bar > .indeterminate {
      animation: none;
    }
    .landing-load-bar > span {
      transition: none;
    }
  }
</style>
