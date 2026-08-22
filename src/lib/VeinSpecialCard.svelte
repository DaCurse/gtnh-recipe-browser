<script lang="ts">
  import SpecialGoods from './SpecialGoods.svelte';
  import {
    gtDimensionDisplayGoodsId,
    gtDimensionDisplayOrder,
    humanizeGtOreName,
    specialCategory,
    toSpecialDrops,
    toSpecialGoodsList,
    type SpecialGoods as SpecialGoodsValue,
    type SpecialRecord,
    type SpecialResolver,
    type VeinSpecialPayload
  } from './specialData';
  import type { RecipeView } from './types';

  let { record, resolve, navigate }: {
    record: SpecialRecord;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  type RawValue = Record<string, unknown>;
  type DimensionRow = {
    id: string;
    goods: SpecialGoodsValue[];
    chance?: number;
    weight?: number;
    minY?: number;
    maxY?: number;
  };
  type LayerRow = {
    role: string;
    label: string;
    goods: SpecialGoodsValue[];
    material?: string;
  };

  const LAYER_ROLES = [
    ['primary', 'Primary'],
    ['secondary', 'Secondary'],
    ['between', 'Between'],
    ['sporadic', 'Sporadic']
  ] as const;

  const payload = $derived(record.payload as VeinSpecialPayload);
  const rawPayload = $derived(record.payload as unknown as RawValue);
  const category = $derived(specialCategory(record.category) ?? record.category);
  const smallOre = $derived(category === 'gtSmallOre');
  const rawLayers = $derived(Array.isArray(rawPayload.layers)
    ? rawPayload.layers.filter((value): value is RawValue => isRecord(value))
    : []);

  function isRecord(value: unknown): value is RawValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  function canonicalOreDictionary(value: unknown): string | undefined {
    const raw = stringValue(value);
    if (!raw) return undefined;
    const id = raw.startsWith('o:') ? raw : `o:${raw}`;
    return resolve(id)?.kind === 'oreDict' ? id : undefined;
  }

  function materialOreDictionary(material: string | undefined): string | undefined {
    if (!material) return undefined;
    return canonicalOreDictionary(`ore${material}`);
  }

  function layerGoods(layer: RawValue): SpecialGoodsValue[] {
    const rawValues = Array.isArray(layer.goodsIds)
      ? layer.goodsIds
      : layer.oreGoodsId !== undefined
        ? [layer.oreGoodsId]
        : Array.isArray(layer.ores)
          ? layer.ores
          : [];
    const material = stringValue(layer.material);
    const dictionary = canonicalOreDictionary(layer.oreDictionaryId ?? layer.oreDictionary)
      ?? materialOreDictionary(material);
    return toSpecialGoodsList(rawValues).map((goods) => dictionary
      ? { ...goods, oreDictionaryId: dictionary }
      : goods).slice(0, 1);
  }

  function layerRole(layer: RawValue): string | undefined {
    return stringValue(layer.role ?? layer.name)?.toLocaleLowerCase();
  }

  const layers = $derived(LAYER_ROLES.map(([role, label]): LayerRow => {
    const layer = rawLayers.find((candidate) => layerRole(candidate) === role);
    const material = layer ? stringValue(layer.material) : undefined;
    return {
      role,
      label,
      goods: layer ? layerGoods(layer) : [],
      material
    };
  }));

  function dimensionId(value: unknown): string | undefined {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (!isRecord(value)) return undefined;
    return stringValue(value.id ?? value.dimension ?? value.name);
  }

  function rawDimensions(): RawValue[] {
    if (!Array.isArray(rawPayload.dimensions)) return [];
    return rawPayload.dimensions.flatMap((value) => {
      const id = dimensionId(value);
      if (!id) return [];
      return [isRecord(value) ? { ...value, id } : { id }];
    }).sort((left, right) => gtDimensionDisplayOrder(String(left.id))
      - gtDimensionDisplayOrder(String(right.id)) || String(left.id).localeCompare(String(right.id)));
  }

  function dimensionHeight(id: string): { minY?: number; maxY?: number } {
    const heights = isRecord(rawPayload.dimensionHeights) ? rawPayload.dimensionHeights : undefined;
    const rawHeight = heights?.[id]
      ?? Object.entries(heights ?? {}).find(([key]) => {
        const keyOrder = gtDimensionDisplayOrder(key);
        const idOrder = gtDimensionDisplayOrder(id);
        return keyOrder !== Number.MAX_SAFE_INTEGER && keyOrder === idOrder;
      })?.[1];
    let height: { minY?: number; maxY?: number } | undefined;
    if (isRecord(rawHeight)) {
      height = {
        minY: numberValue(rawHeight.minY ?? rawHeight.minHeight),
        maxY: numberValue(rawHeight.maxY ?? rawHeight.maxHeight)
      };
    }
    if (typeof rawHeight === 'string') {
      const match = rawHeight.match(/(-?\d+)\s*[-–]\s*(-?\d+)/);
      if (match) height = { minY: Number(match[1]), maxY: Number(match[2]) };
    }
    const overrides = Array.isArray(rawPayload.overrides) ? rawPayload.overrides : [];
    const override = overrides.find((value) => isRecord(value) && dimensionId(value.dimension) === id);
    if (isRecord(override)) {
      height = { minY: numberValue(override.minY), maxY: numberValue(override.maxY) };
    }
    if (!height) return {};
    const globalMin = numberValue(payload.minHeight ?? rawPayload.minY);
    const globalMax = numberValue(payload.maxHeight ?? rawPayload.maxY);
    return height.minY === globalMin && height.maxY === globalMax ? {} : height;
  }

  function chanceForDimension(id: string, raw: RawValue): number | undefined {
    const direct = numberValue(raw.chance ?? raw.probability);
    if (direct !== undefined) return direct;
    const chances = isRecord(rawPayload.dimensionChance) ? rawPayload.dimensionChance : undefined;
    return numberValue(chances?.[id]);
  }

  function displayGoodsId(id: string, raw: RawValue): string | undefined {
    const explicitMap = isRecord(rawPayload.dimensionGoodsIds) ? rawPayload.dimensionGoodsIds : undefined;
    const explicit = stringValue(raw.goodsId ?? raw.displayGoodsId ?? explicitMap?.[id]);
    return gtDimensionDisplayGoodsId(id, resolve, explicit);
  }

  const dimensions = $derived(rawDimensions().map((raw): DimensionRow => {
    const id = String(raw.id);
    const goodsId = displayGoodsId(id, raw);
    const rawChance = smallOre ? undefined : chanceForDimension(id, raw);
    // New exports carry the plugin's normalized probability. Older sidecars
    // carried the raw random weight in this field; keep that useful value as
    // a weight badge instead of presenting it as a (clamped) 100% chance.
    const chance = rawChance !== undefined && rawChance >= 0 && rawChance <= 1
      ? rawChance
      : undefined;
    const weight = rawChance !== undefined && rawChance > 1 ? rawChance : undefined;
    const height = dimensionHeight(id);
    return {
      id,
      goods: goodsId ? [{
        goodsId,
        chance,
        weight
      }] : [],
      chance,
      weight,
      minY: height.minY,
      maxY: height.maxY
    };
  }));

  function firstGoods(value: unknown, material?: string, dictionaryId?: unknown): SpecialGoodsValue[] {
    const dictionary = canonicalOreDictionary(dictionaryId) ?? materialOreDictionary(material);
    return toSpecialGoodsList(value).slice(0, 1).map((goods) => dictionary
      ? { ...goods, oreDictionaryId: dictionary }
      : goods);
  }

  const smallOreGoods = $derived(firstGoods(
    rawPayload.representativeOres ?? rawPayload.ores ?? [],
    stringValue(rawPayload.material),
    rawPayload.oreDictionaryId ?? rawPayload.oreDictionary
  ));
  const smallOreDrops = $derived(toSpecialDrops(
    rawPayload.potentialDrops ?? rawPayload.drops ?? []
  ));

  function statRange(min: number | undefined, max: number | undefined): string {
    if (min === undefined && max === undefined) return '';
    if (min === undefined) return String(max);
    if (max === undefined || max === min) return String(min);
    return `${min}–${max}`;
  }

  function dimensionLabel(row: DimensionRow): string {
    const range = statRange(row.minY, row.maxY);
    return range ? `Height ${range}` : '';
  }

  function resolvedName(goods: SpecialGoodsValue[], fallback: string): string {
    const id = goods[0]?.alternatives?.[0] ?? goods[0]?.goodsId;
    return id ? resolve(id)?.name ?? goods[0]?.label ?? fallback : fallback;
  }
</script>

{#if smallOre}
  <div class="ore-stat-card small-ore-card">
    <section class="ore-primary-stat">
      {#if smallOreGoods.length}
        <SpecialGoods goods={smallOreGoods} resolve={resolve} {navigate} horizontal hideLabels showAmounts={false} showChance={false} />
      {/if}
      <div class="ore-primary-copy">
        <b>{resolvedName(smallOreGoods, humanizeGtOreName(record.title))}</b>
        <span>Height {statRange(numberValue(payload.minHeight ?? rawPayload.minY), numberValue(payload.maxHeight ?? rawPayload.maxY)) || '—'}</span>
        <span>{numberValue(payload.amount ?? rawPayload.amount) ?? '—'} per chunk</span>
      </div>
    </section>
    {#if smallOreDrops.length}
      <SpecialGoods goods={smallOreDrops} resolve={resolve} {navigate} compact label="Drops" />
    {/if}
    {#if dimensions.length}
      <section class="generated-world">
        <div class="generated-world-label">Generated World</div>
        <div class="dimension-list">
          {#each dimensions as dimension, index (`${dimension.id}:${index}`)}
            <div class="dimension-row">
              {#if dimension.goods.length}
                <SpecialGoods goods={dimension.goods} resolve={resolve} {navigate} horizontal hideLabels showAmounts={false} showChance={false} />
              {/if}
              <div class="dimension-copy">
                <b>{dimension.goods.length ? resolvedName(dimension.goods, dimension.id) : dimension.id}</b>
                {#if dimensionLabel(dimension)}<span>{dimensionLabel(dimension)}</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
{:else}
  <div class="ore-stat-card vein-card">
    <section class="layer-list" aria-label="Vein layers">
      {#each layers as layer, index (`${layer.role}:${index}`)}
        <div class="layer-row">
          {#if layer.goods.length}
            <SpecialGoods goods={layer.goods} resolve={resolve} {navigate} horizontal hideLabels showAmounts={false} showChance={false} />
          {:else}
            <div class="empty-slot" aria-hidden="true">—</div>
          {/if}
          <div class="layer-copy">
            <b>{layer.label}</b>
            <span>{resolvedName(layer.goods, layer.material ?? 'No ore block recorded')}</span>
          </div>
        </div>
      {/each}
    </section>
    {#if dimensions.length}
      <section class="generated-world">
        <div class="generated-world-label">Generated World</div>
        <div class="dimension-list">
          {#each dimensions as dimension, index (`${dimension.id}:${index}`)}
            <div class="dimension-row">
              {#if dimension.goods.length}
                <SpecialGoods goods={dimension.goods} resolve={resolve} {navigate} horizontal hideLabels showAmounts={false} />
              {:else}
                <div class="empty-slot" aria-hidden="true">—</div>
              {/if}
              <div class="dimension-copy">
                <b>{dimension.goods.length ? resolvedName(dimension.goods, dimension.id) : dimension.id}</b>
                {#if dimensionLabel(dimension)}<span>{dimensionLabel(dimension)}</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
    <div class="vein-stats">
      <span><b>Height</b>{statRange(numberValue(payload.minHeight ?? rawPayload.minY), numberValue(payload.maxHeight ?? rawPayload.maxY)) || '—'}</span>
      <span><b>Weight</b>{numberValue(payload.weight ?? rawPayload.weight) ?? '—'}</span>
    </div>
  </div>
{/if}

<style>
  .ore-stat-card { display:flex; flex-direction:column; gap:13px; min-width:0; }
  .layer-list,.dimension-list { display:flex; flex-direction:column; gap:5px; }
  .layer-row,.dimension-row { display:grid; grid-template-columns:56px minmax(0,1fr); align-items:center; gap:10px; min-height:56px; padding:4px 7px; border:1px solid #3e4247; border-radius:7px; background:#25282c; }
  .layer-row :global(.special-goods),.dimension-row :global(.special-goods) { width:56px; }
  .layer-row :global(.special-goods-grid),.dimension-row :global(.special-goods-grid) { width:56px; }
  .layer-copy,.dimension-copy,.ore-primary-copy { display:flex; flex-direction:column; min-width:0; gap:3px; }
  .layer-copy b,.dimension-copy b,.ore-primary-copy b { color:#e0e3e5; font-size:12px; overflow-wrap:anywhere; }
  .layer-copy span,.dimension-copy span,.ore-primary-copy span { color:#aeb3b8; font-size:11px; line-height:1.3; overflow-wrap:anywhere; }
  .generated-world { display:flex; flex-direction:column; gap:6px; padding-top:2px; }
  .generated-world-label { color:#d7dade; font-size:12px; font-weight:700; letter-spacing:.03em; }
  .dimension-row { background:#292c30; }
  .dimension-copy b { font-size:11px; }
  .empty-slot { width:56px; height:56px; display:grid; place-items:center; border:1px dashed #545960; border-radius:6px; color:#82878c; font-size:20px; }
  .ore-primary-stat { display:grid; grid-template-columns:56px minmax(0,1fr); align-items:center; gap:10px; padding:5px 7px; border:1px solid #45494e; border-radius:7px; background:#292c30; }
  .ore-primary-stat :global(.special-goods-grid) { width:56px; }
  .ore-primary-copy span { color:#c0c5c9; }
  .vein-stats { display:flex; flex-wrap:wrap; gap:7px; padding-top:3px; border-top:1px solid #3b3f44; }
  .vein-stats span { display:flex; flex-direction:column; gap:2px; min-width:95px; padding:7px 9px; border:1px solid #45494e; border-radius:6px; background:#292c30; color:#d8dbde; font-size:12px; }
  .vein-stats b { color:#90959a; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
  @media (max-width:520px) {
    .layer-row,.dimension-row,.ore-primary-stat { grid-template-columns:56px minmax(0,1fr); padding-inline:4px; gap:7px; }
  }
</style>
