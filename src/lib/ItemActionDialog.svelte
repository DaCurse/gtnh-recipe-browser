<script lang="ts">
  import { onMount } from 'svelte';
  import CatalogTooltip from './CatalogTooltip.svelte';
  import TooltipSkeleton from './TooltipSkeleton.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { useCatalogEntry } from './catalogEntryLoad.svelte';
  import type { CatalogEntry } from './types';

  let { entry, navigate, close, opener, usageLabel = 'Usages' }: {
    entry: CatalogEntry;
    navigate: (id: string, view: 'recipes' | 'usages') => void;
    close: () => void;
    opener?: HTMLElement;
    usageLabel?: string;
  } = $props();
  let dialog: HTMLDialogElement;
  const detail = useCatalogEntry(() => entry.id);
  onMount(() => { dialog.showModal(); return () => { if (opener?.isConnected) opener.focus(); }; });
  function choose(view: 'recipes' | 'usages') {
    const id = entry.id;
    const destination = navigate;
    close();
    destination(id, view);
  }
</script>

<dialog class="item-action-dialog" bind:this={dialog} aria-label={`Inspect ${entry.name}`}
  oncancel={(event) => { event.preventDefault(); close(); }}
  onclick={(event) => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  } }}>
  <button class="close" aria-label="Close item actions" onclick={close}>×</button>
  <div class="item-action-icon"><ItemIcon {entry} size={64} /></div>
  <div class="item-action-info">
    {#if detail.loading}<TooltipSkeleton />
    {:else if detail.error}<p role="status">Item info could not be loaded.</p><button class="mc-button" onclick={() => detail.retry()}>Retry</button>
    {:else}<CatalogTooltip entry={detail.entry ?? entry} />{/if}
  </div>
  <div class="actions">
    <button class="mc-button" onclick={() => choose('recipes')}>Recipes</button>
    <button class="mc-button" onclick={() => choose('usages')}>{usageLabel}</button>
  </div>
</dialog>

<style>
  dialog { width:min(460px,calc(100vw - 32px)); max-height:calc(100dvh - 32px); box-sizing:border-box; overflow:auto; padding:20px; border:1px solid #62666c; border-radius:12px; color:#eee; background:#202226; }
  dialog::backdrop { background:#050607cc; backdrop-filter:blur(4px); }
  .item-action-icon { margin:0 44px 12px 0; pointer-events:none; }
  .close { position:absolute; top:4px; right:4px; width:44px; height:44px; border:0; background:none; color:#ccc; font-size:25px; }
  .item-action-info { overflow:auto; max-height:55dvh; }
  .actions { display:flex; gap:10px; margin-top:16px; }
  .actions button { flex:1; min-height:44px; }
</style>
