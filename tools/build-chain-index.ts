import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decode, encode } from '@msgpack/msgpack';
import { readLogicalAsset } from './pack-builder/recordPages';
import { expandRelations } from '../src/lib/packedRelations';
import { validateChainGraph, type ChainGraph } from '../src/lib/recipeChain';
import type { PackedRecipe, PackedIngredientGroupsShard, PackedCatalogGoods } from '../src/lib/datasetSchema';
import type { GeneratedPackManifest, ImmutableAsset } from './pack-builder/manifest';

const root = resolve(process.argv[2] ?? 'public');
const versions = JSON.parse(await readFile(join(root, 'versions-v7.json'), 'utf8'));
const indexes: Record<string, unknown> = {};
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
for (const version of versions.versions) {
  const manifestPath = resolve(root, version.packManifestUrl);
  const manifest: GeneratedPackManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestSha256 = digest(JSON.stringify(manifest));
  const ids: string[] = []; const byId = new Map<string, number>();
  const add = (id: string) => { let index = byId.get(id); if (index === undefined) { index = ids.length; ids.push(id); byId.set(id, index); } return index; };
  const read = async (asset: ImmutableAsset) => decode(await readLogicalAsset(asset, manifest, join(root, 'assets/sha256')));
  for (const asset of manifest.catalogAssets.filter((asset) => asset.role === 'goods')) {
    const value = await read(asset) as PackedCatalogGoods;
    for (const goods of value.goods) add(goods.id);
  }
  const groups: ChainGraph['groups'] = [];
  for (const asset of manifest.ingredientGroupShards) {
    const value = await read(asset) as PackedIngredientGroupsShard;
    for (const group of expandRelations(value.ingredientGroups, value.lists)) groups.push([add(group.id), group.itemIds.map((id) => {
      const member = byId.get(id); if (member === undefined) throw new Error(`Unknown member ${id}`); return member;
    })]);
  }
  const recipes: ChainGraph['recipes'] = [];
  const seen = new Set<string>();
  for (const [shard, asset] of manifest.recipeShards.entries()) {
    const value = await read(asset) as { recipes: PackedRecipe[]; logicalId: string };
    if (value.logicalId !== asset.logicalId || value.recipes.length !== asset.recipeCount) throw new Error('Recipe shard mismatch');
    const nodes = (ios: PackedRecipe['inputs']) => [...new Set(ios.map((io) => {
      const id = byId.get(io.goodsId); if (id === undefined) throw new Error(`Unknown recipe node ${io.goodsId}`); return id;
    }))];
    value.recipes.forEach((recipe, record) => {
      if ([...recipe.inputs, ...recipe.outputs].some((io) => !Number.isFinite(io.amount) || io.amount < 0 || !Number.isFinite(io.probability) || io.probability < 0 || io.probability > 1)) throw new Error('Invalid recipe quantity/probability');
      if (seen.has(recipe.id)) throw new Error('Duplicate recipe'); seen.add(recipe.id);
      recipes.push([shard, record, nodes(recipe.inputs.filter((io) => io.amount > 0)),
        nodes(recipe.outputs.filter((io) => io.amount > 0 && io.probability > 0)), nodes(recipe.inputs.filter((io) => io.amount === 0))]);
    });
  }
  if (seen.size !== manifest.totals.recipes) throw new Error('Incomplete chain index');
  const graph: ChainGraph = { schemaVersion: 1, datasetId: manifest.datasetId, manifestSha256, ids, groups, shards: manifest.recipeShards.map((asset) => asset.id), recipes };
  validateChainGraph(graph, manifest.datasetId, manifestSha256);
  const bytes = gzipSync(encode(graph), { level: 9 }); const sha256 = digest(bytes);
  const url = `./assets/recipe-chains/${sha256}`;
  const output = resolve(root, url); await mkdir(dirname(output), { recursive: true }); await writeFile(output, bytes);
  indexes[manifest.datasetId] = { id: 'recipe-chain-index', bytes: bytes.length, sha256, url, encoding: 'gzip', manifestSha256, recipes: recipes.length, nodes: ids.length };
  console.log(JSON.stringify({ datasetId: manifest.datasetId, bytes: bytes.length, recipes: recipes.length, nodes: ids.length, sha256 }));
}
await writeFile(join(root, 'recipe-chain-index.json'), JSON.stringify({ schemaVersion: 1, indexes }, null, 2) + '\n');
