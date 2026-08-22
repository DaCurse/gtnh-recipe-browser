<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import type { RecipeView } from './types';
  import { toSpecialDrops, toSpecialGoodsList, type SpecialRecord, type SpecialResolver, type VeinSpecialPayload } from './specialData';
  let { record, resolve, navigate }: { record: SpecialRecord; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void } = $props();
  const payload = $derived(record.payload as VeinSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as Record<string, unknown>);
  const rawLayers = $derived(Array.isArray(rawPayload.layers) ? rawPayload.layers : []);
  const topOres = $derived(toSpecialGoodsList(
    payload.ores?.length
      ? payload.ores
      : rawPayload.representativeOres ?? []
  ));
  const topDusts = $derived(toSpecialGoodsList(rawPayload.representativeDusts ?? []));
  const potentialDrops = $derived(toSpecialDrops(payload.potentialDrops ?? rawPayload.potentialDrops ?? []));
  const dimensionChances = $derived(payload.dimensionChance
    ?? Object.fromEntries((Array.isArray(rawPayload.dimensions) ? rawPayload.dimensions : [])
      .filter((dimension): dimension is Record<string, unknown> => typeof dimension === 'object' && dimension !== null)
      .filter((dimension) => typeof dimension.id === 'string' || typeof dimension.id === 'number')
      .map((dimension) => [String(dimension.id), typeof dimension.chance === 'number' ? dimension.chance : 1])));
</script>

<div class="vein-card">
  <div class="special-stat-grid">
    {#if payload.minHeight !== undefined || typeof rawPayload.minY === 'number'}<span><b>Height</b>{payload.minHeight ?? rawPayload.minY}–{payload.maxHeight ?? rawPayload.maxY ?? payload.minHeight ?? rawPayload.minY}</span>{/if}
    {#if payload.weight !== undefined}<span><b>Weight</b>{payload.weight}</span>{/if}
    {#if payload.dimensions?.length || Array.isArray(rawPayload.dimensions)}<span><b>Dimensions</b>{(payload.dimensions ?? (rawPayload.dimensions as unknown[])).map((dimension) => typeof dimension === 'object' && dimension !== null ? JSON.stringify(dimension) : String(dimension)).join(', ')}</span>{/if}
  </div>
  {#if payload.overrides?.length}<p class="special-line"><b>Overrides</b> {payload.overrides.join(', ')}</p>{/if}
  {#if Object.keys(dimensionChances).length}
    <div class="dimension-chances"><b>Per-dimension chance</b>{#each Object.entries(dimensionChances) as [dimension, chance] (dimension)}<span>{dimension}: {Math.round((chance <= 1 ? chance * 100 : chance) * 100) / 100}%</span>{/each}</div>
  {/if}
  {#each rawLayers as rawLayer, layerIndex (`${layerIndex}:${JSON.stringify(rawLayer)}`)}
    {@const layer = rawLayer as Record<string, unknown>}
    {@const layerGoods = toSpecialGoodsList(layer.ores ?? (layer.oreGoodsId ? [layer.oreGoodsId] : []))}
    <section class="vein-layer">
      <h3>{typeof layer.name === 'string' ? layer.name : 'Vein layer'}</h3>
      <div class="special-stat-grid">
        {#if typeof layer.minHeight === 'number' || typeof layer.minY === 'number'}<span><b>Height</b>{layer.minHeight ?? layer.minY}–{layer.maxHeight ?? layer.maxY ?? layer.minHeight ?? layer.minY}</span>{/if}
        {#if typeof layer.weight === 'number'}<span><b>Weight</b>{layer.weight}</span>{/if}
      </div>
      <SpecialGoods goods={layerGoods} resolve={resolve} {navigate} label="Representative ores" />
    </section>
  {/each}
  <SpecialGoods goods={topOres} resolve={resolve} {navigate} label="Representative ores" />
  <SpecialGoods goods={topDusts} resolve={resolve} {navigate} label="Representative dusts" />
  <SpecialGoods goods={potentialDrops} resolve={resolve} {navigate} label="Potential drops" />
</div>

<style>
  .vein-card { display:flex; flex-direction:column; gap:12px; }
  .special-stat-grid { display:flex; flex-wrap:wrap; gap:7px; }
  .special-stat-grid span { display:flex; flex-direction:column; gap:2px; min-width:92px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }
  .special-stat-grid b,.dimension-chances>b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
  .special-line { margin:0; color:#b8bdc1; font-size:12px; line-height:1.4; }.special-line b { color:#90959a; font-size:10px; text-transform:uppercase; }
  .dimension-chances { display:flex; flex-wrap:wrap; align-items:center; gap:7px; color:#ffff55; font:12px Minecraft,monospace; text-shadow:2px 2px #342c34; }.dimension-chances>b { flex:0 0 100%; font-family:ui-sans-serif,system-ui,sans-serif; text-shadow:none; }
  .vein-layer { display:flex; flex-direction:column; gap:7px; padding:10px; border:1px solid #45494e; border-radius:7px; background:#24272b; }.vein-layer h3 { margin:0; color:#d5d9dc; font-size:13px; }
</style>
