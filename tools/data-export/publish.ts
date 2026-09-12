#!/usr/bin/env node
import { access, copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { GeneratedPackManifest, ImmutableAsset } from '../pack-builder/manifest';
import { verifyPack } from '../pack-builder/verifier';
import {
  assertSharedLayoutExtension,
  type SharedPrefixLayout
} from '../pack-builder/sharedLayout';
import {
  argumentsMap,
  assertPathMissing,
  assertImmutableManifestBytes,
  unreferencedSharedObjectNames,
  requiredArgument,
  withPublishedVersion,
  type VersionsIndex
} from './lib';

const args = argumentsMap(process.argv.slice(2));
const repositoryRoot = process.cwd();
const packDirectory = resolve(requiredArgument(args, 'pack'));
const mode = args.get('mode') ?? 'publish';
const replaceExisting = args.get('replace') === 'true';
if (mode !== 'stage' && mode !== 'activate' && mode !== 'publish') {
  throw new Error(`Unsupported publish mode ${mode}; expected stage, activate, or publish`);
}
const sourceManifestBytes = await readFile(join(packDirectory, 'pack-manifest.json'));
const manifest = JSON.parse(sourceManifestBytes.toString('utf8')) as GeneratedPackManifest;
if (manifest.formatVersion !== 6) {
  throw new Error(`Unsupported generated pack format ${manifest.formatVersion}; only format 6 is publishable`);
}
await verifyPack({ packDirectory });

const publicData = join(repositoryRoot, 'public/data');
const destination = join(publicData, manifest.datasetId);
const globalAssets = join(repositoryRoot, 'public/assets/sha256');
const versionsPath = join(repositoryRoot, 'public/versions.json');

function assetFilename(asset: { url: string }): string {
  return basename(new URL(asset.url, 'https://publisher.invalid/').pathname);
}

function physicalAssets(): ImmutableAsset[] {
  return [...manifest.recordPages, ...manifest.iconSheets];
}

function catalogPhysicalBytes(): number {
  const pageIndexes = new Set<number>();
  for (const asset of manifest.catalogAssets) {
    for (const segment of asset.segments ?? []) {
      const pageIndex = segment[0];
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= manifest.recordPages.length) {
        throw new Error(`${asset.id}: catalog segment references invalid record page ${String(pageIndex)}`);
      }
      pageIndexes.add(pageIndex);
    }
  }
  return [...pageIndexes].reduce((total, pageIndex) => total + manifest.recordPages[pageIndex]!.bytes, 0);
}

async function publishSharedObjects(): Promise<void> {
  await mkdir(globalAssets, { recursive: true });
  const copied = new Set<string>();
  for (const asset of physicalAssets()) {
    if (!asset.url || asset.segments !== undefined) {
      throw new Error(`${asset.id}: only unsegmented physical assets may be published globally`);
    }
    const filename = assetFilename(asset);
    if (filename !== asset.sha256) {
      throw new Error(`${asset.id}: physical asset URL must end in its full SHA-256`);
    }
    if (copied.has(asset.sha256)) continue;
    copied.add(asset.sha256);
    const source = join(packDirectory, 'assets/sha256', filename);
    const target = join(globalAssets, filename);
    try {
      await copyFile(source, target, 1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(target);
      const digest = createHash('sha256').update(existing).digest('hex');
      if (digest !== asset.sha256) {
        throw new Error(`Global object collision for ${filename}`, { cause: error });
      }
    }
  }
}

async function copySharedManifest(staging: string): Promise<void> {
  await cp(join(packDirectory, 'pack-manifest.json'), join(staging, 'pack-manifest.json'));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * A dataset ID is part of an immutable manifest URL. Replacing a different
 * manifest at the same path would leave installed browsers with an
 * unresolvable cache collision, especially across pack-format migrations.
 */
async function assertImmutableDestination(): Promise<void> {
  const existingManifestPath = join(destination, 'pack-manifest.json');
  let existingManifestBytes: Buffer;
  try {
    existingManifestBytes = await readFile(existingManifestPath);
  } catch (error) {
    throw new Error(
      `Cannot replace dataset ${manifest.datasetId}: its immutable destination has no readable manifest`,
      { cause: error }
    );
  }
  assertImmutableManifestBytes(existingManifestBytes, sourceManifestBytes, manifest.datasetId);
}

function prefixLayoutFromManifest(
  value: GeneratedPackManifest['sharedLayout']
): SharedPrefixLayout {
  if (!value?.prefixes) throw new Error('Manifest is missing its published prefix layout');
  return {
    schemaVersion: value.schemaVersion,
    targets: value.targets,
    ...value.prefixes
  };
}

/**
 * Published manifests are the release ledger for the persistent trie. A
 * future pack may add descendants, but it may not publish a layout which
 * removes or changes any prefix already visible in the public data tree.
 */
async function assertPublishedLayoutLineage(): Promise<void> {
  if (!(await pathExists(publicData))) return;
  const nextLayout = prefixLayoutFromManifest(manifest.sharedLayout);
  const directories = await readdir(publicData, { withFileTypes: true });
  for (const directory of directories) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
    const manifestPath = join(publicData, directory.name, 'pack-manifest.json');
    let existing: GeneratedPackManifest;
    try {
      existing = JSON.parse(await readFile(manifestPath, 'utf8')) as GeneratedPackManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (existing.formatVersion !== 6) continue;
    try {
      assertSharedLayoutExtension(prefixLayoutFromManifest(existing.sharedLayout), nextLayout);
    } catch (error) {
      throw new Error(
        `Format-6 layout for ${manifest.datasetId} is not an append-only extension of ${existing.datasetId}: `
          + `${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
}

async function verifyPublishedManifest(destinationDirectory: string): Promise<void> {
  const publishedManifest = await readFile(join(destinationDirectory, 'pack-manifest.json'));
  const sourceManifest = await readFile(join(packDirectory, 'pack-manifest.json'));
  if (!publishedManifest.equals(sourceManifest)) {
    throw new Error('Published manifest differs from the staged source');
  }
  await verifyPack({ packDirectory: destinationDirectory, assetDirectory: globalAssets });
}

async function pruneUnreferencedSharedObjects(): Promise<number> {
  const manifests: GeneratedPackManifest[] = [];
  for (const directory of await readdir(publicData, { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
    const manifestPath = join(publicData, directory.name, 'pack-manifest.json');
    try {
      manifests.push(JSON.parse(await readFile(manifestPath, 'utf8')) as GeneratedPackManifest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const objectEntries = await readdir(globalAssets, { withFileTypes: true });
  if (objectEntries.some((entry) => !entry.isFile())) {
    throw new Error('Global SHA-256 object store must contain files only');
  }
  const unreferenced = unreferencedSharedObjectNames(
    objectEntries.map((entry) => entry.name),
    manifests
  );
  for (const name of unreferenced) await rm(join(globalAssets, name));
  return unreferenced.length;
}

let previousDirectory: string | undefined;
if (mode === 'stage' || mode === 'publish') {
  await assertPublishedLayoutLineage();
  if (await pathExists(destination)) {
    if (!replaceExisting) {
      await assertPathMissing(destination, 'Published dataset');
    }
    await assertImmutableDestination();
    previousDirectory = join(publicData, `.${manifest.datasetId}.previous-${process.pid}`);
    await assertPathMissing(previousDirectory, 'Previous published dataset backup');
    await rename(destination, previousDirectory);
  }
  const staging = join(publicData, `.${manifest.datasetId}.staging-${process.pid}`);
  await assertPathMissing(staging, 'Publish staging directory');
  await mkdir(staging, { recursive: true });
  try {
    await publishSharedObjects();
    await copySharedManifest(staging);
    await rename(staging, destination);
    await verifyPublishedManifest(destination);
    if (previousDirectory) {
      await rm(previousDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
    if (previousDirectory && !(await pathExists(destination))) {
      await rename(previousDirectory, destination);
    }
    throw error;
  }
} else {
  await assertPublishedLayoutLineage();
  await access(join(destination, 'pack-manifest.json'));
  await verifyPublishedManifest(destination);
}

if (mode === 'stage') {
  const prunedSharedObjects = await pruneUnreferencedSharedObjects();
  console.log(JSON.stringify({
    datasetId: manifest.datasetId,
    destination,
    staged: true,
    prunedSharedObjects
  }, null, 2));
  process.exit(0);
}

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
  catalogBytes: catalogPhysicalBytes(),
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
const prunedSharedObjects = await pruneUnreferencedSharedObjects();
console.log(JSON.stringify({
  datasetId: manifest.datasetId,
  destination,
  versions: next.versions.map((version) => version.datasetId),
  removedDatasets: replacedDatasetIds,
  prunedSharedObjects
}, null, 2));
