import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { compareCatalogOrder } from '../src/lib/catalogOrder';
import { applyCatalogOrder, catalogOrderAsset } from '../src/lib/catalogOrderIndex';
import { buildCatalogBrowseEntries } from '../src/lib/catalogVariants';
import { buildCatalogOrder } from '../tools/catalog-order';
import type { DecodedRepository } from '../tools/pack-builder/model';
import type { GeneratedPackManifest } from '../tools/pack-builder/manifest';
import type { DatasetManifest } from '../src/lib/datasetSchema';
import type { CatalogEntry } from '../src/lib/types';

const fetchAsset = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/datasetAssets', async original => ({
  ...await original<typeof import('../src/lib/datasetAssets')>(), fetchVerified: fetchAsset
}));
const entry = (id: string, numericId: number, damage = 0): CatalogEntry => ({
  id, numericId, damage, name: id, mod: 'fixture', kind: 'item', color: '#fff', glyph: 'x', tooltip: []
});

describe('numeric catalogue order', () => {
  it('orders registry IDs and metadata numerically and keeps fluid IDs in a separate domain', () => {
    const entries = [entry('i:fixture:high:0', 10), entry('i:fixture:low:10', 2, 10),
      { ...entry('f:fixture:fluid', 0), kind: 'fluid' as const }, entry('i:fixture:low:2', 2, 2)];
    expect(buildCatalogBrowseEntries(entries).map(item => item.id)).toEqual([
      'i:fixture:low:2', 'i:fixture:low:10', 'i:fixture:high:0', 'f:fixture:fluid'
    ]);
    expect(compareCatalogOrder(entry('known', 1), { ...entry('unknown', 0), numericId: undefined })).toBeLessThan(0);
  });
  it('generates deterministic registry-level data and rejects contradictory variants', () => {
    const source = { items: [{ id: 'i:fixture:stone:1', numericId: 1 },
      { id: 'i:fixture:stone:0:nbt', numericId: 1 }], fluids: [] } as unknown as DecodedRepository;
    const manifest = { datasetId: 'fixture', source: { dataSha256: 'source' } } as GeneratedPackManifest;
    const result = buildCatalogOrder(source, manifest);
    expect(JSON.parse(result).registryIds).toEqual({ 'i:fixture:stone': 1 });
    expect(buildCatalogOrder({ ...source, items: [...source.items].reverse() }, manifest)).toBe(result);
    source.items[1]!.numericId = 2;
    expect(() => buildCatalogOrder(source, manifest)).toThrow('Conflicting registry ID');
  });
  it('binds the published companion to the export and puts Stone first without hardcoding an order', async () => {
    const manifest = JSON.parse(await readFile('public/data/2.9.0-v7-r9ec25114d4a7/pack-manifest.json', 'utf8')) as DatasetManifest;
    const url = 'https://example.test/browser/data/2.9.0/pack-manifest.json';
    const asset = catalogOrderAsset(manifest, url)!;
    const bytes = await readFile(`public/assets/sha256/${asset.sha256}`);
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    expect(JSON.parse(gunzipSync(bytes).toString()).sourceDataSha256).toBe(manifest.source?.dataSha256);
    fetchAsset.mockResolvedValue(bytes);
    const items = [entry('i:minecraft:dirt:0', 999), entry('i:minecraft:stone:0', 999)];
    await applyCatalogOrder(items, manifest, url);
    expect(items.sort(compareCatalogOrder).map(item => [item.id, item.numericId])).toEqual([
      ['i:minecraft:stone:0', 1], ['i:minecraft:dirt:0', 3]
    ]);
    expect(asset.url).toBe(`https://example.test/browser/assets/sha256/${asset.sha256}`);
    await expect(applyCatalogOrder(items, { ...manifest, source: { dataSha256: 'wrong' } }, url)).rejects.toThrow('does not match');
  });
});
