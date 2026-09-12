import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPack } from '../tools/pack-builder/verifier';
import { buildRecordPages } from '../tools/pack-builder/recordPages';

const temporaryPacks: string[] = [];

async function createSharedPack(): Promise<string> {
  const root = await mkdtemp('/tmp/gtnh-pack-shared-');
  temporaryPacks.push(root);
  await mkdir(join(root, 'assets', 'sha256'), { recursive: true });
  const datasetId = 'shared-format-6';
  const writeSharedAsset = async (value: unknown) => {
    const bytes = gzipSync(encode(value), { level: 9 });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(root, 'assets', 'sha256', sha256), bytes);
    return {
      id: String((value as { logicalId: string }).logicalId),
      url: `../../assets/sha256/${sha256}`,
      bytes: bytes.byteLength,
      sha256,
      encoding: 'gzip' as const,
      mediaType: 'application/msgpack'
    };
  };
  const core = await writeSharedAsset({
    schemaVersion: 5,
    kind: 'core',
    logicalId: 'catalog-core',
    recipeTypes: [],
    oreDictionaries: [],
    ingredientGroups: []
  });
  const goods = await writeSharedAsset({
    schemaVersion: 5,
    kind: 'goods',
    logicalId: 'catalog-goods-root',
    prefix: '',
    goods: [{ id: 'i:fixture:shared', name: 'Shared fixture' }]
  });
  const metadata = await writeSharedAsset({
    schemaVersion: 5,
    kind: 'goodsMetadata',
    logicalId: 'catalog-goods-metadata-root',
    prefix: '',
    goods: [{
      id: 'i:fixture:shared',
      name: 'Shared fixture',
      tooltip: null,
      unlocalizedName: 'fixture.shared',
      searchMask: [],
      searchable: true,
      numericId: 1,
      productionShards: [],
      usageShards: [],
      productionCount: 0,
      usageCount: 0,
      specialProductionShards: [],
      specialUsageShards: [],
      specialProductionLookupIds: [],
      specialUsageLookupIds: [],
      specialProductionCount: 0,
      specialUsageCount: 0
    }]
  });
  const recipeTypes = await writeSharedAsset({
    schemaVersion: 5,
    kind: 'recipeTypes',
    logicalId: 'catalog-recipe-types',
    recipeTypes: []
  });
  const ingredientGroups = await writeSharedAsset({
    schemaVersion: 5,
    kind: 'ingredientGroups',
    logicalId: 'catalog-ingredient-groups',
    ingredientGroups: []
  });
  const recipeRemaps = await writeSharedAsset({
    schemaVersion: 5,
    kind: 'recipeRemaps',
    logicalId: 'catalog-recipe-remaps',
    obsoleteRecipeRemaps: {}
  });
  const specialMetadata = await writeSharedAsset({
    schemaVersion: 5,
    kind: 'specialMetadata',
    logicalId: 'catalog-special-metadata',
    specialViewTypes: [],
    specialServiceIcons: []
  });
  const icons = await writeSharedAsset({ schemaVersion: 5, kind: 'icons', logicalId: 'catalog-icons',
    icons: [{ id: 'i:fixture:shared', icon: null }] });
  const catalogAssets = [
    { ...icons, kind: 'catalog', role: 'icons', part: 0, goodsCount: 0, logicalId: 'catalog-icons' },
    { ...core, kind: 'catalog', role: 'core', part: 0, goodsCount: 0, logicalId: 'catalog-core' },
    { ...recipeTypes, kind: 'catalog', role: 'recipeTypes', part: 0, goodsCount: 0, logicalId: 'catalog-recipe-types' },
    { ...ingredientGroups, kind: 'catalog', role: 'ingredientGroups', part: 0, goodsCount: 0, logicalId: 'catalog-ingredient-groups' },
    { ...recipeRemaps, kind: 'catalog', role: 'recipeRemaps', part: 0, goodsCount: 0, logicalId: 'catalog-recipe-remaps' },
    { ...specialMetadata, kind: 'catalog', role: 'specialMetadata', part: 0, goodsCount: 0, logicalId: 'catalog-special-metadata' },
    { ...goods, kind: 'catalog', role: 'goods', part: 0, goodsCount: 1, logicalId: 'catalog-goods-root', prefix: '' },
    { ...metadata, kind: 'catalog', role: 'goodsMetadata', part: 0, goodsCount: 1, logicalId: 'catalog-goods-metadata-root', prefix: '' }
  ];
  const targets = { recipes: 1024, goods: 1024, goodsMetadata: 1024, special: 1024, oreDictionaries: 1024 };
  const prefixes = { recipeTypes: {}, goods: [''], oreDictionaries: [''], specialViews: {} };
  const layoutBytes = JSON.stringify({ schemaVersion: 1, targets, ...prefixes });
  const recordPages = await buildRecordPages(catalogAssets, join(root, 'assets', 'sha256'), '../..', []);
  const manifest = {
    formatVersion: 6,
    datasetId,
    gtnhVersion: 'fixture',
    revision: 'shared',
    displayName: 'Shared format 6',
    assetStore: 'global-sha256',
    sharedLayout: {
      schemaVersion: 1,
      layoutSha256: createHash('sha256').update(layoutBytes).digest('hex'),
      targets,
      prefixes
    },
    source: { formatVersion: 5, dataSha256: 'fixture', atlasSha256: 'fixture' },
    catalogAssets,
    recordPages,
    recipeShards: [],
    iconSheets: [],
    specialDataShards: [],
    totals: {
      searchableEntries: 1,
      recipes: 0,
      specialRecords: 0,
      assets: recordPages.length,
      offlineBytes: recordPages.reduce((total, asset) => total + asset.bytes, 0)
    }
  };
  await writeFile(join(root, 'pack-manifest.json'), `${JSON.stringify(manifest)}\n`);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryPacks.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('canonical shared generated packs', () => {
  it('verifies manifest membership and full-SHA objects without dataset ownership in blobs', async () => {
    const root = await createSharedPack();
    await expect(verifyPack({ packDirectory: root })).resolves.toMatchObject({
      assets: 1,
      goods: 1,
      recipes: 0,
      bytes: expect.any(Number)
    });
  });
});
