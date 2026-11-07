import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import { readLogicalAsset } from '../pack-builder/recordPages';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import type { PackedGoods } from '../../src/lib/datasetSchema';
import type { OreScene } from '../../src/lib/oreDiagram';

const [snapshotPath, packPath] = process.argv.slice(2);
if (!snapshotPath || !packPath) throw new Error('Usage: tsx tools/machine-ui-export/build-ore-diagrams.ts <runtime-snapshot> <published-pack>');
const bytes = await readFile(`${packPath}/pack-manifest.json`);
const manifest = JSON.parse(bytes.toString()) as GeneratedPackManifest;
if (manifest.datasetId !== '2.9.0-v7-rbd0b48ae8ad7') throw new Error('Native diagrams are pinned to the validated GTNH 2.9.0 export');
const store = 'public/assets/sha256';
const goods = new Map<string, PackedGoods>();
for (const asset of manifest.catalogAssets.filter(asset => asset.role === 'goods')) {
  const catalog = decode(await readLogicalAsset(asset, manifest, store)) as { goods: PackedGoods[] };
  for (const item of catalog.goods) goods.set(item.id, item);
}
const snapshotBytes = await readFile(snapshotPath);
const raw = (JSON.parse(snapshotBytes.toString()) as { error?: string; oreDiagrams: {
  schemaVersion: number; icon: string; scenes: Record<string, OreScene>;
  matches: { CRAFTING: Record<string, string[]>; USAGE: Record<string, string[]> }
} });
if (raw.error || raw.oreDiagrams.schemaVersion !== 1 || Object.keys(raw.oreDiagrams.scenes).length !== 331) throw new Error('Incomplete native diagram snapshot');
const fluidIds = [...goods.keys()].filter(id => id.startsWith('f:'));
function canonical(id: string, required = true): string {
  if (id.startsWith('fluid:')) {
    const name = id.slice(6);
    const matches = fluidIds.filter(value => value.slice(value.indexOf(':', 2) + 1) === name);
    if (matches.length !== 1) throw new Error(`Ambiguous native fluid ${id}`);
    return matches[0]!;
  }
  if (!required || goods.has(id)) return id;
  const emptyNbt = `${id}:bf21a9e8fbc5a3846fb05b4fa0859e0917b2202f`;
  if (goods.has(emptyNbt)) return emptyNbt;
  throw new Error(`Native diagram references unpublished goods ${id}`);
}
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const hashMap = new Map<string, string>();
const scenes: Record<string, OreScene> = {};
for (const [oldId, value] of Object.entries(raw.oreDiagrams.scenes).sort()) {
  const scene: OreScene = { ...value,
    groups: value.groups.map(group => ({ ...group, components: group.components.map(component => ({ ...component, id: canonical(component.id) })) })),
    labels: value.labels.map(label => ({ ...label, id: canonical(label.id) })) };
  for (const path of scene.paths) if (path.a[0] !== path.b[0] && path.a[1] !== path.b[1]) throw new Error('Non-native diagonal path');
  const id = sha(Buffer.from(JSON.stringify(scene))); hashMap.set(oldId, id); scenes[id] = scene;
}
function remapMatches(matches: Record<string, string[]>) {
  const result: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(matches).sort()) {
    const key = canonical(id, false);
    result[key] = [...new Set([...(result[key] ?? []), ...list.map(old => {
      const mapped = hashMap.get(old); if (!mapped) throw new Error('Matcher references absent native diagram'); return mapped;
    })])].sort();
  }
  return result;
}
const assets: Array<{ sha256: string; bytes: number }> = [];
async function writeAsset(value: unknown) {
  const content = gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
  const descriptor = { sha256: sha(content), bytes: content.length };
  try { await writeFile(`${store}/${descriptor.sha256}`, content, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || sha(await readFile(`${store}/${descriptor.sha256}`)) !== descriptor.sha256) throw error;
  }
  assets.push(descriptor); return descriptor;
}
const scenesAsset = await writeAsset({ schemaVersion: 1, datasetId: manifest.datasetId, scenes });
const sceneIds = Object.keys(scenes).sort();
const lists: number[][] = [];
const listIds = new Map<string, number>();
function compactMatches(matches: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(remapMatches(matches)).map(([key, value]) => {
    const indices = value.map(id => sceneIds.indexOf(id));
    const signature = indices.join(',');
    let id = listIds.get(signature);
    if (id === undefined) { id = lists.length; lists.push(indices); listIds.set(signature, id); }
    return [key, id];
  }));
}
const matches = { recipes: compactMatches(raw.oreDiagrams.matches.CRAFTING), usages: compactMatches(raw.oreDiagrams.matches.USAGE) };
const index = await writeAsset({ schemaVersion: 1, datasetId: manifest.datasetId, scenes: scenesAsset,
  iconId: canonical(raw.oreDiagrams.icon), sceneIds, lists, matches });
await writeFile('src/lib/generated/ore-diagrams.json', JSON.stringify({ schemaVersion: 1, releases: { [manifest.datasetId]: index } }) + '\n');
await mkdir('assets/source/ore-diagrams', { recursive: true });
await writeFile('assets/source/ore-diagrams/provenance.json', JSON.stringify({
  datasetId: manifest.datasetId, baseManifestSha256: sha(bytes), runtimeSnapshotSha256: sha(snapshotBytes),
  generator: 'NEI Custom Diagram 1.8.36', sourceCommit: '042a8c7f643b26e2645252ef58dea9bdf41a34c6',
  diagrams: Object.keys(scenes).length, assets, index
}, null, 2) + '\n');
console.log(JSON.stringify({ scenes: Object.keys(scenes).length, assets, immutablePackUnchanged: true }));
