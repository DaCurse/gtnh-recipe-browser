import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { catalogRegistryKey } from '../src/lib/catalogOrder';
import { writeCompanionRelease } from './pack-builder/companionRelease';
import type { DecodedRepository } from './pack-builder/model';
import type { GeneratedPackManifest } from './pack-builder/manifest';

export function buildCatalogOrder(source: DecodedRepository, manifest: GeneratedPackManifest): string {
  const ids = new Map<string, number>();
  for (const item of [...source.items, ...source.fluids]) {
    const key = catalogRegistryKey(item.id);
    const previous = ids.get(key);
    if (!Number.isSafeInteger(item.numericId) || item.numericId < 0
      || (previous !== undefined && previous !== item.numericId)) throw new Error(`Conflicting registry ID: ${key}`);
    ids.set(key, item.numericId);
  }
  return JSON.stringify({ schemaVersion: 1, datasetId: manifest.datasetId,
    sourceDataSha256: manifest.source.dataSha256,
    registryIds: Object.fromEntries([...ids].sort(([a], [b]) => a.localeCompare(b))) });
}

export async function publishCatalogOrder(root: string, manifest: GeneratedPackManifest, source: string): Promise<void> {
  const index = JSON.parse(source) as { schemaVersion: number; datasetId: string; sourceDataSha256: string };
  if (index.schemaVersion !== 1 || index.datasetId !== manifest.datasetId
    || index.sourceDataSha256 !== manifest.source.dataSha256) throw new Error('Catalogue order belongs to a different export');
  const bytes = gzipSync(source, { level: 9 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const store = join(root, 'public/assets/sha256');
  await mkdir(store, { recursive: true });
  await writeFile(join(store, sha256), bytes);
  const manifestBytes = await readFile(join(root, 'public/data', manifest.datasetId, 'pack-manifest.json'));
  await writeCompanionRelease(join(root, 'src/lib/generated/catalog-order.json'), join(root, 'assets/source/catalog-order'),
    { sha256, bytes: bytes.length }, { datasetId: manifest.datasetId,
      baseManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
      sourceDataSha256: manifest.source.dataSha256, assets: [{ sha256, bytes: bytes.length }] });
}
