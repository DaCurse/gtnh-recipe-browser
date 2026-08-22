import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildSpecialViewTypes,
  readSpecialSidecar,
  serializeSpecialData,
  specialGoodsIds,
  type SpecialRecord
} from '../tools/data-export/special';
import { buildSpecialGoodsIndex, splitSpecialRecords } from '../tools/pack-builder/builder';
import { specialGoodsForDirection } from '../tools/pack-builder/special';
import type { DecodedItem } from '../tools/pack-builder/model';

const fixturePath = 'tests/fixtures/nei-special-v1/browser-nei-special.json';

describe('format-4 special-data packing', () => {
  it('uses canonical view order and retains every nested goods reference', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    expect(buildSpecialViewTypes(data).map((view) => view.id)).toEqual(data.categories);
    expect(specialGoodsIds(data)).toContain('f:gregtech:hydrogen');
    expect(serializeSpecialData(data)).toBe(serializeSpecialData(JSON.parse(serializeSpecialData(data))));
  });

  it('splits special records deterministically and preserves sorted IDs', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    const view = buildSpecialViewTypes(data)[0]!;
    const records = data.records.filter((record) => record.category === view.id);
    const inflated = records.concat(records.map((record) => ({
      ...record,
      id: `${record.id}:copy`,
      searchText: `${record.searchText} ${'metadata '.repeat(80)}`
    })));
    const first = splitSpecialRecords('fixture-r1', view, inflated, 300);
    const second = splitSpecialRecords('fixture-r1', view, inflated, 300);
    expect(second).toEqual(first);
    expect(first.flat()).toEqual(inflated);
    expect(first.length).toBeGreaterThan(1);
    expect(first.flatMap((part) => part.map((record) => record.id))).toEqual(
      inflated.map((record) => record.id)
    );
    first.forEach((part, index) => {
      const bytes = gzipSync(encode({
        schemaVersion: 4,
        datasetId: 'fixture-r1',
        kind: 'special',
        specialViewTypeId: view.id,
        specialViewTypeOrder: data.categories.indexOf(view.id),
        part: index,
        records: part
      }), { level: 9 });
      expect(bytes.byteLength <= 300 || part.length === 1).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
    });
  });

  it('precomputes direction-specific goods projections with legacy parity', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    const template = data.records[0]!;
    const records: SpecialRecord[] = [
      {
        ...template,
        id: 'directional-a',
        goodsIds: ['i:demo:a:0'],
        productionGoodsIds: ['i:demo:a:0'],
        usageGoodsIds: ['i:demo:b:0'],
        recipesLookupId: 'special:directional:a:recipes',
        usagesLookupId: 'special:directional:a:usages',
        payload: {}
      },
      {
        ...template,
        id: 'directional-b',
        goodsIds: ['i:demo:a:0'],
        productionGoodsIds: ['i:demo:a:0'],
        usageGoodsIds: ['i:demo:a:0'],
        recipesLookupId: 'special:directional:b:recipes',
        usagesLookupId: 'special:directional:b:usages',
        payload: {}
      }
    ];
    const shards = new Map([
      ['directional-a', 'special-a'],
      ['directional-b', 'special-b']
    ]);
    const index = buildSpecialGoodsIndex(records, shards);

    const expected = new Map<string, {
      recipes: { shardIds: string[]; lookupIds: string[]; recordCount: number };
      usages: { shardIds: string[]; lookupIds: string[]; recordCount: number };
    }>();
    for (const record of records) {
      for (const direction of ['recipes', 'usages'] as const) {
        for (const goodsId of specialGoodsForDirection(record, direction)) {
          const current = expected.get(goodsId) ?? {
            recipes: { shardIds: [], lookupIds: [], recordCount: 0 },
            usages: { shardIds: [], lookupIds: [], recordCount: 0 }
          };
          const projection = current[direction];
          const shard = shards.get(record.id);
          if (shard && !projection.shardIds.includes(shard)) projection.shardIds.push(shard);
          const lookup = direction === 'recipes' ? record.recipesLookupId : record.usagesLookupId;
          if (!projection.lookupIds.includes(lookup)) projection.lookupIds.push(lookup);
          projection.recordCount++;
          projection.shardIds.sort();
          projection.lookupIds.sort();
          expected.set(goodsId, current);
        }
      }
    }
    expect([...index.entries()]).toEqual([...expected.entries()]);
    expect(index.get('i:demo:a:0')).toEqual({
      recipes: {
        shardIds: ['special-a', 'special-b'],
        lookupIds: ['special:directional:a:recipes', 'special:directional:b:recipes'],
        recordCount: 2
      },
      usages: {
        shardIds: ['special-b'],
        lookupIds: ['special:directional:b:usages'],
        recordCount: 1
      }
    });
    expect(index.get('i:demo:b:0')).toEqual({
      recipes: { shardIds: [], lookupIds: [], recordCount: 0 },
      usages: {
        shardIds: ['special-a'],
        lookupIds: ['special:directional:a:usages'],
        recordCount: 1
      }
    });
  });

  it('projects CropsNH special indexes to every exact seed variant', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    const template = data.records.find((record) => record.category === 'crop-output')!;
    const canonicalId = 'i:cropsnh:genericSeed:0:canonical';
    const siblingId = 'i:cropsnh:genericSeed:0:sibling';
    const otherCropId = 'i:cropsnh:genericSeed:0:other';
    const records: SpecialRecord[] = [{
      ...template,
      id: 'crop:cropsnh-rubyne',
      goodsIds: [canonicalId],
      productionGoodsIds: [canonicalId],
      usageGoodsIds: [canonicalId],
      recipesLookupId: 'special:crop:cropsnh-rubyne:recipes',
      usagesLookupId: 'special:crop:cropsnh-rubyne:usages',
      payload: {}
    }];
    const seed = (id: string, nbt: string): DecodedItem => ({
      id,
      name: 'Rubyne Seeds',
      mod: 'cropsnh',
      internalName: 'genericSeed',
      numericId: 0,
      iconId: 0,
      tooltip: null,
      unlocalizedName: 'cropsnh_crops.rubyne',
      nbt,
      searchMask: [0, 0, 0, 0],
      productionRecipeIds: [],
      usageRecipeIds: [],
      kind: 'item',
      searchable: true,
      stackSize: 64,
      damage: 0,
      container: null
    });
    const index = buildSpecialGoodsIndex(records, new Map([['crop:cropsnh-rubyne', 'special-crop']]), [
      seed(canonicalId, '{crop:"cropsnh:rubyne",scan:1b}'),
      seed(siblingId, '{re:1b,scan:1b,crop:"cropsnh:rubyne",gr:1b,ga:1b}'),
      seed(otherCropId, '{crop:"cropsnh:other",scan:1b}')
    ]);

    expect(index.get(siblingId)).toEqual(index.get(canonicalId));
    expect(index.get(otherCropId)).toBeUndefined();
  });
});
