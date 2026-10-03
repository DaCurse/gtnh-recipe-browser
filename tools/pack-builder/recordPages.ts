import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encode, decode } from '@msgpack/msgpack';
import { assembleRecordPages, compactRecordPageSelections, decodeRecordPage, recordPageSelections, RECORD_PAGE_TARGET_BYTES, type RecordPageSelection } from '../../src/lib/recordPages';
import type { GeneratedPackManifest, ImmutableAsset, RecordPageFamily } from './manifest';

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
    throw new Error(`${packDirectory}: reusable format-7 pack has no record pages`);
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
    if (manifest.formatVersion !== 7) throw new Error(`${packDirectory}: reusable pack must use format 7`);
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
  const existingRecords = new Map<string, Uint8Array[]>();
  for (const pack of reuse) {
    for (const asset of pack.manifest.recordPages ?? []) {
      if (existing.has(asset.sha256)) continue;
      const compressed = await readFile(join(pack.assetsDirectory, asset.sha256));
      if (compressed.length !== asset.bytes || digest(compressed) !== asset.sha256) throw new Error('Corrupt reusable record page');
      const records = decodeRecordPage(gunzipSync(compressed));
      existingRecords.set(asset.sha256, records);
      records.forEach((record, index) => {
        const scopedHash = `${asset.family ?? 'bootstrap'}:${digest(record)}`;
        if (!locations.has(scopedHash)) locations.set(scopedHash, [asset.sha256, index]);
      });
      existing.set(asset.sha256, { asset, directory: pack.assetsDirectory });
    }
    const lazyAssets = [
      ...(pack.manifest.goodsDetailShards ?? []),
      ...(pack.manifest.ingredientGroupShards ?? []),
      ...(pack.manifest.recipeShards ?? []),
      ...(pack.manifest.specialDataShards ?? [])
    ];
    for (const logical of lazyAssets) {
      const family = logical.family;
      if (!family || family === 'bootstrap') continue;
      for (const [pageIndex, first, count] of recordPageSelections(logical)) {
        const page = pack.manifest.recordPages[pageIndex];
        const records = page ? existingRecords.get(page.sha256) : undefined;
        if (!page || !records) throw new Error(`${logical.id}: reusable record page is absent`);
        for (let index = first; index < first + count; index++) {
          const record = records[index];
          if (!record) throw new Error(`${logical.id}: reusable record selection is invalid`);
          const key = family === 'goods-details' || family === 'ingredient-groups'
            ? `${family}:${logical.id}:${digest(record)}` : `${family}:${digest(record)}`;
          if (!locations.has(key)) locations.set(key, [page.sha256, index]);
        }
      }
    }
  }
  const plans: Array<{ asset: ImmutableAsset; hashes: string[]; raw: Buffer }> = [];
  let pending: Uint8Array[] = [];
  let pendingKeys: string[] = [];
  let pendingSize = 0;
  const pendingHashes = new Set<string>();
  let pendingFamily: RecordPageFamily | undefined;
  const pages = new Map<string, ImmutableAsset>();
  await mkdir(directory, { recursive: true });
  const flush = async () => {
    if (!pending.length) return;
    const bytes = gzipSync(encode(pending), { level: 9 });
    const hash = digest(bytes);
    existingRecords.set(hash, pending.slice());
    await writeFile(join(directory, hash), bytes);
    pages.set(hash, { id: `page-${hash}`, sha256: hash, bytes: bytes.length,
      encoding: 'gzip', mediaType: 'application/msgpack', url: `${baseUrl.replace(/\/$/, '')}/assets/sha256/${hash}`,
      family: pendingFamily,
      ...(pending.length === 1 && pendingSize > RECORD_PAGE_TARGET_BYTES ? { oversizedSingleton: true } : {}) });
    pendingKeys.forEach((key, index) => locations.set(key, [hash, index]));
    pending = [];
    pendingKeys = [];
    pendingSize = 0;
    pendingHashes.clear();
    pendingFamily = undefined;
  };
  for (const asset of assets) {
    const family = asset.family ?? 'bootstrap';
    if (pending.length > 0 && pendingFamily !== family) await flush();
    pendingFamily = family;
    const input = await readFile(join(directory, basename(asset.url)));
    const raw = asset.encoding === 'gzip' ? gunzipSync(input) : input;
    const records = recordsOf(decode(raw) as Record<string, unknown>);
    const reconstructed = Buffer.concat(records);
    if (!reconstructed.equals(raw)) throw new Error(`${asset.id}: record encoding changed`);
    const isolated = family === 'goods-details' || family === 'ingredient-groups';
    if (isolated) await flush();
    const recordKey = (record: Uint8Array) => isolated
      ? `${family}:${asset.id}:${digest(record)}` : `${family}:${digest(record)}`;
    const hashes = records.map(recordKey);
    // Reuse is global within a load family. Common headers may be shared,
    // but no selection can pull lazy records into bootstrap pages.
    for (const record of records) {
      const hash = digest(record);
      const scopedHash = isolated ? `${family}:${asset.id}:${hash}` : `${family}:${hash}`;
      if (locations.has(scopedHash) || pendingHashes.has(scopedHash)) continue;
      if (pendingSize + record.length > RECORD_PAGE_TARGET_BYTES) await flush();
      pendingFamily = family;
      pending.push(record);
      pendingKeys.push(scopedHash);
      pendingSize += record.length;
      pendingHashes.add(scopedHash);
    }
    plans.push({ asset, hashes, raw });
    if (isolated) await flush();
  }
  await flush();
  // A complete newer bootstrap must not inherit superseded records forever.
  // Replace only waste-bearing bootstrap pages when the startup byte budget
  // is exceeded; frozen predecessor pages and unrelated full pages stay intact.
  const bootstrapKeys = new Set(plans.filter(({ asset }) => (asset.family ?? 'bootstrap') === 'bootstrap')
    .flatMap(({ hashes }) => hashes));
  const bootstrapSelections = () => {
    const selected = new Map<string, Set<number>>();
    for (const key of bootstrapKeys) {
      const [hash, index] = locations.get(key)!;
      const indexes = selected.get(hash) ?? new Set<number>();
      indexes.add(index);
      selected.set(hash, indexes);
    }
    return selected;
  };
  let selections = bootstrapSelections();
  const physical = (hash: string) => pages.get(hash) ?? existing.get(hash)!.asset;
  while ([...selections.keys()].reduce((sum, hash) => sum + physical(hash).bytes, 0) > 10 * 1024 * 1024) {
    const candidates = [...selections].map(([hash, indexes]) => {
      const records = existingRecords.get(hash)!;
      const kept = [...indexes].sort((a, b) => a - b).map((index) => records[index]!);
      const bytes = gzipSync(encode(kept), { level: 9 });
      return { hash, kept, bytes, saved: physical(hash).bytes - bytes.length };
    }).filter((candidate) => candidate.saved > 0).sort((a, b) => b.saved - a.saved);
    const candidate = candidates[0];
    if (!candidate) break;
    const hash = digest(candidate.bytes);
    await writeFile(join(directory, hash), candidate.bytes);
    const asset = physical(candidate.hash);
    pages.set(hash, { ...asset, id: `page-${hash}`, sha256: hash, bytes: candidate.bytes.length,
      url: `${baseUrl.replace(/\/$/, '')}/assets/sha256/${hash}` });
    existingRecords.set(hash, candidate.kept);
    candidate.kept.forEach((record, index) => locations.set(`bootstrap:${digest(record)}`, [hash, index]));
    selections = bootstrapSelections();
  }
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
    Object.assign(asset, { segments: compactRecordPageSelections(segments), sha256: digest(raw), bytes: raw.length, encoding: 'identity', url: '' });
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
  for (const index of new Set(recordPageSelections(asset).map(([index]) => index))) {
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
