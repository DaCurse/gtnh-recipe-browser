import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPack } from '../tools/pack-builder/verifier';

const temporaryPacks: string[] = [];

async function writeAsset(
  root: string,
  id: string,
  value: unknown
): Promise<{
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'gzip';
  } & Record<string, unknown>> {
  const bytes = gzipSync(encode(value), { level: 9 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const filename = `${id}.${sha256.slice(0, 16)}.mpk`;
  await writeFile(join(root, 'assets', filename), bytes);
  return {
    id,
    url: `./assets/${filename}`,
    bytes: bytes.byteLength,
    sha256,
    encoding: 'gzip'
  };
}

async function createLegacyPack(formatVersion: 1 | 2 | 3): Promise<string> {
  const root = await mkdtemp('/tmp/gtnh-pack-compat-');
  temporaryPacks.push(root);
  await mkdir(join(root, 'assets'));
  const datasetId = `legacy-format-${formatVersion}`;
  const goods = [{ id: 'i:fixture:test', name: 'Fixture', searchable: true }];
  const catalogAssets = formatVersion === 1
    ? [{
      ...(await writeAsset(root, 'catalog', {
        schemaVersion: 1,
        datasetId,
        goods
      }))
    }]
    : [
      {
        ...(await writeAsset(root, 'catalog-core', {
          schemaVersion: formatVersion,
          datasetId,
          kind: 'core',
          recipeTypes: [],
          oreDictionaries: [],
          ingredientGroups: []
        })),
        kind: 'catalog',
        role: 'core',
        part: 0,
        goodsCount: 0
      },
      {
        ...(await writeAsset(root, 'catalog-goods', {
          schemaVersion: formatVersion,
          datasetId,
          kind: 'goods',
          part: 0,
          goods
        })),
        kind: 'catalog',
        role: 'goods',
        part: 0,
        goodsCount: goods.length
      }
    ];
  const manifest = {
    formatVersion,
    datasetId,
    gtnhVersion: 'fixture',
    revision: `r${formatVersion}`,
    displayName: `Legacy ${formatVersion}`,
    source: { formatVersion: 5, dataSha256: 'fixture', atlasSha256: 'fixture' },
    catalogAssets,
    recipeShards: [],
    iconSheets: [],
    totals: {
      searchableEntries: 1,
      recipes: 0,
      assets: catalogAssets.length,
      offlineBytes: catalogAssets.reduce((total, asset) => total + asset.bytes, 0)
    }
  };
  await writeFile(join(root, 'pack-manifest.json'), `${JSON.stringify(manifest)}\n`);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryPacks.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('legacy generated pack compatibility', () => {
  it.each([1, 2, 3] as const)('verifies format-%i packs without special assets', async (formatVersion) => {
    const root = await createLegacyPack(formatVersion);
    await expect(verifyPack({ packDirectory: root })).resolves.toMatchObject({
      assets: formatVersion === 1 ? 1 : 2,
      goods: 1,
      recipes: 0,
      spriteSamples: 0
    });
  });
});
