#!/usr/bin/env node
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import { verifyPack } from '../pack-builder/verifier';
import {
  argumentsMap,
  assertPathMissing,
  directoryDigest,
  requiredArgument,
  withPublishedVersion,
  type VersionsIndex
} from './lib';

const args = argumentsMap(process.argv.slice(2));
const repositoryRoot = process.cwd();
const packDirectory = resolve(requiredArgument(args, 'pack'));
const mode = args.get('mode') ?? 'publish';
if (mode !== 'stage' && mode !== 'activate' && mode !== 'publish') {
  throw new Error(`Unsupported publish mode ${mode}; expected stage, activate, or publish`);
}
const manifest = JSON.parse(
  await readFile(join(packDirectory, 'pack-manifest.json'), 'utf8')
) as GeneratedPackManifest;
await verifyPack({ packDirectory });

const publicData = join(repositoryRoot, 'public/data');
const destination = join(publicData, manifest.datasetId);
if (mode === 'stage' || mode === 'publish') {
  await assertPathMissing(destination, 'Published dataset');
  const staging = join(publicData, `.${manifest.datasetId}.staging-${process.pid}`);
  await assertPathMissing(staging, 'Publish staging directory');
  await mkdir(staging, { recursive: true });
  try {
    await cp(packDirectory, staging, { recursive: true });
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
} else {
  await access(join(destination, 'pack-manifest.json'));
  const sourceDigest = await directoryDigest(packDirectory);
  const stagedDigest = await directoryDigest(destination);
  if (sourceDigest !== stagedDigest) {
    throw new Error(`Staged dataset digest ${stagedDigest} does not match source ${sourceDigest}`);
  }
  await verifyPack({ packDirectory: destination });
}

if (mode === 'stage') {
  console.log(JSON.stringify({ datasetId: manifest.datasetId, destination, staged: true }, null, 2));
  process.exit(0);
}

const versionsPath = join(repositoryRoot, 'public/versions.json');
const versions = JSON.parse(await readFile(versionsPath, 'utf8')) as VersionsIndex;
const replacedDatasetIds = mode === 'activate'
  ? versions.versions
    .filter((candidate) => candidate.gtnhVersion === manifest.gtnhVersion
      && candidate.datasetId !== manifest.datasetId)
    .map((candidate) => candidate.datasetId)
  : [];
const now = new Date().toISOString();
const next = withPublishedVersion(versions, {
  datasetId: manifest.datasetId,
  gtnhVersion: manifest.gtnhVersion,
  revision: manifest.revision,
  publishedAt: now,
  packManifestUrl: `./data/${basename(destination)}/pack-manifest.json`,
  catalogBytes: manifest.catalogAssets.reduce((total, asset) => total + asset.bytes, 0),
  offlineBytes: manifest.totals.offlineBytes
}, now);
const temporaryVersions = `${versionsPath}.tmp-${process.pid}`;
await writeFile(temporaryVersions, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
await rename(temporaryVersions, versionsPath);
for (const datasetId of replacedDatasetIds) {
  // A replacement release is immutable while staged, then the superseded
  // revision is removed only after the new version index is atomically active.
  // Dataset IDs come from the validated index and are joined beneath public/data.
  await rm(join(publicData, datasetId), { recursive: true, force: true });
}
console.log(JSON.stringify({
  datasetId: manifest.datasetId,
  destination,
  versions: next.versions.map((version) => version.datasetId),
  removedDatasets: replacedDatasetIds
}, null, 2));
