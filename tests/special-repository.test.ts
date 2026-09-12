import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetRepository } from '../src/lib/dataset';
import { getDataset, removeDataset } from '../src/lib/storage';
import { sharedPrefixLayoutFingerprint } from '../tools/pack-builder/sharedLayout';
import { buildRecordPages } from '../tools/pack-builder/recordPages';

const temporaryPacks: string[] = [];

function response(url: string, body: BodyInit, contentType?: string): Response {
  const result = new Response(body, {
    status: 200,
    headers: contentType ? { 'content-type': contentType } : undefined
  });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

describe('canonical DatasetRepository special shards', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await Promise.all(temporaryPacks.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('loads item and global special views with direction, progress, cache, and cancellation', async () => {
    const root = await mkdtemp('/tmp/gtnh-special-repository-');
    temporaryPacks.push(root);
    await mkdir(join(root, 'assets', 'sha256'), { recursive: true });
    const datasetId = `special-repository-${crypto.randomUUID()}`;
    const goodsId = 'i:fixture:shared';
    const assetValues: Array<{ id: string; bytesValue: Buffer; sha256: string }> = [];
    const asset = async (id: string, value: unknown) => {
      const bytes = gzipSync(encode(value), { level: 9 });
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(root, 'assets', 'sha256', sha256), bytes);
      assetValues.push({ id, bytesValue: bytes, sha256 });
      return {
        id,
        url: `../../assets/sha256/${sha256}`,
        bytes: bytes.byteLength,
        sha256,
        encoding: 'gzip' as const,
        mediaType: 'application/msgpack'
      };
    };
    const core = await asset('catalog-core', {
      schemaVersion: 5,
      kind: 'core',
      logicalId: 'catalog-core',
      serviceItemIds: [],
      recipeTypes: [],
      oreDictionaries: [],
      ingredientGroups: []
    });
    const recipeTypes = await asset('catalog-recipe-types', { schemaVersion: 5, kind: 'recipeTypes', logicalId: 'catalog-recipe-types', recipeTypes: [] });
    const ingredientGroups = await asset('catalog-ingredient-groups', { schemaVersion: 5, kind: 'ingredientGroups', logicalId: 'catalog-ingredient-groups', ingredientGroups: [] });
    const recipeRemaps = await asset('catalog-recipe-remaps', { schemaVersion: 5, kind: 'recipeRemaps', logicalId: 'catalog-recipe-remaps', obsoleteRecipeRemaps: {} });
    const oreDictionaries = await asset('catalog-ore-dictionaries-root', {
      schemaVersion: 5, kind: 'oreDictionaries', logicalId: 'catalog-ore-dictionaries-root', prefix: '', oreDictionaries: []
    });
    const specialMetadata = await asset('catalog-special-metadata', {
      schemaVersion: 5,
      kind: 'specialMetadata',
      logicalId: 'catalog-special-metadata',
      specialViewTypes: [{ id: 'meteor-ritual', label: 'Meteor Rituals', serviceIconId: 'service:meteor', recordCount: 1 }],
      specialServiceIcons: [{ id: 'service:meteor', label: 'Meteor', searchable: false, icon: null }]
    });
    const goods = await asset('catalog-goods-root', {
      schemaVersion: 5,
      kind: 'goods',
      logicalId: 'catalog-goods-root',
      prefix: '',
      goods: [{
        id: goodsId,
        mod: 'fixture',
        kind: 'item',
        internalName: 'shared',
        unlocalizedName: 'fixture.shared',
        nbt: null,
        damage: 0,
        icon: null,
        productionShards: [],
        usageShards: [],
        productionCount: 0,
        usageCount: 0
      }]
    });
    const metadata = await asset('catalog-goods-metadata-root', {
      schemaVersion: 5,
      kind: 'goodsMetadata',
      logicalId: 'catalog-goods-metadata-root',
      prefix: '',
      goods: [{
        id: goodsId,
        name: 'Shared Fixture',
        tooltip: null,
        unlocalizedName: 'fixture.shared',
        searchMask: [],
        searchable: true,
        numericId: 1,
        productionShards: [],
        usageShards: [],
        productionCount: 0,
        usageCount: 0,
        specialProductionShards: ['special-meteor-ritual-root'],
        specialUsageShards: ['special-meteor-ritual-root'],
        specialProductionLookupIds: ['shared:recipes'],
        specialUsageLookupIds: ['shared:usages'],
        specialProductionCount: 1,
        specialUsageCount: 1
      }]
    });
    const special = await asset('special-meteor-ritual-root', {
      schemaVersion: 5,
      kind: 'special',
      logicalId: 'special-meteor-ritual-root',
      specialViewTypeId: 'meteor-ritual',
      prefix: '',
      records: [{
        id: 'meteor:shared',
        category: 'meteor-ritual',
        title: 'Shared Meteor',
        searchText: 'shared meteor',
        goodsIds: [goodsId],
        recipesLookupId: 'shared:recipes',
        usagesLookupId: 'shared:usages',
        serviceIconId: 'service:meteor',
        payload: { goodsId }
      }]
    });
    const descriptors = [
      { ...core, kind: 'catalog', role: 'core', part: 0, goodsCount: 0, logicalId: core.id },
      { ...recipeTypes, kind: 'catalog', role: 'recipeTypes', part: 0, goodsCount: 0, logicalId: recipeTypes.id },
      { ...ingredientGroups, kind: 'catalog', role: 'ingredientGroups', part: 0, goodsCount: 0, logicalId: ingredientGroups.id },
      { ...recipeRemaps, kind: 'catalog', role: 'recipeRemaps', part: 0, goodsCount: 0, logicalId: recipeRemaps.id },
      { ...oreDictionaries, kind: 'catalog', role: 'oreDictionaries', part: 0, goodsCount: 0, recordCount: 0, logicalId: oreDictionaries.id, prefix: '' },
      { ...specialMetadata, kind: 'catalog', role: 'specialMetadata', part: 0, goodsCount: 0, logicalId: specialMetadata.id },
      { ...(await asset('catalog-icons', { schemaVersion: 5, kind: 'icons', logicalId: 'catalog-icons', icons: [{ id: goodsId, icon: null }] })), kind: 'catalog', role: 'icons', part: 0, goodsCount: 0, logicalId: 'catalog-icons' },
      { ...goods, kind: 'catalog', role: 'goods', part: 0, goodsCount: 1, logicalId: goods.id, prefix: '' },
      { ...metadata, kind: 'catalog', role: 'goodsMetadata', part: 0, goodsCount: 1, logicalId: metadata.id, prefix: '' }
    ];
    const targets = { recipes: 1024, goods: 1024, goodsMetadata: 1024, special: 1024, oreDictionaries: 1024 };
    const prefixes = { recipeTypes: {}, goods: [''], oreDictionaries: [''], specialViews: { 'meteor-ritual': [''] } };
    const specialDescriptor = { ...special, kind: 'specialData', specialViewTypeId: 'meteor-ritual', specialViewTypeOrder: 0, part: 0, recordCount: 1, logicalId: special.id, prefix: '' };
    const recordPages = await buildRecordPages(
      [...descriptors, specialDescriptor],
      join(root, 'assets', 'sha256'),
      '../..',
      []
    );
    assetValues.length = 0;
    for (const page of recordPages) {
      assetValues.push({
        id: page.id,
        bytesValue: await readFile(join(root, 'assets', 'sha256', page.sha256)),
        sha256: page.sha256
      });
    }
    const manifest = {
      formatVersion: 6,
      datasetId,
      gtnhVersion: 'fixture',
      revision: 'shared',
      displayName: 'Shared fixture',
      assetStore: 'global-sha256',
      sharedLayout: {
        schemaVersion: 1,
        layoutSha256: sharedPrefixLayoutFingerprint({ schemaVersion: 1, targets, ...prefixes }),
        targets,
        prefixes
      },
      source: { formatVersion: 5, dataSha256: 'fixture', atlasSha256: 'fixture' },
      catalogAssets: descriptors,
      recordPages,
      recipeShards: [],
      iconSheets: [],
      specialDataShards: [specialDescriptor],
      totals: {
        searchableEntries: 1,
        recipes: 0,
        specialRecords: 1,
        assets: recordPages.length,
        offlineBytes: [...assetValues].reduce((total, candidate) => total + candidate.bytesValue.byteLength, 0)
      }
    };
    const baseUrl = 'https://shared-fixture.test/';
    vi.stubGlobal('document', { baseURI: baseUrl });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${baseUrl}versions.json`) {
        return response(url, JSON.stringify({ schemaVersion: 1, versions: [{ datasetId, gtnhVersion: 'fixture', revision: 'shared', packManifestUrl: 'packs/manifest.json' }] }), 'application/json');
      }
      if (url === `${baseUrl}packs/manifest.json`) return response(url, JSON.stringify(manifest), 'application/json');
      const candidate = assetValues.find((value) => new URL(`../../assets/sha256/${value.sha256}`, `${baseUrl}packs/manifest.json`).href === url);
      return candidate
        ? new Response(candidate.bytesValue as unknown as BodyInit, { status: 200 })
        : new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const loadPercents: number[] = [];
    const repository = await DatasetRepository.load(datasetId, ({ percent }) => loadPercents.push(percent));
    expect(loadPercents).toEqual([...loadPercents].sort((left, right) => left - right));
    expect(loadPercents.at(-1)).toBe(100);
    expect(repository.specialViewTypes.map((view) => view.id)).toEqual(['meteor-ritual']);
    expect(repository.offlineBytes).toBe(manifest.totals.offlineBytes);
    const progress: Array<{ loadedShards: number; totalShards: number }> = [];
    await expect(repository.specialFor(goodsId, 'recipes', 'meteor-ritual', (value) => progress.push(value))).resolves.toHaveLength(1);
    expect(progress.at(-1)).toEqual({ loadedShards: 1, totalShards: 1, batch: expect.any(Array) });
    await expect(repository.specialForAll('usages', 'meteor-ritual')).resolves.toHaveLength(1);
    await expect(repository.specialForAll('recipes', 'meteor-ritual')).resolves.toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    await expect(repository.specialForAll('recipes', 'meteor-ritual', undefined, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalled();

    // A version switch can borrow decoded sidecar data from the active
    // repository. Remove the physical source assets to make sure this test is
    // exercising in-memory reuse rather than the SHA-keyed browser cache.
    const specialSegments = (specialDescriptor as typeof specialDescriptor & {
      segments?: Array<[number, number, number]>;
    }).segments;
    const specialPageUrls = new Set(specialSegments?.map(([index]) =>
      new URL(recordPages[index]!.url, `${baseUrl}packs/manifest.json`).href
    ));
    await removeDataset(datasetId);
    fetchMock.mockClear();
    const switched = await DatasetRepository.load(datasetId, undefined, repository);
    await expect(switched.specialFor(goodsId, 'recipes', 'meteor-ritual')).resolves.toHaveLength(1);
    const assetUrls = new Set(assetValues.map((value) =>
      new URL(`../../assets/sha256/${value.sha256}`, `${baseUrl}packs/manifest.json`).href
    ));
    expect(fetchMock.mock.calls.some(([input]) => assetUrls.has(String(input)))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => specialPageUrls.has(String(input)))).toBe(false);
    expect(await getDataset(datasetId)).toMatchObject({ assetHashes: [] });
  });
});
