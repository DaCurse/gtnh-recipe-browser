<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { toSpecialDrops, type SpecialRecord, type SpecialResolver, type WorldgenSpecialPayload } from './specialData';
  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();
  const payload = $derived(record.payload as WorldgenSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as Record<string, unknown>);
  const tables = $derived(Array.isArray(rawPayload.tables) ? rawPayload.tables : []);
  const tableDrops = $derived(tables.flatMap((table) => {
    if (typeof table !== 'object' || table === null) return [];
    const value = table as Record<string, unknown>;
    return toSpecialDrops(value.entries ?? []);
  }));
  const drops = $derived(toSpecialDrops(
    payload.drops?.length
      ? payload.drops
      : tableDrops.length
        ? tableDrops
        : rawPayload.drops ?? record.outputs ?? []
  ));
</script>

<div class="worldgen-card">
  <div class="special-stat-grid">
    {#if payload.source || tables.length}<span><b>Source</b>{payload.source ?? tables.map((table) => typeof table === 'object' && table !== null ? String((table as Record<string, unknown>).source ?? '') : '').filter(Boolean).join(', ')}</span>{/if}
    {#if payload.table || tables.length}<span><b>Table</b>{payload.table ?? tables.map((table) => typeof table === 'object' && table !== null ? String((table as Record<string, unknown>).name ?? '') : '').filter(Boolean).join(', ')}</span>{/if}
    {#if payload.minAmount !== undefined}<span><b>Amount</b>{payload.minAmount}–{payload.maxAmount ?? payload.minAmount}</span>{/if}
    {#if payload.weight !== undefined}<span><b>Weight</b>{payload.weight}</span>{/if}
    {#if payload.chance !== undefined}<span><b>Chance</b>{Math.round(payload.chance * 100)}%</span>{/if}
    {#if payload.dimensions?.length}<span><b>Dimensions</b>{payload.dimensions.join(', ')}</span>{/if}
  </div>
  <SpecialGoods goods={drops} resolve={resolve} {navigate} label="World-generation loot" />
</div>

<style>
  .worldgen-card { display:flex; flex-direction:column; gap:12px; }.special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }.special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }.special-stat-grid b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
</style>
