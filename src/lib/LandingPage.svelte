<script lang="ts">
  import ItemIcon from './ItemIcon.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ProjectLinks from './ProjectLinks.svelte';
  import type { CatalogEntry } from './types';
  let { catalog, itemsUrl, finderHref, openItems, openFinder, navigate, loadEntry }: {
    catalog: CatalogEntry[]; itemsUrl: string; finderHref: string;
    openItems: () => void; openFinder: () => void; navigate: (id: string) => void;
    loadEntry: (id: string, signal: AbortSignal) => Promise<CatalogEntry | undefined>;
  } = $props();
  const rowCount = 4;
  const itemsPerRow = 20;
  const showcaseCount = rowCount * itemsPerRow;
  const rows = $derived.by(() => {
    const sheets = new Set<string>();
    // Pick sheets first so a fresh showcase never downloads dozens of atlases.
    for (let attempt = 0; attempt < 120 && sheets.size < 6; attempt++) {
      const entry = catalog[Math.floor(Math.random() * catalog.length)];
      if (entry?.icon && entry.searchable !== false) sheets.add(entry.icon.url);
    }
    const entries: CatalogEntry[] = [];
    let seen = 0;
    for (const entry of catalog) {
      if (!entry.icon || entry.searchable === false || !sheets.has(entry.icon.url)) continue;
      seen++;
      if (entries.length < showcaseCount) entries.push(entry);
      else {
        const index = Math.floor(Math.random() * seen);
        if (index < showcaseCount) entries[index] = entry;
      }
    }
    for (let index = entries.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [entries[index], entries[other]] = [entries[other]!, entries[index]!];
    }
    return Array.from({length:rowCount},(_,index)=>entries.slice(index*itemsPerRow,(index+1)*itemsPerRow));
  });
  function itemHref(id: string) {
    const url = new URL(itemsUrl);
    url.searchParams.delete('page');
    url.searchParams.set('item', id);
    url.searchParams.set('view', 'recipes');
    return url.href;
  }
  let hovered = $state<CatalogEntry>();
  let x = $state(0), y = $state(0);
  function pointer(event: PointerEvent, entry: CatalogEntry) {
    if (event.pointerType === 'touch') return;
    if (hovered?.id !== entry.id) hovered = entry;
    x = event.clientX; y = event.clientY;
  }
</script>

<main class="landing">
  <section class="hero" aria-labelledby="landing-title">
    <p class="eyebrow">GT: New Horizons Recipe Browser</p>
    <h1 id="landing-title">Your Pocket NEI</h1>
    <p class="intro">A quick, out-of-game recipe browser for GregTech: New Horizons. Browse items and machine recipes, find recipes by their ingredients, or follow a production chain.</p>
    <div class="actions">
      <a class="mc-button primary" href={itemsUrl} onclick={(event) => { event.preventDefault(); openItems(); }}>Open item catalogue</a>
      <a class="mc-button" href={finderHref} onclick={(event) => { event.preventDefault(); openFinder(); }}>Recipe Finder</a>
    </div>
    <p class="details">GTNH 2.9.0 &amp; earlier versions · Offline browsing · JSON data exports</p>
  </section>
  <section class="showcase" aria-label="Explore GTNH items">
    {#each rows as row, index (index)}
      <div class="row" class:reverse={index % 2 === 1}>
        <div class="track">
          {#each [0, 1] as copy (copy)}
            <div class="sequence" aria-hidden={copy === 1 ? 'true' : undefined}>
              {#each row as entry (entry.id)}
                <a href={itemHref(entry.id)} aria-label={entry.name} tabindex={copy === 1 ? -1 : 0}
                  onpointerenter={(event) => pointer(event, entry)} onpointermove={(event) => pointer(event, entry)}
                  onpointerleave={() => hovered = undefined}
                  onfocus={(event) => { const rect = event.currentTarget.getBoundingClientRect(); hovered = entry; x = rect.right; y = rect.bottom; }}
                  onblur={() => hovered = undefined}
                  onclick={(event) => { event.preventDefault(); hovered = undefined; navigate(entry.id); }}>
                  <ItemIcon {entry} size={64} bare />
                </a>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </section>
  <footer><span>GT: New Horizons Recipe Browser</span><ProjectLinks /></footer>
</main>
{#if hovered}<FloatingCatalogTooltip entry={hovered} {x} {y} hydrate={loadEntry} />{/if}

<style>
  .landing { display:flex; flex:1; flex-direction:column; overflow:auto; font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif; background:radial-gradient(ellipse at 50% 30%,#ad8e3020,transparent 65%); }
  .hero { text-align:center; padding:clamp(32px,5vh,64px) 24px 20px; margin:auto auto 0; max-width:850px; }
  .eyebrow { font-family:inherit; text-shadow:none; color:#b9a476; font-size:11px; letter-spacing:.22em; font-weight:650; }
  h1 { font-family:inherit; text-shadow:none; font-size:clamp(38px,6vw,72px); letter-spacing:-.055em; line-height:1.08; margin:20px 0; font-weight:750; }
  .intro { max-width:630px; margin:auto; color:#a5abb3; font-size:clamp(15px,2vw,18px); line-height:1.7; }
  .actions { display:flex; justify-content:center; flex-wrap:wrap; gap:12px; margin:28px 0 20px; }
  .actions a { padding:14px 22px; border:1px solid #66604f; border-radius:8px; text-decoration:none; color:#e9e6df; font-weight:650; font-size:14px; background:#242422; }
  .actions .primary { background:#d3ba83; color:#201d16; border-color:#d3ba83; }
  .actions a:hover { filter:brightness(1.12); }
  .details { font-size:12px; color:#777f89; line-height:1.6; }
  .showcase { overflow:hidden; flex-shrink:0; padding:14px 0 20px; mask-image:linear-gradient(90deg,transparent,black 8%,black 92%,transparent); }
  .row { width:100%; overflow:hidden; padding:4px 0; }
  .track { display:flex; width:max-content; animation:drift 75s linear infinite; }
  .reverse .track { animation-direction:reverse; animation-duration:85s; }
  .row:hover .track,.row:focus-within .track { animation-play-state:paused; }
  .sequence { min-width:100vw; justify-content:space-around; display:flex; gap:22px; padding-right:22px; min-height:64px; }
  .sequence a { display:block; border-radius:6px; }
  .sequence a:hover { filter:brightness(1.2); }
  .sequence a:focus-visible { outline:2px solid #d3ba83; }
  @keyframes drift { to { transform:translateX(-50%); } }
  footer { margin-top:auto; padding:20px 28px; border-top:1px solid #ffffff0b; display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; color:#727a85; font-size:12px; }
  footer :global(.project-links) { display:flex; gap:20px; flex-wrap:wrap; }
  footer :global(a) { color:#a4aab2; text-decoration:none; }
  footer :global(svg) { width:14px; height:14px; vertical-align:-2px; fill:currentColor; }
  @media(prefers-reduced-motion:reduce) { .track { animation:none; } }
</style>
