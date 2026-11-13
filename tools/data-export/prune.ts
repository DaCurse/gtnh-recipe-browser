import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import { unreferencedSharedObjectNames } from './lib';

export async function prunePublishedObjects(
  repositoryRoot: string,
): Promise<{ count: number; bytes: number }> {
  const publicData = join(repositoryRoot, 'public/data');
  const globalAssets = join(repositoryRoot, 'public/assets/sha256');
  const manifests: GeneratedPackManifest[] = [];
  const manifestDigests = new Map<string, string>();
  for (const directory of await readdir(publicData, { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
    const manifestPath = join(publicData, directory.name, 'pack-manifest.json');
    try {
      const bytes = await readFile(manifestPath);
      const manifest = JSON.parse(bytes.toString()) as GeneratedPackManifest;
      manifests.push(manifest);
      manifestDigests.set(manifest.datasetId, createHash('sha256').update(bytes).digest('hex'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const companions: Array<{ datasetId: string; assets: Array<{ sha256: string }> }> = [];
  const archivedCompanions: string[] = [];
  for (const directory of [
    'assets/source/high-resolution-icons/releases',
    'assets/source/ore-diagrams/releases',
    'assets/source/catalog-order/releases',
  ]) {
    const files = await readdir(join(repositoryRoot, directory)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return [] as string[];
    });
    archivedCompanions.push(
      ...files.filter((file) => file.endsWith('.json')).map((file) => join(directory, file)),
    );
  }
  for (const path of [
    'assets/source/high-resolution-icons/provenance.json',
    'assets/source/ore-diagrams/provenance.json',
    ...archivedCompanions,
  ]) {
    const companion = JSON.parse(await readFile(join(repositoryRoot, path), 'utf8')) as {
      datasetId: string;
      baseManifestSha256: string;
      assets: Array<{ sha256: string }>;
    };
    const digest = manifestDigests.get(companion.datasetId);
    if (!digest) continue;
    if (digest !== companion.baseManifestSha256)
      throw new Error(`Companion does not match its immutable dataset: ${path}`);
    companions.push(companion);
  }
  const objectEntries = await readdir(globalAssets, { withFileTypes: true });
  if (objectEntries.some((entry) => !entry.isFile())) {
    throw new Error('Global SHA-256 object store must contain files only');
  }
  const unreferenced = unreferencedSharedObjectNames(
    objectEntries.map((entry) => entry.name),
    manifests,
    companions,
  );
  let bytes = 0;
  for (const name of unreferenced) {
    const path = join(globalAssets, name);
    bytes += (await stat(path)).size;
    await rm(path);
  }
  return { count: unreferenced.length, bytes };
}
