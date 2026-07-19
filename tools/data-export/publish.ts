#!/usr/bin/env node
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import { verifyPack } from '../pack-builder/verifier';
import {
  argumentsMap,
  assertPathMissing,
  requiredArgument,
  withPublishedVersion,
  type VersionsIndex
} from './lib';

const args = argumentsMap(process.argv.slice(2));
const repositoryRoot = process.cwd();
const packDirectory = resolve(requiredArgument(args, 'pack'));
const manifest = JSON.parse(
  await readFile(join(packDirectory, 'pack-manifest.json'), 'utf8')
) as GeneratedPackManifest;
await verifyPack({ packDirectory });

const publicData = join(repositoryRoot, 'public/data');
const destination = join(publicData, manifest.datasetId);
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

const versionsPath = join(repositoryRoot, 'public/versions.json');
const versions = JSON.parse(await readFile(versionsPath, 'utf8')) as VersionsIndex;
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
console.log(JSON.stringify({
  datasetId: manifest.datasetId,
  destination,
  versions: next.versions.map((version) => version.datasetId)
}, null, 2));
