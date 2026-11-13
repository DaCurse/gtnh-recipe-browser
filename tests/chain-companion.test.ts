import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import { describe, it, expect } from 'vitest';
import { validateChainGraph } from '../src/lib/recipeChain';
describe('published chain companions', () => {
  it('provides a verified graph bound to every published recipe manifest', () => {
    const versions = JSON.parse(readFileSync('public/versions-v7.json', 'utf8'));
    const registry = JSON.parse(readFileSync('public/recipe-chain-index.json', 'utf8'));
    expect(Object.keys(registry.indexes).sort()).toEqual(
      versions.versions.map((version: { datasetId: string }) => version.datasetId).sort(),
    );
    for (const version of versions.versions) {
      const manifest = JSON.parse(readFileSync(`public/${version.packManifestUrl}`, 'utf8'));
      const expected = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const asset = registry.indexes[version.datasetId];
      expect(asset.manifestSha256).toBe(expected);
      const bytes = readFileSync(`public/${asset.url}`);
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      const graph = validateChainGraph(decode(gunzipSync(bytes)), version.datasetId, expected);
      expect(graph.recipes).toHaveLength(manifest.totals.recipes);
      expect(graph.shards).toEqual(manifest.recipeShards.map((shard: { id: string }) => shard.id));
    }
  });
});
