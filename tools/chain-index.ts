import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decode, encode } from '@msgpack/msgpack';
import { readLogicalAsset } from './pack-builder/recordPages';
import { expandRelations } from '../src/lib/packedRelations';
import { validateChainGraph, type ChainGraph } from '../src/lib/recipeChain';
import type {
  PackedRecipe,
  PackedIngredientGroupsShard,
  PackedCatalogGoods,
} from '../src/lib/datasetSchema';
import type { GeneratedPackManifest, ImmutableAsset } from './pack-builder/manifest';

type ChainDescriptor = {
  id: string;
  bytes: number;
  sha256: string;
  url: string;
  encoding: 'gzip';
  manifestSha256: string;
  recipes: number;
  nodes: number;
};
interface ChainIndexes {
  schemaVersion: 1;
  indexes: Record<string, ChainDescriptor>;
}
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export async function ensureChainIndex(
  root: string,
  manifest: GeneratedPackManifest,
): Promise<ChainDescriptor> {
  const path = join(root, 'recipe-chain-index.json');
  let registry: ChainIndexes;
  try {
    registry = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    registry = { schemaVersion: 1, indexes: {} };
  }
  if (registry.schemaVersion !== 1 || !registry.indexes)
    throw new Error('Invalid chain index registry');
  const cached = registry.indexes[manifest.datasetId];
  if (cached?.manifestSha256 === digest(JSON.stringify(manifest))) {
    try {
      const bytes = await readFile(resolve(root, cached.url));
      if (bytes.length === cached.bytes && digest(bytes) === cached.sha256) return cached;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const manifestSha256 = digest(JSON.stringify(manifest));
  const ids: string[] = [];
  const byId = new Map<string, number>();
  const add = (id: string) => {
    let index = byId.get(id);
    if (index === undefined) {
      index = ids.length;
      ids.push(id);
      byId.set(id, index);
    }
    return index;
  };
  const read = async (asset: ImmutableAsset) =>
    decode(await readLogicalAsset(asset, manifest, join(root, 'assets/sha256')));
  for (const asset of manifest.catalogAssets.filter((asset) => asset.role === 'goods')) {
    const value = (await read(asset)) as PackedCatalogGoods;
    for (const goods of value.goods) add(goods.id);
  }
  const groups: ChainGraph['groups'] = [];
  for (const asset of manifest.ingredientGroupShards) {
    const value = (await read(asset)) as PackedIngredientGroupsShard;
    for (const group of expandRelations(value.ingredientGroups, value.lists))
      groups.push([
        add(group.id),
        group.itemIds.map((id) => {
          const member = byId.get(id);
          if (member === undefined) throw new Error(`Unknown member ${id}`);
          return member;
        }),
      ]);
  }
  const recipes: ChainGraph['recipes'] = [];
  const seen = new Set<string>();
  for (const [shard, asset] of manifest.recipeShards.entries()) {
    const value = (await read(asset)) as { recipes: PackedRecipe[]; logicalId: string };
    if (value.logicalId !== asset.logicalId || value.recipes.length !== asset.recipeCount)
      throw new Error('Recipe shard mismatch');
    const nodes = (ios: PackedRecipe['inputs']) => [
      ...new Set(
        ios.map((io) => {
          const id = byId.get(io.goodsId);
          if (id === undefined) throw new Error(`Unknown recipe node ${io.goodsId}`);
          return id;
        }),
      ),
    ];
    value.recipes.forEach((recipe, record) => {
      if (
        [...recipe.inputs, ...recipe.outputs].some(
          (io) =>
            !Number.isFinite(io.amount) ||
            io.amount < 0 ||
            !Number.isFinite(io.probability) ||
            io.probability < 0 ||
            io.probability > 1,
        )
      )
        throw new Error('Invalid recipe quantity/probability');
      if (seen.has(recipe.id)) throw new Error('Duplicate recipe');
      seen.add(recipe.id);
      recipes.push([
        shard,
        record,
        nodes(recipe.inputs.filter((io) => io.amount > 0)),
        nodes(recipe.outputs.filter((io) => io.amount > 0 && io.probability > 0)),
        nodes(recipe.inputs.filter((io) => io.amount === 0)),
      ]);
    });
  }
  if (seen.size !== manifest.totals.recipes) throw new Error('Incomplete chain index');
  const graph: ChainGraph = {
    schemaVersion: 1,
    datasetId: manifest.datasetId,
    manifestSha256,
    ids,
    groups,
    shards: manifest.recipeShards.map((asset) => asset.id),
    recipes,
  };
  validateChainGraph(graph, manifest.datasetId, manifestSha256);
  const bytes = gzipSync(encode(graph), { level: 9 });
  const sha256 = digest(bytes);
  const url = `./assets/recipe-chains/${sha256}`;
  const output = resolve(root, url);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  const descriptor: ChainDescriptor = {
    id: 'recipe-chain-index',
    bytes: bytes.length,
    sha256,
    url,
    encoding: 'gzip',
    manifestSha256,
    recipes: recipes.length,
    nodes: ids.length,
  };
  registry.indexes[manifest.datasetId] = descriptor;
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(registry, null, 2) + '\n');
  await rename(temporary, path);
  console.log(
    JSON.stringify({
      datasetId: manifest.datasetId,
      bytes: bytes.length,
      recipes: recipes.length,
      nodes: ids.length,
      sha256,
    }),
  );
  return descriptor;
}

export async function pruneChainIndexes(
  root: string,
  retainedIds: readonly string[],
): Promise<void> {
  const path = join(root, 'recipe-chain-index.json');
  const registry = JSON.parse(await readFile(path, 'utf8')) as ChainIndexes;
  const retained = new Set(retainedIds);
  const removed = Object.entries(registry.indexes)
    .filter(([id]) => !retained.has(id))
    .map(([, asset]) => asset);
  registry.indexes = Object.fromEntries(
    Object.entries(registry.indexes).filter(([id]) => retained.has(id)),
  );
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(registry, null, 2) + '\n');
  await rename(temporary, path);
  const hashes = new Set(Object.values(registry.indexes).map((asset) => asset.sha256));
  for (const asset of removed)
    if (!hashes.has(asset.sha256)) {
      if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid retired chain asset hash');
      const file = resolve(root, asset.url);
      if (file !== resolve(root, 'assets/recipe-chains', asset.sha256))
        throw new Error('Retired chain asset escapes its directory');
      await rm(file, { force: true });
    }
}
