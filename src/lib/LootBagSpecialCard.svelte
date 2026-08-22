<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { boundedSpecialPage, toSpecialDrops, toSpecialGoods, type LootBagSpecialPayload, type SpecialRecord, type SpecialResolver } from './specialData';
  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();
  const payload = $derived(record.payload as LootBagSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as Record<string, unknown>);
  const bag = $derived(toSpecialGoods(payload.bag ?? rawPayload.bagGoodsId));
  const groups = $derived(Array.isArray(rawPayload.groups) ? rawPayload.groups : payload.groups ?? []);
  let groupPage = $state(0);
  const groupPageSize = 4;
  const groupPageCount = $derived(Math.max(1, Math.ceil(groups.length / groupPageSize)));
  const visibleGroups = $derived(boundedSpecialPage(groups, groupPage, groupPageSize));
  const drops = $derived(toSpecialDrops(payload.drops ?? rawPayload.drops ?? record.outputs ?? []));
  const fortuneChances = $derived(Array.isArray(rawPayload.fortuneChances) ? rawPayload.fortuneChances.filter((value): value is number => typeof value === 'number') : []);
  const limits = $derived(rawPayload.limits as Record<string, unknown> | undefined);

  $effect(() => {
    if (groupPage >= groupPageCount) groupPage = groupPageCount - 1;
  });
</script>

<div class="loot-card">
  <SpecialGoods goods={bag ? [bag] : []} resolve={resolve} {navigate} label="Loot bag" showAmounts={false} showChance={false} />
  {#if payload.trashGroup || typeof rawPayload.trashGroupInheritance === 'string'}<p class="special-line"><b>Trash group inheritance</b> {payload.trashGroup ?? rawPayload.trashGroupInheritance}</p>{/if}
  {#each visibleGroups as rawGroup, index (`${groupPage * groupPageSize + index}:${JSON.stringify(rawGroup)}`)}
    {@const group = rawGroup as Record<string, unknown>}
    {@const alternatives = toSpecialDrops(group.alternatives ?? group.drops ?? [])}
    <section class:inherited={group.inherited === true} class="loot-group">
      <header><b>{typeof group.label === 'string' ? group.label : typeof group.id === 'string' ? group.id : 'Drop group'}</b>{#if typeof group.weight === 'number'}<span>weight {group.weight}</span>{/if}{#if typeof group.limit === 'number'}<span>limit {group.limit}</span>{/if}</header>
      <SpecialGoods goods={alternatives} resolve={resolve} {navigate} label={group.inherited === true ? 'Inherited alternatives' : undefined} />
    </section>
  {/each}
  {#if groupPageCount > 1}
    <nav class="loot-group-pages" aria-label="Loot groups">
      <button disabled={groupPage === 0} onclick={() => groupPage -= 1}>Previous groups</button>
      <span>{groupPage + 1} / {groupPageCount}</span>
      <button disabled={groupPage >= groupPageCount - 1} onclick={() => groupPage += 1}>Next groups</button>
    </nav>
  {/if}
  <SpecialGoods goods={drops} resolve={resolve} {navigate} label="Drops" />
  {#if fortuneChances.length}<p class="special-line"><b>Fortune 0–3 chances</b> {fortuneChances.map((chance) => `${Math.round(chance * 100)}%`).join(' · ')}</p>{/if}
  {#if limits && Object.keys(limits).length}<p class="special-line"><b>Static limits</b> {Object.entries(limits).map(([id, limit]) => `${id}: ${String(limit)}`).join(' · ')}</p>{/if}
</div>

<style>
  .loot-card { display:flex; flex-direction:column; gap:10px; }.loot-group { padding:9px; border:1px solid #45494e; border-radius:7px; background:#24272b; }.loot-group.inherited { border-style:dashed; }.loot-group header { display:flex; align-items:center; gap:8px; margin-bottom:7px; color:#d9dcdf; font-size:12px; }.loot-group header span { color:#969ba0; font-size:10px; }.loot-group-pages { display:flex; align-items:center; justify-content:center; gap:9px; }.loot-group-pages button { min-height:38px; padding:0 9px; border:1px solid #50555a; border-radius:6px; background:#292c30; color:#d2d5d8; cursor:pointer; }.loot-group-pages button:disabled { opacity:.4; cursor:default; }.loot-group-pages span { color:#92979c; font-size:11px; }.special-line { margin:0; color:#b8bdc1; font-size:12px; }.special-line b { color:#90959a; font-size:10px; text-transform:uppercase; }
</style>
