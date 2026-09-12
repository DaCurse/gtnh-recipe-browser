import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encode, decode } from '@msgpack/msgpack';
import { assembleRecordPages, decodeRecordPage, RECORD_PAGE_TARGET_BYTES, type RecordPageSelection } from '../../src/lib/recordPages';
import type { GeneratedPackManifest, ImmutableAsset } from './manifest';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function collectionHeader(length: number, map = false): Uint8Array {
  if (length < 16) return Uint8Array.of((map ? 0x80 : 0x90) + length);
  if (length <= 65535) return Uint8Array.of(map ? 0xde : 0xdc, length >>> 8, length & 255);
  return Uint8Array.of(map ? 0xdf : 0xdd, length >>> 24, length >>> 16 & 255, length >>> 8 & 255, length & 255);
}

/** Split only between complete top-level records; length headers are independent. */
function recordsOf(value: Record<string, unknown>): Uint8Array[] {
  const entries = Object.entries(value);
  const records = [collectionHeader(entries.length, true)];
  for (const [key, child] of entries) {
    records.push(encode(key));
    if (Array.isArray(child)) {
      records.push(collectionHeader(child.length));
      for (const record of child) records.push(encode(record));
    } else {
      records.push(encode(child));
    }
  }
  return records;
}

export interface ReusePack {
  manifest: GeneratedPackManifest;
  assetsDirectory: string;
}

async function resolveReuseAssetsDirectory(
  packDirectory: string,
  manifest: GeneratedPackManifest
): Promise<string> {
  const localDirectory = join(packDirectory, 'assets', 'sha256');
  try {
    await access(localDirectory);
    return localDirectory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (manifest.recordPages.length === 0) {
    throw new Error(`${packDirectory}: reusable format-6 pack has no record pages`);
  }
  const manifestUrl = pathToFileURL(join(packDirectory, 'pack-manifest.json'));
  const firstPageUrl = new URL(manifest.recordPages[0]!.url, manifestUrl);
  if (firstPageUrl.protocol !== 'file:') {
    throw new Error(`${packDirectory}: reusable page URL must resolve to a local file`);
  }
  const assetsDirectory = dirname(fileURLToPath(firstPageUrl));
  for (const page of manifest.recordPages) {
    const pageUrl = new URL(page.url, manifestUrl);
    if (
      pageUrl.protocol !== 'file:'
      || dirname(fileURLToPath(pageUrl)) !== assetsDirectory
      || basename(fileURLToPath(pageUrl)) !== page.sha256
    ) {
      throw new Error(`${packDirectory}: reusable record pages must resolve to one full-SHA object directory`);
    }
  }
  await access(assetsDirectory);
  return assetsDirectory;
}

export async function readReusePacks(paths: readonly string[]): Promise<ReusePack[]> {
  return Promise.all(paths.map(async (path) => {
    const packDirectory = resolve(path);
    const manifest = JSON.parse(
      await readFile(join(packDirectory, 'pack-manifest.json'), 'utf8')
    ) as GeneratedPackManifest;
    if (manifest.formatVersion !== 6) throw new Error(`${packDirectory}: reusable pack must use format 6`);
    return {
      manifest,
      assetsDirectory: await resolveReuseAssetsDirectory(packDirectory, manifest)
    };
  }));
}

/** Freeze existing physical pages; later datasets select records without rewriting them. */
export async function buildRecordPages(
  assets: readonly ImmutableAsset[],
  directory: string,
  baseUrl: string,
  reuse: readonly ReusePack[]
): Promise<ImmutableAsset[]> {
  const locations = new Map<string, [string, number]>();
  const existing = new Map<string, { asset: ImmutableAsset; directory: string }>();
  for (const pack of reuse) {
    for (const asset of pack.manifest.recordPages ?? []) {
      if (existing.has(asset.sha256)) continue;
      const compressed = await readFile(join(pack.assetsDirectory, asset.sha256));
      if (compressed.length !== asset.bytes || digest(compressed) !== asset.sha256) throw new Error('Corrupt reusable record page');
      const records = decodeRecordPage(gunzipSync(compressed));
      records.forEach((record, index) => {
        const hash = digest(record);
        if (!locations.has(hash)) locations.set(hash, [asset.sha256, index]);
      });
      existing.set(asset.sha256, { asset, directory: pack.assetsDirectory });
    }
  }
  const plans: Array<{ asset: ImmutableAsset; hashes: string[]; raw: Buffer }> = [];
  let pending: Uint8Array[] = [];
  let pendingSize = 0;
  const pendingHashes = new Set<string>();
  const pages = new Map<string, ImmutableAsset>();
  await mkdir(directory, { recursive: true });
  const flush = async () => {
    if (!pending.length) return;
    const bytes = gzipSync(encode(pending), { level: 9 });
    const hash = digest(bytes);
    await writeFile(join(directory, hash), bytes);
    pages.set(hash, { id: `page-${hash}`, sha256: hash, bytes: bytes.length,
      encoding: 'gzip', mediaType: 'application/msgpack', url: `${baseUrl.replace(/\/$/, '')}/assets/sha256/${hash}`,
      ...(pending.length === 1 && pendingSize > RECORD_PAGE_TARGET_BYTES ? { oversizedSingleton: true } : {}) });
    pending.forEach((record, index) => locations.set(digest(record), [hash, index]));
    pending = [];
    pendingSize = 0;
    pendingHashes.clear();
  };
  for (const asset of assets) {
    const input = await readFile(join(directory, basename(asset.url)));
    const raw = asset.encoding === 'gzip' ? gunzipSync(input) : input;
    const records = recordsOf(decode(raw) as Record<string, unknown>);
    const reconstructed = Buffer.concat(records);
    if (!reconstructed.equals(raw)) throw new Error(`${asset.id}: record encoding changed`);
    const hashes: string[] = [];
    for (const record of records) {
      const hash = digest(record);
      hashes.push(hash);
      if (locations.has(hash) || pendingHashes.has(hash)) continue;
      if (pendingSize + record.length > RECORD_PAGE_TARGET_BYTES) await flush();
      pending.push(record);
      pendingSize += record.length;
      pendingHashes.add(hash);
    }
    plans.push({ asset, hashes, raw });
  }
  await flush();
  const used = new Map<string, number>();
  for (const { asset, hashes, raw } of plans) {
    const segments: RecordPageSelection[] = [];
    for (const hash of hashes) {
      const [page, index] = locations.get(hash)!;
      if (!used.has(page)) used.set(page, used.size);
      const pageIndex = used.get(page)!;
      const previous = segments.at(-1);
      if (previous && previous[0] === pageIndex && previous[1] + previous[2] === index) previous[2]++;
      else segments.push([pageIndex, index, 1]);
    }
    Object.assign(asset, { segments, sha256: digest(raw), bytes: raw.length, encoding: 'identity', url: '' });
  }
  for (const hash of used.keys()) {
    if (pages.has(hash)) continue;
    const source = existing.get(hash)!;
    await writeFile(join(directory, hash), await readFile(join(source.directory, hash)));
    pages.set(hash, { ...source.asset, url: `${baseUrl.replace(/\/$/, '')}/assets/sha256/${hash}` });
  }
  return [...used.keys()].map((hash) => pages.get(hash)!);
}

const verifiedPages = new WeakMap<GeneratedPackManifest, Map<string, Promise<Uint8Array[]>>>();

export async function readLogicalAsset(
  asset: ImmutableAsset,
  manifest: GeneratedPackManifest,
  directory: string
): Promise<Uint8Array> {
  if (!asset.segments) throw new Error(`${asset.id}: logical asset has no page selections`);
  let cache = verifiedPages.get(manifest);
  if (!cache) {
    cache = new Map();
    verifiedPages.set(manifest, cache);
  }
  const pages = new Map<number, Uint8Array[]>();
  for (const index of new Set(asset.segments.map(([index]) => index))) {
    const descriptor = manifest.recordPages?.[index];
    if (!descriptor) throw new Error(`${asset.id}: record page absent from manifest`);
    const hash = descriptor.sha256;
    const key = `${resolve(directory)}:${hash}`;
    let loaded = cache.get(key);
    if (!loaded) {
      loaded = (async () => {
        const bytes = await readFile(join(directory, hash));
        if (bytes.length !== descriptor.bytes || digest(bytes) !== hash) throw new Error(`${hash}: corrupt record page`);
        return decodeRecordPage(gunzipSync(bytes));
      })();
      cache.set(key, loaded);
    }
    pages.set(index, await loaded);
  }
  const bytes = assembleRecordPages(asset, pages);
  if (digest(bytes) !== asset.sha256) throw new Error(`${asset.id}: reconstructed integrity mismatch`);
  return bytes;
}
