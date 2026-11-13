import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { prunePublishedObjects } from './data-export/prune';

const root = process.cwd();
const dataRoot = resolve(root, 'public/data');
const index = JSON.parse(await readFile(join(root, 'public/versions-v7.json'), 'utf8')) as {
  versions: Array<{ datasetId: string }>;
};
const current = new Set(index.versions.map(version => version.datasetId));
const retired: Array<{ id: string; path: string }> = [];
for (const directory of await readdir(dataRoot, { withFileTypes: true })) {
  if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
  const path = resolve(dataRoot, directory.name);
  if (dirname(path) !== dataRoot) throw new Error('Dataset path escapes public/data');
  const manifest = JSON.parse(await readFile(join(path, 'pack-manifest.json'), 'utf8')) as {
    datasetId: string; formatVersion: number;
  };
  if (manifest.formatVersion !== 6) continue;
  if (manifest.datasetId !== directory.name || current.has(manifest.datasetId)) {
    throw new Error(`Refusing to remove an indexed or mismatched dataset: ${directory.name}`);
  }
  retired.push({ id: manifest.datasetId, path });
}
const oldIndex = join(root, 'public/versions.json');
let hasOldIndex = false;
try {
  const value = JSON.parse(await readFile(oldIndex, 'utf8')) as { versions: Array<{ datasetId: string }> };
  if (value.versions.some(version => !retired.some(dataset => dataset.id === version.datasetId))) {
    throw new Error('The old version index still references a non-retired dataset');
  }
  hasOldIndex = true;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
// All resolved targets and both indexes are checked before any deletion.
for (const dataset of retired) await rm(dataset.path, { recursive: true });
if (hasOldIndex) await rm(oldIndex);
const assets = await prunePublishedObjects(root);
console.log(JSON.stringify({ retiredDatasets: retired.map(dataset => dataset.id), removedObjects: assets.count,
  removedBytes: assets.bytes }, null, 2));
