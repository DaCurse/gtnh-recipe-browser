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
import {
  buildSpecialGoodsIndex,
  splitSpecialRecords
} from '../tools/pack-builder/builder';
import { expandGtOreSpecialData } from '../tools/pack-builder/specialOreAliases';
import { isVendingMachineItem, repairSpecialServiceIcons } from '../tools/pack-builder/specialServiceIcons';
import { specialGoodsForDirection } from '../tools/pack-builder/special';
import type { DecodedItem, DecodedOreDictionary, DecodedRepository } from '../tools/pack-builder/model';

const fixturePath = 'tests/fixtures/nei-special-v1/browser-nei-special.json';

describe('format-4 special-data packing', () => {
  it('uses canonical view order and retains every nested goods reference', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    expect(buildSpecialViewTypes(data).map((view) => view.id)).toEqual(data.categories);
    expect(specialGoodsIds(data)).toContain('f:gregtech:hydrogen');
    expect(serializeSpecialData(data)).toBe(serializeSpecialData(JSON.parse(serializeSpecialData(data))));
  });

  it('repairs stale worldgen and vending service sprites from catalog anchors', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    data.serviceIcons = data.serviceIcons.map((icon) => icon.id === 'service:worldgen'
      || icon.id === 'service:vending' ? { ...icon, goodsId: 'i:wrong:placeholder:0' } : icon);
    const item = (fields: Partial<DecodedItem>): DecodedItem => ({
      id: 'i:test:item:0', name: 'Test', mod: 'test', internalName: 'item', numericId: 1,
      iconId: 1, tooltip: null, unlocalizedName: 'item.test', nbt: null, searchMask: [],
      productionRecipeIds: [], usageRecipeIds: [], searchable: true, kind: 'item', stackSize: 64,
      damage: 0, container: null, ...fields
    });
    const chest = item({
      id: 'i:minecraft:chest:0', mod: 'minecraft', internalName: 'chest', name: 'Chest'
    });
    const vending = item({
      id: 'i:gregtech:gt.blockmachines:2741', mod: 'gregtech', internalName: 'gt.blockmachines',
      name: 'Vending Machine', unlocalizedName: 'gt.blockmachines.multimachine.vendingmachine', damage: 2741
    });
    const repository = { items: [chest, vending] } as unknown as DecodedRepository;
    const repaired = repairSpecialServiceIcons(data, repository);
    expect(repaired.serviceIcons.find((icon) => icon.id === 'service:worldgen')?.goodsId)
      .toBe(chest.id);
    expect(repaired.serviceIcons.find((icon) => icon.id === 'service:vending')?.goodsId)
      .toBe(vending.id);
    expect(isVendingMachineItem(vending)).toBe(true);
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

  it('projects explicit product dictionaries to registered members but limits host ore aliases to GT blocks', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    const template = data.records.find((record) => record.category === 'gt-ore-vein')!;
    const gtOre = 'i:gregtech:gt.blockores2:32';
    const vanillaOre = 'i:minecraft:iron_ore:0';
    const gtDust = 'i:gregtech:gt.metaitem.01:2032';
    const ic2Dust = 'i:IC2:itemDust:5';
    const records: SpecialRecord[] = [{
      ...template,
      id: 'vein:iron',
      goodsIds: ['o:oreIron', 'o:dustIron'],
      productionGoodsIds: ['o:oreIron', 'o:dustIron'],
      usageGoodsIds: ['o:oreIron', 'o:dustIron'],
      recipesLookupId: 'special:vein:iron:recipes',
      usagesLookupId: 'special:vein:iron:usages',
      payload: {}
    }];
    const item = (id: string, mod: string, internalName: string): DecodedItem => ({
      id,
      name: id,
      mod,
      internalName,
      numericId: 0,
      iconId: 0,
      tooltip: null,
      unlocalizedName: id,
      nbt: null,
      searchMask: [],
      productionRecipeIds: [],
      usageRecipeIds: [],
      kind: 'item',
      searchable: true,
      stackSize: 64,
      damage: 0,
      container: null
    });
    const groups: DecodedOreDictionary[] = [
      { id: 'o:oreIron', kind: 'oreDict', searchMask: [], itemIds: [gtOre, vanillaOre] },
      { id: 'o:dustIron', kind: 'oreDict', searchMask: [], itemIds: [gtDust, ic2Dust] }
    ];
    const index = buildSpecialGoodsIndex(
      records,
      new Map([['vein:iron', 'special-vein']]),
      [
        item(gtOre, 'gregtech', 'gt.blockores2'),
        item(vanillaOre, 'minecraft', 'iron_ore'),
        item(gtDust, 'gregtech', 'gt.metaitem.01'),
        item(ic2Dust, 'IC2', 'itemDust')
      ],
      groups
    );

    expect(index.get(gtOre)).toEqual(index.get('o:oreIron'));
    expect(index.get(vanillaOre)).toBeUndefined();
    expect(index.get(gtDust)).toEqual(index.get('o:dustIron'));
    expect(index.get(ic2Dust)).toEqual(index.get('o:dustIron'));
  });

  it('enriches GT vein and small-ore records from payload materials before indexing', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    const vein = data.records.find((record) => record.category === 'gt-ore-vein')!;
    const smallOre = data.records.find((record) => record.category === 'gt-small-ore')!;
    const records: SpecialRecord[] = [
      {
        ...vein,
        id: 'vein:iron-material',
        goodsIds: ['i:gregtech:gt.blockores2:32'],
        productionGoodsIds: ['i:production-only'],
        usageGoodsIds: ['i:usage-only'],
        payload: { layers: [{ material: 'Iron' }] }
      },
      {
        ...smallOre,
        id: 'small-ore:iron-material',
        goodsIds: ['i:gregtech:gt.blockores2:32'],
        payload: { material: 'Iron' }
      }
    ];
    const repository = {
      items: [],
      fluids: [],
      oreDictionaries: [
        { id: 'o:oreIron', kind: 'oreDict', searchMask: [], itemIds: [] },
        { id: 'o:dustIron', kind: 'oreDict', searchMask: [], itemIds: [] },
        { id: 'o:crushedIron', kind: 'oreDict', searchMask: [], itemIds: [] },
        { id: 'o:rawOreIron', kind: 'oreDict', searchMask: [], itemIds: [] },
        { id: 'o:gemIron', kind: 'oreDict', searchMask: [], itemIds: [] }
      ],
      ingredientGroups: []
    } as unknown as DecodedRepository;
    const expanded = expandGtOreSpecialData({ ...data, records }, repository);

    for (const record of expanded.records) {
      expect(record.goodsIds).toEqual([
        'i:gregtech:gt.blockores2:32',
        'o:crushedIron',
        'o:dustIron',
        'o:gemIron',
        'o:rawOreIron'
      ]);
      expect(record.goodsIds).not.toContain('o:oreIron');
    }
    expect(expanded.records[0]?.productionGoodsIds).toEqual([
      'i:production-only',
      'o:crushedIron',
      'o:dustIron',
      'o:gemIron',
      'o:rawOreIron'
    ]);
    expect(expanded.records[0]?.usageGoodsIds).toEqual([
      'i:usage-only',
      'o:crushedIron',
      'o:dustIron',
      'o:gemIron',
      'o:rawOreIron'
    ]);
  });
});
