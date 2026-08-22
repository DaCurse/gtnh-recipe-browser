import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetRepository } from '../src/lib/dataset';

function asset(id: string, value: unknown) {
  const bytes = gzipSync(encode(value), { level: 9 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    id,
    url: `./assets/${id}.${sha256.slice(0, 16)}.mpk`,
    bytes: bytes.byteLength,
    sha256,
    encoding: 'gzip' as const,
    bytesValue: bytes
  };
}

function descriptor(value: ReturnType<typeof asset>) {
  const result = { ...value };
  Reflect.deleteProperty(result, 'bytesValue');
  return result;
}

function response(url: string, body: BodyInit, contentType?: string): Response {
  const result = new Response(body, {
    status: 200,
    headers: contentType ? { 'content-type': contentType } : undefined
  });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

describe('format-4 DatasetRepository special shards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads special tabs lazily and accounts for their offline assets', async () => {
    const datasetId = `special-repository-${crypto.randomUUID()}`;
    const specialId = 'special-crop-output-000';
    const goodsId = 'i:fixture:test';
    const core = asset('catalog-core', {
      schemaVersion: 4,
      datasetId,
      kind: 'core',
      recipeTypes: [],
      oreDictionaries: [],
      ingredientGroups: [],
      specialViewTypes: [{ id: 'crop-outputs', label: 'Crop Outputs', serviceIconId: 'service:crop' }],
      specialServiceIcons: [{ id: 'service:crop', label: 'Crop', searchable: false, icon: null }]
    });
    const goods = asset('catalog-goods', {
      schemaVersion: 4,
      datasetId,
      kind: 'goods',
      part: 0,
      goods: [{
        id: goodsId,
        name: 'Fixture',
        mod: 'cropsnh',
        kind: 'item',
        tooltip: null,
        internalName: 'genericSeed',
        unlocalizedName: 'fixture',
        nbt: '{crop:"cropsnh:fixture",scan:1b}',
        numericId: 1,
        searchMask: [],
        searchable: true,
        icon: null,
        productionShards: [],
        usageShards: [],
        productionCount: 0,
        usageCount: 0,
        specialProductionShards: [specialId],
        specialUsageShards: [specialId],
        specialProductionCount: 1,
        specialUsageCount: 1
      }, {
        id: 'i:cropsnh:genericSeed:0:variant',
        name: 'Fixture Seed',
        mod: 'cropsnh',
        kind: 'item',
        tooltip: null,
        internalName: 'genericSeed',
        unlocalizedName: 'fixture.seed',
        nbt: '{crop:"cropsnh:fixture",scan:1b,gr:1b,ga:1b,re:1b}',
        numericId: 2,
        damage: 0,
        searchMask: [],
        searchable: true,
        icon: null,
        productionShards: [],
        usageShards: [],
        productionCount: 0,
        usageCount: 0,
        specialProductionShards: [specialId],
        specialUsageShards: [specialId],
        specialProductionCount: 1,
        specialUsageCount: 1
      }]
    });
    const special = asset(specialId, {
      schemaVersion: 4,
      datasetId,
      kind: 'special',
      specialViewTypeId: 'crop-outputs',
      specialViewTypeOrder: 0,
      part: 0,
      records: [{
        id: 'crop:fixture',
        category: 'crop-outputs',
        title: 'Fixture Crop',
        searchText: 'fixture crop',
        goodsIds: [goodsId],
        recipesLookupId: 'special:fixture:recipes',
        usagesLookupId: 'special:fixture:usages',
        serviceIconId: 'service:crop',
        payload: { output: { goodsId } }
      }]
    });
    const assets = [core, goods, special];
    const manifest = {
      formatVersion: 4,
      datasetId,
      gtnhVersion: 'fixture',
      revision: 'fixture',
      displayName: 'Fixture',
      source: { formatVersion: 5, dataSha256: 'fixture', atlasSha256: 'fixture' },
      catalogAssets: [
        { ...descriptor(core), kind: 'catalog', role: 'core', part: 0, goodsCount: 0 },
        { ...descriptor(goods), kind: 'catalog', role: 'goods', part: 0, goodsCount: 1 }
      ],
      recipeShards: [],
      specialDataShards: [{ ...descriptor(special), kind: 'specialData', specialViewTypeId: 'crop-outputs', specialViewTypeOrder: 0, part: 0, recordCount: 1 }],
      iconSheets: [],
      totals: {
        searchableEntries: 1,
        recipes: 0,
        specialRecords: 1,
        assets: assets.length,
        offlineBytes: assets.reduce((total, candidate) => total + candidate.bytes, 0)
      }
    };
    const baseUrl = 'https://fixture.test/';
    vi.stubGlobal('document', { baseURI: baseUrl });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${baseUrl}versions.json`) {
        return response(url, JSON.stringify({
          schemaVersion: 1,
          versions: [{ datasetId, gtnhVersion: 'fixture', revision: 'fixture', packManifestUrl: 'packs/manifest.json' }]
        }), 'application/json');
      }
      if (url === `${baseUrl}packs/manifest.json`) {
        return response(url, JSON.stringify(manifest), 'application/json');
      }
      const candidate = assets.find((entry) => new URL(entry.url, `${baseUrl}packs/manifest.json`).href === url);
      if (!candidate) return new Response('not found', { status: 404 });
      return new Response(candidate.bytesValue, { status: 200 });
    }));

    const repository = await DatasetRepository.load(datasetId);
    expect(repository.specialViewTypes.map((view) => view.id)).toEqual(['crop-outputs']);
    expect(repository.offlineBytes).toBe(manifest.totals.offlineBytes);
    expect((repository.entries.find((entry) => entry.id === goodsId))?.specialProductionCount).toBe(1);

    const progress: Array<{ loadedShards: number; totalShards: number }> = [];
    const records = await repository.specialFor(
      goodsId,
      'recipes',
      'crop-outputs',
      ({ loadedShards, totalShards }) => progress.push({ loadedShards, totalShards })
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.lookupId).toBe('special:fixture:recipes');
    expect(progress.at(-1)).toEqual({ loadedShards: 1, totalShards: 1 });

    const variantRecords = await repository.specialFor(
      'i:cropsnh:genericSeed:0:variant',
      'recipes',
      'crop-outputs'
    );
    expect(variantRecords).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    await expect(repository.specialFor(goodsId, 'recipes', 'crop-outputs', undefined, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
