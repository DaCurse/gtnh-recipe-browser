import releases from './generated/catalog-order.json';
import { decompress, fetchVerified } from './datasetAssets';
import { catalogRegistryKey } from './catalogOrder';
import type { CatalogEntry } from './types';
import type { DatasetAsset, DatasetManifest } from './datasetSchema';

interface OrderIndex {
  schemaVersion: number;
  datasetId: string;
  sourceDataSha256: string;
  registryIds: Record<string, number>;
}
const registry: Record<string, { sha256: string; bytes: number }> = releases.releases;

export function catalogOrderAsset(
  manifest: DatasetManifest,
  manifestUrl: string,
): DatasetAsset | undefined {
  const descriptor = registry[manifest.datasetId];
  return descriptor
    ? {
        ...descriptor,
        id: 'catalog-order',
        encoding: 'gzip',
        url: new URL(`../../assets/sha256/${descriptor.sha256}`, manifestUrl).href,
      }
    : undefined;
}

export async function applyCatalogOrder(
  entries: CatalogEntry[],
  manifest: DatasetManifest,
  manifestUrl: string,
): Promise<void> {
  const asset = catalogOrderAsset(manifest, manifestUrl);
  if (!asset) return;
  const bytes = await fetchVerified(asset, manifestUrl);
  const index = JSON.parse(new TextDecoder().decode(await decompress(bytes))) as OrderIndex;
  if (
    index.schemaVersion !== 1 ||
    index.datasetId !== manifest.datasetId ||
    index.sourceDataSha256 !== manifest.source?.dataSha256 ||
    !index.registryIds ||
    Object.values(index.registryIds).some((id) => !Number.isSafeInteger(id) || id < 0)
  ) {
    throw new Error('Catalogue ordering index does not match this dataset');
  }
  for (const entry of entries) {
    const numericId = index.registryIds[catalogRegistryKey(entry.id)];
    if (numericId !== undefined) entry.numericId = numericId;
  }
}
