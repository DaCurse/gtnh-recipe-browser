import {
  assembleRecordPages,
  decodeRecordPage,
  RECORD_PAGE_TARGET_BYTES
} from './recordPages';
import { verifyAssetBytes } from './integrity';
import {
  cacheAsset,
  cacheMetadata,
  getCachedAsset,
  getCachedMetadata,
  removeCachedAsset
} from './storage';
import type { DatasetAsset, DatasetManifest } from './datasetSchema';

interface AssetLoadProgress {
  loaded: number;
  total: number;
  cached: boolean;
}

type AssetProgressHandler = (progress: AssetLoadProgress) => void;
type RecordPageManifest = Pick<DatasetManifest, 'recordPages'>;

/**
 * Decoded record pages are shared by all repositories in this tab. The
 * durable cache stores compressed bytes, but retaining decoded slices avoids
 * downloading and decoding a shared page again while switching revisions.
 */
const RECORD_PAGE_CACHE_MAX_BYTES = RECORD_PAGE_TARGET_BYTES * 32;
const RECORD_PAGE_CACHE_MAX_ENTRIES = 64;

interface DecodedRecordPage {
  records: readonly Uint8Array[];
  bytes: number;
}

const decodedRecordPages = new Map<string, DecodedRecordPage>();
const decodedRecordPageLoads = new Map<string, Promise<DecodedRecordPage>>();
const physicalAssetLoads = new Map<string, Promise<Uint8Array>>();
let decodedRecordPageBytes = 0;

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Operation was cancelled', 'AbortError');
}

function touchDecodedRecordPage(hash: string, page: DecodedRecordPage): void {
  decodedRecordPages.delete(hash);
  decodedRecordPages.set(hash, page);
}

function cachedDecodedRecordPage(hash: string): DecodedRecordPage | undefined {
  const page = decodedRecordPages.get(hash);
  if (page) touchDecodedRecordPage(hash, page);
  return page;
}

function cacheDecodedRecordPage(hash: string, page: DecodedRecordPage): void {
  if (page.bytes > RECORD_PAGE_CACHE_MAX_BYTES) return;
  const existing = decodedRecordPages.get(hash);
  if (existing) decodedRecordPageBytes -= existing.bytes;
  decodedRecordPages.delete(hash);
  while (
    decodedRecordPages.size >= RECORD_PAGE_CACHE_MAX_ENTRIES
    || decodedRecordPageBytes + page.bytes > RECORD_PAGE_CACHE_MAX_BYTES
  ) {
    const oldest = decodedRecordPages.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const removed = decodedRecordPages.get(oldest);
    decodedRecordPages.delete(oldest);
    decodedRecordPageBytes -= removed?.bytes ?? 0;
  }
  decodedRecordPages.set(hash, page);
  decodedRecordPageBytes += page.bytes;
}

function decodedRecordBytes(records: readonly Uint8Array[]): number {
  return records.reduce((total, record) => total + record.byteLength, 0);
}

async function readResponseBytes(
  response: Response,
  asset: DatasetAsset,
  onProgress: AssetProgressHandler | undefined,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!response.body) {
    abortIfNeeded(signal);
    const bytes = new Uint8Array(await response.arrayBuffer());
    abortIfNeeded(signal);
    onProgress?.({ loaded: bytes.byteLength, total: asset.bytes, cached: false });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      abortIfNeeded(signal);
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      loaded += result.value.byteLength;
      onProgress?.({ loaded, total: asset.bytes, cached: false });
    }
  } finally {
    reader.releaseLock();
  }
  abortIfNeeded(signal);
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchPhysicalVerified(
  asset: DatasetAsset,
  manifestUrl: string,
  onProgress?: AssetProgressHandler,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (asset.segments !== undefined) {
    throw new Error(`${asset.id}: a physical asset must not contain record-page segments`);
  }
  abortIfNeeded(signal);
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

  abortIfNeeded(signal);
  if (!asset.url) throw new Error(`${asset.id}: physical asset has no URL`);
  const response = await fetch(new URL(asset.url, manifestUrl), { signal });
  if (!response.ok) throw new Error(`Unable to download ${asset.id}: HTTP ${response.status}`);
  const bytes = await readResponseBytes(response, asset, onProgress, signal);
  verifyAssetBytes(asset, bytes);
  abortIfNeeded(signal);
  await cacheAsset(asset.sha256, bytes);
  return bytes;
}

function loadPhysicalVerified(
  asset: DatasetAsset,
  manifestUrl: string,
  onProgress?: AssetProgressHandler,
  signal?: AbortSignal
): Promise<Uint8Array> {
  let pending = physicalAssetLoads.get(asset.sha256);
  if (!pending) {
    pending = fetchPhysicalVerified(asset, manifestUrl, onProgress, signal);
    physicalAssetLoads.set(asset.sha256, pending);
    void pending.then(
      () => physicalAssetLoads.delete(asset.sha256),
      () => physicalAssetLoads.delete(asset.sha256)
    );
  }
  return pending;
}

function recordPageMap(manifest: RecordPageManifest): Map<number, DatasetAsset> {
  if (!Array.isArray(manifest.recordPages)) {
    throw new Error('Manifest has no record-page list');
  }
  const pages = new Map<number, DatasetAsset>();
  const hashes = new Set<string>();
  for (const [pageIndex, page] of manifest.recordPages.entries()) {
    if (
      !page
      || typeof page.sha256 !== 'string'
      || page.sha256.length === 0
      || !Number.isSafeInteger(page.bytes)
      || page.bytes < 0
      || page.encoding !== 'gzip'
      || page.url.length === 0
      || page.segments !== undefined
    ) {
      throw new Error('Manifest contains an invalid physical record page');
    }
    if (hashes.has(page.sha256)) {
      throw new Error(`Duplicate physical record page ${page.sha256}`);
    }
    hashes.add(page.sha256);
    pages.set(pageIndex, page);
  }
  return pages;
}

async function decodePhysicalRecordPage(
  page: DatasetAsset,
  manifestUrl: string,
  onProgress: AssetProgressHandler | undefined,
  signal?: AbortSignal
): Promise<DecodedRecordPage> {
  const cached = cachedDecodedRecordPage(page.sha256);
  if (cached) {
    onProgress?.({ loaded: page.bytes, total: page.bytes, cached: true });
    return cached;
  }

  let pending = decodedRecordPageLoads.get(page.sha256);
  if (pending) {
    const decoded = await pending;
    abortIfNeeded(signal);
    onProgress?.({ loaded: page.bytes, total: page.bytes, cached: true });
    return decoded;
  }

  pending = (async () => {
    const bytes = await loadPhysicalVerified(page, manifestUrl, onProgress, signal);
    abortIfNeeded(signal);
    const decodedBytes = page.encoding === 'gzip' ? await decompress(bytes) : bytes;
    abortIfNeeded(signal);
    const records = decodeRecordPage(decodedBytes);
    const decoded: DecodedRecordPage = {
      records,
      bytes: decodedRecordBytes(records)
    };
    if ((decoded.bytes > RECORD_PAGE_TARGET_BYTES) !== (page.oversizedSingleton === true)) {
      throw new Error(`${page.id}: invalid oversized record-page marker`);
    }
    cacheDecodedRecordPage(page.sha256, decoded);
    return decoded;
  })();
  decodedRecordPageLoads.set(page.sha256, pending);
  void pending.then(
    () => decodedRecordPageLoads.delete(page.sha256),
    () => decodedRecordPageLoads.delete(page.sha256)
  );
  return pending;
}

async function fetchLogicalVerified(
  asset: DatasetAsset,
  manifest: RecordPageManifest,
  manifestUrl: string,
  onProgress?: AssetProgressHandler,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (asset.encoding !== 'identity' || asset.url !== '') {
    throw new Error(`${asset.id}: logical record-page assets must use identity encoding and an empty URL`);
  }
  if (!Array.isArray(asset.segments)) {
    throw new Error(`${asset.id}: logical asset has no record-page segments`);
  }

  const pagesByHash = recordPageMap(manifest);
  const selectedPageIndices = [...new Set(asset.segments.map((selection) => selection[0]))];
  const selectedPages: DatasetAsset[] = [];
  const selectedPageIndexByHash = new Map<string, number>();
  for (const pageIndex of selectedPageIndices) {
    const page = pagesByHash.get(pageIndex);
    if (!page) throw new Error(`${asset.id}: record page index ${String(pageIndex)} is absent from the manifest`);
    selectedPages.push(page);
    selectedPageIndexByHash.set(page.sha256, pageIndex);
  }
  const total = selectedPages.reduce((sum, page) => sum + page.bytes, 0);
  let completed = 0;
  const pages = new Map<number, readonly Uint8Array[]>();
  for (const page of selectedPages) {
    abortIfNeeded(signal);
    let pageLoaded = 0;
    const decoded = await decodePhysicalRecordPage(
      page,
      manifestUrl,
      ({ loaded, cached }) => {
        pageLoaded = Math.max(pageLoaded, Math.min(page.bytes, loaded));
        onProgress?.({
          loaded: Math.min(total, completed + pageLoaded),
          total,
          cached
        });
      },
      signal
    );
    const pageIndex = selectedPageIndexByHash.get(page.sha256);
    if (pageIndex === undefined) throw new Error(`${asset.id}: record page index lookup failed`);
    pages.set(pageIndex, decoded.records);
    completed += page.bytes;
    if (pageLoaded < page.bytes) {
      onProgress?.({ loaded: Math.min(total, completed), total, cached: true });
    }
  }
  const assembled = assembleRecordPages(asset, pages);
  verifyAssetBytes(asset, assembled);
  abortIfNeeded(signal);
  return assembled;
}

/**
 * Fetch and verify an asset. Format-6 logical assets are reconstructed from
 * record pages listed by the manifest; ordinary physical assets retain the
 * original URL/SHA behavior.
 *
 * The optional manifest is deliberately last to preserve the existing
 * `(asset, manifestUrl, onProgress, signal)` call shape used by icon loading.
 */
export async function fetchVerified(
  asset: DatasetAsset,
  manifestUrl: string,
  onProgress?: AssetProgressHandler,
  signal?: AbortSignal,
  manifest?: RecordPageManifest
): Promise<Uint8Array> {
  if (asset.segments !== undefined) {
    if (!manifest) throw new Error(`${asset.id}: record-page manifest is required`);
    return fetchLogicalVerified(asset, manifest, manifestUrl, onProgress, signal);
  }
  return loadPhysicalVerified(asset, manifestUrl, onProgress, signal);
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
