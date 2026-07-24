import { verifyAssetBytes } from './integrity';
import {
  cacheAsset,
  cacheMetadata,
  getCachedAsset,
  getCachedMetadata,
  removeCachedAsset
} from './storage';
import type { DatasetAsset } from './datasetSchema';

interface AssetLoadProgress {
  loaded: number;
  total: number;
  cached: boolean;
}

export async function fetchVerified(
  asset: DatasetAsset,
  manifestUrl: string,
  onProgress?: (progress: AssetLoadProgress) => void,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) throw new DOMException('Operation was cancelled', 'AbortError');
  const cached = await getCachedAsset(asset.sha256);
  if (cached) {
    onProgress?.({ loaded: cached.byteLength, total: asset.bytes, cached: true });
    try {
      verifyAssetBytes(asset, cached);
      return cached;
    } catch {
      // Remove a stale or corrupt record before attempting a clean download.
    }
    await removeCachedAsset(asset.sha256);
  }

  const response = await fetch(new URL(asset.url, manifestUrl), { signal });
  if (!response.ok) throw new Error(`Unable to download ${asset.id}: HTTP ${response.status}`);
  let bytes: Uint8Array;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      if (signal?.aborted) throw new DOMException('Operation was cancelled', 'AbortError');
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      loaded += result.value.byteLength;
      onProgress?.({ loaded, total: asset.bytes, cached: false });
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: bytes.byteLength, total: asset.bytes, cached: false });
  }
  verifyAssetBytes(asset, bytes);
  await cacheAsset(asset.sha256, bytes);
  return bytes;
}

export async function fetchJsonNetworkFirst<T>(
  url: string,
  cacheKey: string
): Promise<{ url: string; value: T }> {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json() as T;
    await cacheMetadata(cacheKey, response.url, value);
    return { url: response.url, value };
  } catch (networkError) {
    const cached = await getCachedMetadata<T>(cacheKey);
    if (cached) return cached;
    throw networkError;
  }
}

export async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const input = Uint8Array.from(bytes).buffer;
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
