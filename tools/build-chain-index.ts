import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ensureChainIndex, pruneChainIndexes } from './chain-index';
import type { GeneratedPackManifest } from './pack-builder/manifest';
const root=resolve(process.argv[2] ?? 'public');
const versions=JSON.parse(await readFile(join(root,'versions-v7.json'),'utf8')) as {versions:Array<{datasetId:string;packManifestUrl:string}>};
for(const version of versions.versions) {
  const manifest=JSON.parse(await readFile(resolve(root,version.packManifestUrl),'utf8')) as GeneratedPackManifest;
  await ensureChainIndex(root,manifest);
}
await pruneChainIndexes(root,versions.versions.map(version=>version.datasetId));
