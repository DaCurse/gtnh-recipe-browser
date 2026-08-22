<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { boundedSpecialPage, toSpecialDrops, type SpecialDrop, type SpecialRecord, type SpecialResolver, type WorldgenSpecialPayload } from './specialData';

  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();

  type RawValue = Record<string, unknown>;
  type LootGroup = {
    id: string;
    label: string;
    totalWeight?: number;
    drops: SpecialDrop[];
  };

  const payload = $derived(record.payload as WorldgenSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as RawValue);
  let groupPage = $state(0);
  const groupPageSize = 4;

  function isRecord(value: unknown): value is RawValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  function rawEntries(value: unknown): RawValue[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
  }

  /**
   * Forge and Roguelike call the field `weight`, while Twilight Forest calls
   * it `rarity`.  NEI divides either value by that table's total, so the
   * browser must normalize the number before rendering the yellow chance
   * badge instead of treating the raw weight as a percentage.
   */
  function makeGroup(id: string, label: string, entries: RawValue[], declaredTotal?: number): LootGroup {
    const weights = entries.map((entry) => numberValue(entry.weight ?? entry.rarity));
    const calculatedTotal = weights.reduce((sum: number, value) => sum + Math.max(0, value ?? 0), 0);
    const totalWeight = declaredTotal !== undefined && declaredTotal > 0
      ? declaredTotal
      : calculatedTotal > 0
        ? calculatedTotal
        : undefined;
    const drops = toSpecialDrops(entries.map((entry, index) => {
      const weight = weights[index];
      const chance = weight !== undefined && totalWeight !== undefined
        ? Math.max(0, weight) / totalWeight
        : numberValue(entry.chance ?? entry.probability);
      // Weight is used to calculate the chance, but the worldgen card is a
      // chance grid. Do not show a second, unexplained raw-weight badge.
      const withoutWeight: RawValue = {};
      for (const [key, value] of Object.entries(entry)) {
        if (key !== 'weight' && key !== 'rarity') withoutWeight[key] = value;
      }
      return { ...withoutWeight, chance };
    }));
    return { id, label, totalWeight, drops };
  }

  function buildGroups(): LootGroup[] {
    const tables = rawEntries(rawPayload.tables);
    if (tables.length > 0) {
      return tables.map((table, index) => {
        const entries = rawEntries(table.entries ?? table.items ?? table.drops);
        const label = stringValue(table.name ?? table.id) ?? `Loot table ${index + 1}`;
        return makeGroup(`table:${index}:${label}`, label, entries, numberValue(table.totalWeight));
      }).filter((group) => group.drops.length > 0);
    }
    const entries = rawEntries(rawPayload.entries);
    if (entries.length > 0) {
      const label = stringValue(rawPayload.name ?? rawPayload.table ?? rawPayload.tableId) ?? 'Possible loot';
      return [makeGroup('entries', label, entries, numberValue(rawPayload.totalWeight))]
        .filter((group) => group.drops.length > 0);
    }
    const fallback = toSpecialDrops(payload.drops ?? rawPayload.drops ?? record.outputs ?? []);
    return fallback.length > 0 ? [{ id: 'drops', label: 'Possible loot', drops: fallback }] : [];
  }

  const groups = $derived(buildGroups());
  const groupPageCount = $derived(Math.max(1, Math.ceil(groups.length / groupPageSize)));
  const visibleGroups = $derived(boundedSpecialPage(groups, groupPage, groupPageSize));

  function percentLabel(value: number): string {
    const percent = value <= 1 ? value * 100 : value;
    return `${Number(Math.min(100, Math.max(0, percent)).toFixed(2))}%`;
  }

  $effect(() => {
    if (groupPage >= groupPageCount) groupPage = groupPageCount - 1;
  });
</script>

<div class="worldgen-card">
  <div class="special-stat-grid">
    {#if payload.source}<span><b>Source</b>{payload.source}</span>{/if}
    {#if payload.table || rawPayload.tableId}<span><b>Table</b>{payload.table ?? String(rawPayload.tableId)}</span>{/if}
    {#if payload.minAmount !== undefined}<span><b>Amount</b>{payload.minAmount}–{payload.maxAmount ?? payload.minAmount}</span>{/if}
    {#if payload.weight !== undefined}<span><b>Weight</b>{payload.weight}</span>{/if}
    {#if payload.chance !== undefined}<span><b>Chance</b>{percentLabel(payload.chance)}</span>{/if}
    {#if payload.dimensions?.length}<span><b>Dimensions</b>{payload.dimensions.join(', ')}</span>{/if}
  </div>

  {#each visibleGroups as group (`${group.id}`)}
    <section class="loot-group">
      <header><b>{group.label}</b>{#if group.totalWeight !== undefined}<span>Total weight {group.totalWeight}</span>{/if}</header>
      <SpecialGoods goods={group.drops} resolve={resolve} {navigate} compact wrapLabels pageSize={12} label="Possible loot" />
    </section>
  {/each}

  {#if groupPageCount > 1}
    <nav class="loot-group-pages" aria-label="World-generation loot tables">
      <button disabled={groupPage === 0} onclick={() => groupPage -= 1}>Previous tables</button>
      <span>{groupPage + 1} / {groupPageCount}</span>
      <button disabled={groupPage >= groupPageCount - 1} onclick={() => groupPage += 1}>Next tables</button>
    </nav>
  {/if}
  {#if groups.length === 0}<p class="special-empty">No world-generation loot was recorded.</p>{/if}
</div>

<style>
  .worldgen-card { display:flex; flex-direction:column; gap:10px; min-width:0; }
  .special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }
  .special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }
  .special-stat-grid b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
  .loot-group { min-width:0; padding:9px; border:1px solid #45494e; border-radius:7px; background:#24272b; }
  .loot-group header { display:flex; align-items:center; gap:9px; margin-bottom:7px; color:#d9dcdf; font-size:12px; }
  .loot-group header span { color:#969ba0; font-size:10px; }
  .loot-group-pages { display:flex; align-items:center; justify-content:center; gap:9px; }
  .loot-group-pages button { min-height:38px; padding:0 9px; border:1px solid #50555a; border-radius:6px; background:#292c30; color:#d2d5d8; cursor:pointer; }
  .loot-group-pages button:disabled { opacity:.4; cursor:default; }
  .loot-group-pages span { color:#92979c; font-size:11px; }
  .special-empty { margin:0; color:#92979c; font-size:12px; }
</style>
