import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { verifyPack } from '../tools/pack-builder/verifier';
import { buildRecordPages } from '../tools/pack-builder/recordPages';
import { sharedPrefixLayoutFingerprint } from '../tools/pack-builder/sharedLayout';

describe('canonical format-7 generated packs', () => {
  it('verifies family-isolated pages and rejects a bootstrap/detail boundary violation', async () => {
    const root = await mkdtemp('/tmp/gtnh-pack-v7-');
    try {
      const directory = join(root, 'assets', 'sha256');
      await mkdir(directory, { recursive: true });
      const goodsId = 'i:fixture:shared';
      const values = [
        { kind: 'core', logicalId: 'catalog-core', ingredientGroups: [], serviceItemIds: [] },
        { kind: 'recipeTypes', logicalId: 'catalog-recipe-types', recipeTypes: [] },
        { kind: 'recipeRemaps', logicalId: 'catalog-recipe-remaps', obsoleteRecipeRemaps: {} },
        { kind: 'specialMetadata', logicalId: 'catalog-special-metadata', specialViewTypes: [], specialServiceIcons: [] },
        { kind: 'goods', logicalId: 'catalog-goods-root', prefix: '', goods: [{ id: goodsId, name: 'Shared fixture', icon: null }] },
        { kind: 'goodsSearch', logicalId: 'catalog-goods-search-root', prefix: '', goods: [{ id: goodsId, tooltipId: null }], tooltips: [] },
        { kind: 'goodsDetails', logicalId: 'goods-details-root', prefix: '', goods: [{ id: goodsId, productionShards: [], usageShards: [] }] }
      ];
      const assets = await Promise.all(values.map(async (value) => {
        const bytes = gzipSync(encode({ schemaVersion: 6, ...value }), { level: 9 });
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        await writeFile(join(directory, sha256), bytes);
        return { id: value.logicalId, logicalId: value.logicalId, url: '../../assets/sha256/' + sha256,
          bytes: bytes.length, sha256, encoding: 'gzip' as const, mediaType: 'application/msgpack',
          family: value.kind === 'goodsDetails' ? 'goods-details' as const : 'bootstrap' as const,
          kind: value.kind === 'goodsDetails' ? 'goodsDetails' : 'catalog', role: value.kind, part: 0,
          goodsCount: value.kind === 'goodsSearch' ? 0 : value.goods?.length ?? 0, recordCount: value.goods?.length ?? 0,
          prefix: 'prefix' in value ? value.prefix : undefined };
      }));
      const recordPages = await buildRecordPages(assets, directory, '../..', []);
      const targets = { recipes: 1024, goods: 1024, goodsMetadata: 1024, special: 1024, oreDictionaries: 1024 };
      const prefixes = { recipeTypes: {}, goods: [''], oreDictionaries: [''], specialViews: {} };
      const manifest = { formatVersion: 7, datasetId: 'fixture-v7', gtnhVersion: 'fixture',
        revision: 'shared', displayName: 'Fixture', assetStore: 'global-sha256',
        source: { formatVersion: 5, dataSha256: 'fixture', atlasSha256: 'fixture' },
        sharedLayout: { schemaVersion: 1, targets, prefixes,
          layoutSha256: sharedPrefixLayoutFingerprint({ schemaVersion: 1, targets, ...prefixes }) },
        catalogAssets: assets.filter((asset) => asset.family === 'bootstrap'),
        goodsDetailShards: assets.filter((asset) => asset.family === 'goods-details'),
        ingredientGroupShards: [], recipeShards: [], specialDataShards: [], iconSheets: [], recordPages,
        totals: { assets: recordPages.length, offlineBytes: recordPages.reduce((sum, asset) => sum + asset.bytes, 0),
          searchableEntries: 1, recipes: 0, specialRecords: 0 } };
      const manifestPath = join(root, 'pack-manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(verifyPack({ packDirectory: root })).resolves.toMatchObject({ assets: 2, goods: 1, recipes: 0 });
      manifest.recordPages.find((page) => page.family === 'goods-details')!.family = 'bootstrap';
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(verifyPack({ packDirectory: root })).rejects.toThrow('load-family boundary');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
