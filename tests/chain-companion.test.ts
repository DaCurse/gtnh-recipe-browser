import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import { describe, it, expect } from 'vitest';
import { validateChainGraph } from '../src/lib/finder/recipeChain';
describe('published chain companions', () => {
  it('provides a verified graph bound to every published recipe manifest', () => {
    const versions = JSON.parse(readFileSync('public/versions-v7.json', 'utf8'));
    const registry = JSON.parse(readFileSync('public/recipe-chain-index.json', 'utf8'));
    const onDisk = readdirSync('public/data').filter((id) =>
      existsSync(`public/data/${id}/pack-manifest.json`),
    );
    expect(Object.keys(registry.indexes).sort()).toEqual(onDisk.sort());
    expect(onDisk).toEqual(
      expect.arrayContaining(
        versions.versions.map((version: { datasetId: string }) => version.datasetId),
      ),
    );
    for (const datasetId of onDisk) {
      const manifest = JSON.parse(
        readFileSync(`public/data/${datasetId}/pack-manifest.json`, 'utf8'),
      );
      const expected = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const asset = registry.indexes[datasetId];
      expect(asset.manifestSha256).toBe(expected);
      const bytes = readFileSync(`public/${asset.url}`);
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      const graph = validateChainGraph(decode(gunzipSync(bytes)), datasetId, expected);
      expect(graph.recipes).toHaveLength(manifest.totals.recipes);
      expect(graph.shards).toEqual(manifest.recipeShards.map((shard: { id: string }) => shard.id));
    }
  });
});
