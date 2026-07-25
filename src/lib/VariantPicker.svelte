<script lang="ts">
  import { onMount } from 'svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import MinecraftText from './MinecraftText.svelte';
  import { minecraftHtmlPlainText } from './minecraftText';
  import { normalize } from './search';
  import type { CatalogBrowseEntry, CatalogEntry } from './types';

  let { group, members, close, select }: {
    group: CatalogBrowseEntry;
    members: CatalogEntry[];
    close: () => void;
    select: (id: string) => void;
  } = $props();

  let query = $state('');
  let limit = $state(100);
  let tooltipEntry = $state<CatalogEntry>();
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let searchInput: HTMLInputElement;
  const isGtOre = $derived(group.variantKind === 'gtOre');
  const filtered = $derived.by(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return members;
    return members.filter((entry) => {
      const haystack = normalize([
        entry.name,
        entry.mod,
        entry.id,
        group.variantLabels?.[entry.id],
        minecraftHtmlPlainText(entry.rawTooltip)
      ].join(' '));
      return terms.every((term) => haystack.includes(term));
    });
  });
  const visible = $derived(filtered.slice(0, limit));

  function showTooltip(event: PointerEvent, entry: CatalogEntry) {
    if (event.pointerType === 'touch') return;
    tooltipEntry = entry;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  onMount(() => searchInput.focus());
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && close()} />

<div
  class="variant-backdrop"
  role="presentation"
  onclick={(event) => event.target === event.currentTarget && close()}
>
  <div class="variant-picker" role="dialog" aria-modal="true" aria-label={`Choose ${group.name} variant`}>
    <button class="variant-close" onclick={close} aria-label="Close variant picker">×</button>
    <small>{isGtOre ? 'GT ORE VARIANTS' : 'EXACT ITEM VARIANTS'}</small>
    <h2>{group.name}</h2>
    <p>{isGtOre
      ? `${members.length.toLocaleString()} host stones share this ore material. Choose the exact block.`
      : `${members.length.toLocaleString()} stacks share this item family. Choose the exact material or configuration.`}</p>
    <div class="variant-search">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"></circle>
        <path d="m15.5 15.5 4 4"></path>
      </svg>
      <input
        bind:this={searchInput}
        bind:value={query}
        placeholder={isGtOre
          ? 'Search host stone, tooltip, or identifier…'
          : 'Search material, tooltip, or identifier…'}
      />
      {#if query}<button onclick={() => query = ''} aria-label="Clear variant search">×</button>{/if}
    </div>
    <div class="variant-count">{filtered.length.toLocaleString()} matching variants</div>
    <div class="variant-list">
      {#each visible as entry (entry.id)}
        <button
          class="variant-row"
          onpointerenter={(event) => showTooltip(event, entry)}
          onpointermove={(event) => showTooltip(event, entry)}
          onpointerleave={() => tooltipEntry = undefined}
          onclick={() => select(entry.id)}
        >
          <ItemIcon {entry} size={52} />
          <span>
            <strong><MinecraftText raw={entry.rawName} fallback={entry.name} /></strong>
            <small>{group.variantLabels?.[entry.id]
              ? `${group.variantLabels[entry.id]} · ${entry.mod}`
              : entry.mod}</small>
            <em><MinecraftText raw={entry.rawTooltip} fallback={entry.tooltip} /></em>
          </span>
          <b>›</b>
        </button>
      {:else}
        <div class="variant-empty">No variants match this search.</div>
      {/each}
      {#if visible.length < filtered.length}
        <button class="variant-more" onclick={() => limit += 100}>
          Load next {Math.min(100, filtered.length - visible.length).toLocaleString()}
        </button>
      {/if}
    </div>
  </div>
</div>

{#if tooltipEntry}
  <FloatingCatalogTooltip
    entry={tooltipEntry}
    x={tooltipX}
    y={tooltipY}
    action="Click to browse this exact variant"
  />
{/if}

<style>
  .variant-backdrop { position:fixed; inset:0; z-index:2500; display:grid; place-items:center; padding:18px; background:#08090bce; }
  .variant-picker { position:relative; width:min(680px,100%); max-height:min(84vh,760px); display:flex; flex-direction:column; padding:26px; border:1px solid #50545a; border-radius:13px; background:#202226; box-shadow:0 30px 90px #000; }
  .variant-close { position:absolute; right:14px; top:12px; width:44px; height:44px; border:0; background:none; color:#aeb3b8; font-size:28px; cursor:pointer; }
  .variant-picker>small { color:#9ca1a6; font:12px Minecraft,system-ui,sans-serif; letter-spacing:.08em; text-shadow:2px 2px #342c34; }
  h2 { margin:7px 48px 5px 0; color:#f0f1f2; font:22px/1.25 Minecraft,system-ui,sans-serif; text-shadow:2px 2px #342c34; }
  p { margin:0 40px 17px 0; color:#abb0b5; font-size:13px; line-height:1.5; }
  .variant-search { min-height:46px; display:flex; align-items:center; gap:9px; padding:0 10px; border:1px solid #4b5055; border-radius:8px; background:#121315; }
  .variant-search svg { width:19px; height:19px; fill:none; stroke:#90959a; stroke-width:1.8; stroke-linecap:round; }
  .variant-search input { min-width:0; height:44px; flex:1; border:0; outline:0; color:#eef0f2; background:none; }
  .variant-search button { width:36px; height:36px; border:0; background:none; color:#aeb3b8; font-size:22px; cursor:pointer; }
  .variant-count { padding:8px 3px; color:#858a8f; font-size:11px; }
  .variant-list { min-height:0; overflow:auto; border:1px solid #393d41; border-radius:8px; background:#191b1e; }
  .variant-row { width:100%; min-height:76px; display:grid; grid-template-columns:54px minmax(0,1fr) 18px; align-items:center; gap:11px; padding:10px; border:0; border-bottom:1px solid #303337; background:none; text-align:left; cursor:pointer; }
  .variant-row:hover,.variant-row:focus-visible { background:#292c30; }
  .variant-row>span { min-width:0; overflow:hidden; }
  .variant-row strong,.variant-row small,.variant-row em { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .variant-row strong { color:#f0f1f2; font:16px Minecraft,system-ui,sans-serif; text-shadow:2px 2px #342c34; }
  .variant-row small { margin-top:2px; color:#5457fa; font:12px Minecraft,system-ui,sans-serif; text-shadow:2px 2px #342c34; }
  .variant-row em { max-height:4.2em; margin-top:4px; overflow:hidden; color:#aca1ab; font:400 13px/1.4 Minecraft,system-ui,sans-serif; font-style:normal; text-shadow:2px 2px #342c34; white-space:normal; }
  .variant-row em :global(.minecraft-line) { min-height:1.4em; white-space:nowrap; }
  .variant-row>b { color:#858a8f; font-size:24px; }
  .variant-more { width:100%; min-height:48px; border:0; background:#292c30; color:#d4d7da; cursor:pointer; }
  .variant-empty { padding:50px 20px; color:#91969b; text-align:center; }
  @media (max-width:600px) {
    .variant-backdrop { padding:12px; }
    .variant-picker { max-height:calc(100dvh - 24px); padding:21px 14px 14px; }
    .variant-row { min-height:82px; padding:11px 7px; }
  }
</style>
