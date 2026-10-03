import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetRepository } from '../src/lib/dataset';
import { getCachedMetadata, getDataset, removeDataset, saveDataset } from '../src/lib/storage';
import { sharedPrefixLayoutFingerprint } from '../tools/pack-builder/sharedLayout';
import { buildRecordPages } from '../tools/pack-builder/recordPages';
import { recordPageSelections } from '../src/lib/recordPages';

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
      schemaVersion: 6,
      kind: 'core',
      logicalId: 'catalog-core',
      serviceItemIds: [],
      recipeTypes: [],
      oreDictionaries: [],
      ingredientGroups: [{ id: 'o:fixture', itemIds: [] }]
    });
    const recipeTypeId = 'recipe:type';
    const recipeTypes = await asset('catalog-recipe-types', { schemaVersion: 6, kind: 'recipeTypes', logicalId: 'catalog-recipe-types',
      recipeTypes: [{ id: recipeTypeId, name: 'Fixture machine', order: 0, shapeless: true,
        dimensions: {}, defaultCrafter: null, singleblocks: [], multiblocks: [] }] });
    const recipeRemaps = await asset('catalog-recipe-remaps', { schemaVersion: 6, kind: 'recipeRemaps', logicalId: 'catalog-recipe-remaps', obsoleteRecipeRemaps: {} });
    const specialMetadata = await asset('catalog-special-metadata', {
      schemaVersion: 6,
      kind: 'specialMetadata',
      logicalId: 'catalog-special-metadata',
      specialViewTypes: [{ id: 'meteor-ritual', label: 'Meteor Rituals', serviceIconId: 'service:meteor', recordCount: 1 }],
      specialServiceIcons: [{ id: 'service:meteor', label: 'Meteor', searchable: false, icon: null }]
    });
    const goods = await asset('catalog-goods-root', {
      schemaVersion: 6,
      kind: 'goods',
      logicalId: 'catalog-goods-root',
      prefix: '',
      goods: [{
        id: goodsId,
        name: 'Shared Fixture',
        searchable: true,
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
    const search = await asset('catalog-goods-search-root', {
      schemaVersion: 6, kind: 'goodsSearch', logicalId: 'catalog-goods-search-root', prefix: '',
      goods: [{ id: goodsId, tooltipId: null }], tooltips: []
    });
    const metadata = await asset('goods-details-root', {
      schemaVersion: 6,
      kind: 'goodsDetails',
      logicalId: 'goods-details-root',
      prefix: '',
      goods: [{
        id: goodsId,
        name: 'Shared Fixture',
        tooltip: null,
        unlocalizedName: 'fixture.shared',
        searchMask: [],
        searchable: true,
        numericId: 1,
        productionShards: ['recipe-root'],
        usageShards: ['recipe-root'],
        productionCount: 1,
        usageCount: 1,
        machineCapabilities: [{ recipeTypeId, recipeTypeName: 'Fixture machine', recipeShards: ['recipe-root'] }],
        specialProductionShards: ['special-meteor-ritual-root'],
        specialUsageShards: ['special-meteor-ritual-root'],
        specialProductionLookupIds: ['shared:recipes'],
        specialUsageLookupIds: ['shared:usages'],
        specialProductionCount: 1,
        specialUsageCount: 1,
        productionMatchIds: [goodsId], usageMatchIds: [goodsId],
        specialProductionMatchIds: [goodsId], specialUsageMatchIds: [goodsId]
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
    const group = await asset('ingredient-groups-root', {
      schemaVersion: 6, kind: 'ingredientGroups', logicalId: 'ingredient-groups-root', prefix: '',
      ingredientGroups: [{ id: 'o:fixture', itemIds: [goodsId], productionShards: ['recipe-root'], usageShards: ['recipe-root'] }]
    });
    const recipe = await asset('recipe-root', {
      schemaVersion: 5, kind: 'recipeShard', logicalId: 'recipe-root', prefix: '', recipeTypeId,
      recipes: [{ id: 'recipe:fixture', recipeTypeId, gt: null,
        inputs: [{ kind: 'oreDict', goodsId: 'o:fixture', amount: 1, slot: 0 }],
        outputs: [{ kind: 'item', goodsId, amount: 1, slot: 0 }] }]
    });
    const descriptors = [
      { ...core, kind: 'catalog', role: 'core', part: 0, goodsCount: 0, logicalId: core.id },
      { ...recipeTypes, kind: 'catalog', role: 'recipeTypes', part: 0, goodsCount: 0, logicalId: recipeTypes.id },
      { ...recipeRemaps, kind: 'catalog', role: 'recipeRemaps', part: 0, goodsCount: 0, logicalId: recipeRemaps.id },
      { ...specialMetadata, kind: 'catalog', role: 'specialMetadata', part: 0, goodsCount: 0, logicalId: specialMetadata.id },
      { ...goods, kind: 'catalog', role: 'goods', part: 0, goodsCount: 1, logicalId: goods.id, prefix: '' },
      { ...search, kind: 'catalog', role: 'goodsSearch', part: 0, goodsCount: 0, logicalId: search.id, prefix: '' }
    ].map((descriptor) => ({ ...descriptor, family: 'bootstrap' as const }));
    const detailDescriptor = { ...metadata, family: 'goods-details' as const, kind: 'goodsDetails', part: 0,
      recordCount: 1, logicalId: metadata.id, prefix: '' };
    const groupDescriptor = { ...group, family: 'ingredient-groups' as const, kind: 'ingredientGroups', part: 0,
      recordCount: 1, logicalId: group.id, prefix: '' };
    const recipeDescriptor = { ...recipe, family: 'recipes' as const, kind: 'recipeShard', part: 0,
      recipeCount: 1, recipeTypeOrder: 0, recipeTypeId, logicalId: recipe.id, prefix: '' };
    const targets = { recipes: 1024, goods: 1024, goodsMetadata: 1024, special: 1024, oreDictionaries: 1024 };
    const prefixes = { recipeTypes: { [recipeTypeId]: [''] }, goods: [''], oreDictionaries: [''], specialViews: { 'meteor-ritual': [''] } };
    const specialDescriptor = { ...special, family: 'special' as const, kind: 'specialData', specialViewTypeId: 'meteor-ritual', specialViewTypeOrder: 0, part: 0, recordCount: 1, logicalId: special.id, prefix: '' };
    const recordPages = await buildRecordPages(
      [...descriptors, detailDescriptor, groupDescriptor, recipeDescriptor, specialDescriptor],
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
      formatVersion: 7,
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
      recipeShards: [recipeDescriptor],
      goodsDetailShards: [detailDescriptor],
      ingredientGroupShards: [groupDescriptor],
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
      if (url === `${baseUrl}versions-v7.json`) {
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
    const pageUrls = (family: string) => new Set(recordPages.filter((page) => page.family === family)
      .map((page) => new URL(page.url, `${baseUrl}packs/manifest.json`).href));
    const lazyUrls = new Set([...pageUrls('goods-details'), ...pageUrls('ingredient-groups'),
      ...pageUrls('recipes'), ...pageUrls('special')]);
    expect(fetchMock.mock.calls.some(([url]) => lazyUrls.has(String(url)))).toBe(false);
    expect(repository.entries[0]?.specialProductionShards).toBeUndefined();
    const abortedDetail = new AbortController();
    abortedDetail.abort();
    await expect(repository.entryFor(goodsId, abortedDetail.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls.some(([url]) => lazyUrls.has(String(url)))).toBe(false);
    let releaseDetail!: () => void;
    const detailGate = new Promise<void>((resolve) => { releaseDetail = resolve; });
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input) => {
      if (pageUrls('goods-details').has(String(input))) await detailGate;
      return originalFetch(input);
    });
    const navigation = new AbortController();
    const pendingDetail = repository.entryFor(goodsId, navigation.signal);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => pageUrls('goods-details').has(String(url)))).toBe(true));
    navigation.abort();
    await expect(pendingDetail).rejects.toMatchObject({ name: 'AbortError' });
    releaseDetail();
    fetchMock.mockImplementation(originalFetch);
    const hydrated = await repository.entryFor(goodsId);
    expect(hydrated?.specialProductionShards).toEqual(['special-meteor-ritual-root']);
    expect(repository.entries[0]?.specialProductionShards).toBeUndefined();
    fetchMock.mockClear();
    expect(await repository.entryFor(goodsId)).toBe(hydrated);
    expect(fetchMock).not.toHaveBeenCalled();
    const cached = (await getDataset(datasetId))!;
    const legacyId = 'fixture-v6';
    const otherLegacyId = 'other-version-v6';
    await saveDataset({ ...cached, datasetId: legacyId, cacheVersion: 2 });
    await saveDataset({ ...cached, datasetId: otherLegacyId, gtnhVersion: 'other-version', cacheVersion: 2 });
    const warm = await DatasetRepository.load(datasetId);
    expect(await getDataset(legacyId)).toBeNull();
    expect(await getDataset(otherLegacyId)).not.toBeNull();
    await removeDataset(otherLegacyId);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/assets/sha256/'))).toBe(false);
    expect(warm.entries[0]?.specialProductionShards).toBeUndefined();
    expect((await repository.recipesFor(goodsId, 'recipes'))[0]?.inputs[0]?.alternatives).toEqual([goodsId]);
    expect(await repository.recipesFor(goodsId, 'machineUsages')).toHaveLength(1);
    expect((await repository.entryFor('o:fixture'))?.members).toEqual([goodsId]);
    expect(repository.entries.find((entry) => entry.id === 'o:fixture')?.members).toBeUndefined();
    const installed = await repository.installOffline();
    expect(installed.status).toBe('complete');
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
    const specialSegments = recordPageSelections(specialDescriptor as typeof specialDescriptor & { segments?: string });
    const specialPageUrls = new Set(specialSegments.map(([index]) =>
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

    // A rollout outage must retain the active dataset and leave the epoch pending.
    await switched.activate();
    const rolloutId = 'fixture-rc';
    let targetAvailable = false;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === `${baseUrl}versions-v7.json`) {
        return response(url, JSON.stringify({ schemaVersion: 1,
          rollout: { epoch: 2, targetDatasetId: rolloutId },
          versions: [
            { datasetId: rolloutId, gtnhVersion: 'fixture-rc', revision: 'rc', packManifestUrl: 'packs/rc.json' },
            { datasetId, gtnhVersion: 'fixture', revision: 'shared', packManifestUrl: 'packs/manifest.json' }
          ] }), 'application/json');
      }
      if (url === `${baseUrl}packs/rc.json`) {
        return targetAvailable
          ? response(url, JSON.stringify({ ...manifest, datasetId: rolloutId, gtnhVersion: 'fixture-rc' }), 'application/json')
          : new Response('unavailable', { status: 503 });
      }
      return originalFetch(input);
    });
    const deferred = await DatasetRepository.load(datasetId, undefined, switched, true);
    expect(deferred.datasetId).toBe(datasetId);
    await deferred.activate();
    expect(await getCachedMetadata('dataset-rollout-epoch')).toBeNull();
    expect(await getDataset(datasetId)).toMatchObject({ active: true });
    expect(await getDataset(rolloutId)).toBeNull();
    targetAvailable = true;
    const migrated = await DatasetRepository.load(datasetId, undefined, switched, true);
    expect(migrated.datasetId).toBe(rolloutId);
    expect(await getCachedMetadata('dataset-rollout-epoch')).toBeNull();
    await migrated.activate();
    expect(await getCachedMetadata('dataset-rollout-epoch')).toMatchObject({ value: 2 });
    const manual = await DatasetRepository.load(datasetId);
    await manual.activate();
    expect((await DatasetRepository.load(datasetId, undefined, manual, true)).datasetId).toBe(datasetId);

  });
});
