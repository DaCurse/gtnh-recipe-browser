import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';

const SHARED_ICON_SPRITE_SIZE = 32;
const SHARED_ICON_SHEET_COLUMNS = 32;
const SHARED_ICON_SHEET_ROWS = 32;
const SHARED_ICONS_PER_SHEET = SHARED_ICON_SHEET_COLUMNS * SHARED_ICON_SHEET_ROWS;
const SHARED_ICON_ATLAS_WIDTH = 256 * SHARED_ICON_SPRITE_SIZE;

const RGBA_CHANNELS = 4;
const SPRITE_BYTES = SHARED_ICON_SPRITE_SIZE * SHARED_ICON_SPRITE_SIZE * RGBA_CHANNELS;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// The source atlases are lossless WebP exports, but nearby rendering runs
// introduce sub-visible pixel noise even when an owner's texture is unchanged.
// Keep the old canonical pixels only within this deliberately strict bound.
const MAX_VISUAL_MEAN_CHANNEL_DIFFERENCE = 2;
const MAX_VISUAL_ALPHA_MEAN_DIFFERENCE = 0.5;
const MAX_VISUAL_SINGLE_CHANNEL_DIFFERENCE = 16;

type MaybePromise<T> = T | Promise<T>;

/** One catalog owner and the numeric cell in the upstream atlas. */
export interface SharedIconOwner {
  id: string;
  iconId: number;
}

/** A catalog reference to a frozen encoded sheet cell. */
interface SharedIconSlot {
  /** The full SHA-256 of the encoded sheet, not an owner or page ordinal. */
  sheetId: string;
  index: number;
  /** The full SHA-256 of canonical RGBA pixels in this cell. */
  spriteHash: string;
}

/**
 * Format-6-compatible icon asset metadata.
 *
 * The page contains `iconCount` used cells followed by transparent unused
 * cells. Unused cells are never filled after publication. The asset `id` is
 * the encoded-sheet hash; this makes the catalog slot and immutable object use
 * the same stable ID.
 */
export interface SharedIconSheetAsset {
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'identity';
  mediaType: 'image/webp';
  kind: 'iconSheet';
  iconCount: number;
  columns: 32;
  rows: 32;
  spriteSize: 32;
  /** Accepted while reading an early format-6 prototype; never emitted. */
  spriteHashes?: readonly (string | null)[];
}

/** The small part of a future manifest needed to reuse frozen icon pages. */
interface SharedIconManifest {
  iconSheets: readonly SharedIconSheetAsset[];
}

type SharedIconManifestLike =
  | SharedIconManifest
  | readonly SharedIconSheetAsset[];

/**
 * A previous pack and the local object-store location for its icon assets.
 * `assetPaths` is useful when a caller has already resolved manifest URLs;
 * keys may be a sheet ID, its SHA, or the basename of its URL.
 */
interface SharedIconPackSource {
  manifest: SharedIconManifestLike;
  /** Stable owner references read from this pack's catalog-icons asset. */
  ownerSlots?: ReadonlyMap<string, { sheetId: string; index: number }>;
  assetDirectory?: string;
  assetPaths?: ReadonlyMap<string, string>;
}

interface SharedIconAssetWriteRequest {
  sheetId: string;
  bytes: Buffer;
  reused: boolean;
  previous?: SharedIconSheetAsset;
}

/**
 * Store one complete sheet in the destination pack's immutable object store.
 * The callback is called for both new and reused sheets: a new manifest must
 * contain the complete reused asset and must not depend on an older manifest.
 */
type SharedIconAssetWriter = (
  request: SharedIconAssetWriteRequest
) => MaybePromise<{
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'identity';
  mediaType: 'image/webp';
}>;

export interface SharedIconBuildOptions {
  atlasPath: string;
  owners: readonly SharedIconOwner[];
  /** Previous manifests are ordered oldest-to-newest; the first slot wins. */
  previous?: readonly SharedIconPackSource[];
  /** Override path-based loading, and load only selected previous sheets. */
  readPreviousAsset?: (
    sheet: SharedIconSheetAsset,
    source: SharedIconPackSource
  ) => MaybePromise<Uint8Array>;
  /** Use the surrounding builder's content-addressed writer when supplied. */
  writeAsset?: SharedIconAssetWriter;
  /** Standalone writer destination, containing `assets/sha256/`. */
  outputDirectory?: string;
  /** URL prefix for the standalone writer; defaults to `.`. */
  baseUrl?: string;
}

interface SharedIconBuildStats {
  ownerCount: number;
  uniqueSpriteCount: number;
  reusedSpriteCount: number;
  newSpriteCount: number;
  selectedPreviousSheetCount: number;
  newSheetCount: number;
  assetBytes: number;
}

export interface SharedIconBuildResult {
  /** Only sheets targeted by this pack, including complete reused assets. */
  assets: SharedIconSheetAsset[];
  /** Every requested owner maps to a content-stable sheet hash and index. */
  slots: Map<string, SharedIconSlot>;
  /** Useful for catalog construction and diagnostics. */
  spriteHashes: Map<string, string>;
  stats: SharedIconBuildStats;
}

interface PreparedPreviousSheet {
  descriptor: SharedIconSheetAsset;
  spriteHashes: Array<string | null>;
  source: SharedIconPackSource;
  bytes: Buffer;
  spritePixels: Buffer[];
}

interface PreviousSpriteLocation {
  sheet: PreparedPreviousSheet;
  index: number;
}

interface PlannedSheet {
  sheetId: string;
  bytes: Buffer;
  spriteHashes: Array<string | null>;
  iconCount: number;
  reused: boolean;
  previous?: SharedIconSheetAsset;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertSheetGeometry(sheet: SharedIconSheetAsset): void {
  if (sheet.kind !== 'iconSheet'
    || sheet.encoding !== 'identity'
    || sheet.mediaType !== 'image/webp'
    || sheet.columns !== SHARED_ICON_SHEET_COLUMNS
    || sheet.rows !== SHARED_ICON_SHEET_ROWS
    || sheet.spriteSize !== SHARED_ICON_SPRITE_SIZE
    || !Number.isInteger(sheet.iconCount)
    || sheet.iconCount < 0
    || sheet.iconCount > SHARED_ICONS_PER_SHEET) {
    throw new Error(`Invalid shared icon sheet geometry for ${String(sheet.id)}`);
  }
}

function declaredSheetHashes(sheet: SharedIconSheetAsset): Array<string | null | undefined> | undefined {
  assertSheetGeometry(sheet);
  assertSha256(sheet.sha256, `Shared icon sheet ${sheet.id} sha256`);
  if (typeof sheet.id !== 'string' || sheet.id.length === 0) {
    throw new Error('Shared icon sheet ID must not be empty');
  }
  if (sheet.spriteHashes === undefined) return undefined;
  if (!Array.isArray(sheet.spriteHashes) || sheet.spriteHashes.length > SHARED_ICONS_PER_SHEET) {
    throw new Error(`Shared icon sheet ${sheet.id} must declare at most ${SHARED_ICONS_PER_SHEET} sprite hashes`);
  }
  const result: Array<string | null | undefined> = [];
  for (let index = 0; index < SHARED_ICONS_PER_SHEET; index++) {
    const value = sheet.spriteHashes[index];
    if (value !== undefined && value !== null) {
      assertSha256(value, `Shared icon sheet ${sheet.id} sprite hash ${index}`);
    }
    result.push(value);
  }
  return result;
}

function sourceSheets(source: SharedIconPackSource): readonly SharedIconSheetAsset[] {
  if (Array.isArray(source.manifest)) return source.manifest as readonly SharedIconSheetAsset[];
  return (source.manifest as SharedIconManifest).iconSheets;
}

function sameHashes(left: readonly (string | null | undefined)[], right: readonly (string | null | undefined)[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function preparePreviousSheets(
  sources: readonly SharedIconPackSource[],
  options: SharedIconBuildOptions
): Promise<{
  sheets: PreparedPreviousSheet[];
  bySha: Map<string, PreparedPreviousSheet>;
  bySpriteHash: Map<string, PreviousSpriteLocation>;
}> {
  const sheets: PreparedPreviousSheet[] = [];
  const bySha = new Map<string, PreparedPreviousSheet>();
  const bySpriteHash = new Map<string, PreviousSpriteLocation>();
  for (const source of sources) {
    for (const descriptor of sourceSheets(source)) {
      declaredSheetHashes(descriptor);
      const existing = bySha.get(descriptor.sha256);
      if (existing) {
        continue;
      }
      const prepared: PreparedPreviousSheet = {
        descriptor,
        spriteHashes: [],
        source,
        bytes: Buffer.alloc(0),
        spritePixels: []
      };
      prepared.bytes = await readPreviousSheet(prepared, options);
      bySha.set(descriptor.sha256, prepared);
      sheets.push(prepared);
      for (let index = 0; index < prepared.spriteHashes.length; index++) {
        const spriteHash = prepared.spriteHashes[index];
        if (spriteHash !== null && !bySpriteHash.has(spriteHash)) {
          bySpriteHash.set(spriteHash, { sheet: prepared, index });
        }
      }
    }
  }
  return { sheets, bySha, bySpriteHash };
}

/**
 * Canonicalize a 32x32 RGBA sprite before hashing it. RGB in fully transparent
 * pixels is not visually observable and some lossless WebP paths normalize it;
 * zeroing it makes content identity match the verifier's visible-pixel rule.
 */
export function canonicalSharedIconPixels(pixels: Uint8Array): Buffer {
  if (pixels.byteLength !== SPRITE_BYTES) {
    throw new Error(`Shared icon sprite must contain exactly ${SPRITE_BYTES} RGBA bytes`);
  }
  const result = Buffer.from(pixels);
  for (let offset = 0; offset < result.length; offset += RGBA_CHANNELS) {
    if (result[offset + 3] === 0) {
      result[offset] = 0;
      result[offset + 1] = 0;
      result[offset + 2] = 0;
    }
  }
  return result;
}

/** SHA-256 of the canonical RGBA bytes stored in a sprite cell. */
export function sharedIconPixelHash(pixels: Uint8Array): string {
  return sha256(canonicalSharedIconPixels(pixels));
}

/** True when two exported sprites differ only within the measured renderer noise floor. */
export function sharedIconPixelsEquivalent(left: Uint8Array, right: Uint8Array): boolean {
  const canonicalLeft = canonicalSharedIconPixels(left);
  const canonicalRight = canonicalSharedIconPixels(right);
  let total = 0;
  let alpha = 0;
  let maximum = 0;
  for (let index = 0; index < canonicalLeft.length; index++) {
    const difference = Math.abs(canonicalLeft[index]! - canonicalRight[index]!);
    total += difference;
    maximum = Math.max(maximum, difference);
    if (index % 4 === 3) alpha += difference;
  }
  return total / canonicalLeft.length <= MAX_VISUAL_MEAN_CHANNEL_DIFFERENCE
    && alpha / (canonicalLeft.length / 4) <= MAX_VISUAL_ALPHA_MEAN_DIFFERENCE
    && maximum <= MAX_VISUAL_SINGLE_CHANNEL_DIFFERENCE;
}

function extractSprite(raw: Uint8Array, width: number, iconId: number): Buffer {
  const sourceX = (iconId % 256) * SHARED_ICON_SPRITE_SIZE;
  const sourceY = Math.floor(iconId / 256) * SHARED_ICON_SPRITE_SIZE;
  const result = Buffer.alloc(SPRITE_BYTES);
  for (let row = 0; row < SHARED_ICON_SPRITE_SIZE; row++) {
    const sourceStart = ((sourceY + row) * width + sourceX) * RGBA_CHANNELS;
    result.set(
      raw.subarray(sourceStart, sourceStart + SPRITE_BYTES / SHARED_ICON_SPRITE_SIZE),
      row * SPRITE_BYTES / SHARED_ICON_SPRITE_SIZE
    );
  }
  return canonicalSharedIconPixels(result);
}

function extractSheetCell(raw: Uint8Array, width: number, index: number): Buffer {
  const sourceX = (index % SHARED_ICON_SHEET_COLUMNS) * SHARED_ICON_SPRITE_SIZE;
  const sourceY = Math.floor(index / SHARED_ICON_SHEET_COLUMNS) * SHARED_ICON_SPRITE_SIZE;
  const result = Buffer.alloc(SPRITE_BYTES);
  for (let row = 0; row < SHARED_ICON_SPRITE_SIZE; row++) {
    const sourceStart = ((sourceY + row) * width + sourceX) * RGBA_CHANNELS;
    result.set(
      raw.subarray(sourceStart, sourceStart + SPRITE_BYTES / SHARED_ICON_SPRITE_SIZE),
      row * SPRITE_BYTES / SHARED_ICON_SPRITE_SIZE
    );
  }
  return canonicalSharedIconPixels(result);
}

async function encodeSpritePage(
  hashes: readonly string[],
  pixelsByHash: ReadonlyMap<string, Buffer>
): Promise<Buffer> {
  const page = Buffer.alloc(
    SHARED_ICON_SHEET_COLUMNS * SHARED_ICON_SHEET_ROWS
      * SHARED_ICON_SPRITE_SIZE * SHARED_ICON_SPRITE_SIZE * RGBA_CHANNELS
  );
  for (let index = 0; index < hashes.length; index++) {
    const pixels = pixelsByHash.get(hashes[index]!);
    if (!pixels) throw new Error(`No pixels available for new shared icon ${hashes[index]}`);
    for (let row = 0; row < SHARED_ICON_SPRITE_SIZE; row++) {
      const sourceStart = row * SPRITE_BYTES / SHARED_ICON_SPRITE_SIZE;
      const targetX = (index % SHARED_ICON_SHEET_COLUMNS) * SHARED_ICON_SPRITE_SIZE;
      const targetY = Math.floor(index / SHARED_ICON_SHEET_COLUMNS) * SHARED_ICON_SPRITE_SIZE;
      const targetStart = ((targetY + row)
        * SHARED_ICON_SHEET_COLUMNS * SHARED_ICON_SPRITE_SIZE
        + targetX) * RGBA_CHANNELS;
      pixels.copy(page, targetStart, sourceStart, sourceStart + SPRITE_BYTES / SHARED_ICON_SPRITE_SIZE);
    }
  }
  return sharp(page, {
    raw: {
      width: SHARED_ICON_SHEET_COLUMNS * SHARED_ICON_SPRITE_SIZE,
      height: SHARED_ICON_SHEET_ROWS * SHARED_ICON_SPRITE_SIZE,
      channels: RGBA_CHANNELS
    }
  }).webp({ lossless: true, effort: 6 }).toBuffer();
}

function assetPathCandidates(
  source: SharedIconPackSource,
  sheet: SharedIconSheetAsset
): string[] {
  const paths: string[] = [];
  const keys = [sheet.sha256, sheet.id, basenameFromUrl(sheet.url)];
  for (const key of keys) {
    if (!key) continue;
    const direct = source.assetPaths?.get(key);
    if (direct) paths.push(direct);
  }
  if (source.assetDirectory) {
    paths.push(join(source.assetDirectory, sheet.sha256));
    paths.push(join(source.assetDirectory, 'assets', 'sha256', sheet.sha256));
    const urlBasename = basenameFromUrl(sheet.url);
    if (urlBasename) paths.push(join(source.assetDirectory, urlBasename));
  }
  return [...new Set(paths)];
}

function basenameFromUrl(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return basename(new URL(value, 'https://shared-icons.invalid/').pathname);
  } catch {
    return undefined;
  }
}

async function readPreviousSheet(
  sheet: PreparedPreviousSheet,
  options: SharedIconBuildOptions
): Promise<Buffer> {
  const bytes = options.readPreviousAsset
    ? Buffer.from(await options.readPreviousAsset(sheet.descriptor, sheet.source))
    : await (async () => {
      const candidates = assetPathCandidates(sheet.source, sheet.descriptor);
      if (candidates.length === 0) {
        throw new Error(
          `No local path for reused shared icon sheet ${sheet.descriptor.sha256}; `
          + 'provide assetDirectory, assetPaths, or readPreviousAsset'
        );
      }
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          return await readFile(candidate);
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`Unable to read reused shared icon sheet ${sheet.descriptor.sha256}`, { cause: lastError });
    })();
  if (sha256(bytes) !== sheet.descriptor.sha256) {
    throw new Error(`Reused shared icon sheet ${sheet.descriptor.sha256} failed SHA-256 validation`);
  }
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expectedSize = SHARED_ICON_SHEET_COLUMNS * SHARED_ICON_SPRITE_SIZE;
  if (decoded.info.width !== expectedSize || decoded.info.height !== expectedSize || decoded.info.channels !== RGBA_CHANNELS) {
    throw new Error(
      `Reused shared icon sheet ${sheet.descriptor.sha256} is not ${expectedSize}x${expectedSize} RGBA`
    );
  }
  const derivedHashes: Array<string | null> = Array.from(
    { length: SHARED_ICONS_PER_SHEET },
    () => null
  );
  for (let index = 0; index < sheet.descriptor.iconCount; index++) {
    const pixels = extractSheetCell(decoded.data, decoded.info.width, index);
    sheet.spritePixels[index] = pixels;
    derivedHashes[index] = sharedIconPixelHash(pixels);
  }
  const declaredHashes = declaredSheetHashes(sheet.descriptor);
  if (declaredHashes) {
    for (let index = 0; index < sheet.descriptor.iconCount; index++) {
      const declared = declaredHashes[index];
      if (declared !== undefined && declared !== null && declared !== derivedHashes[index]) {
        throw new Error(
          `Reused shared icon sheet ${sheet.descriptor.sha256} cell ${index} `
          + `has derived hash ${derivedHashes[index]}, expected ${declared}`
        );
      }
    }
  }
  sheet.spriteHashes = derivedHashes;
  return bytes;
}

function standaloneAssetWriter(
  outputDirectory: string,
  baseUrl: string
): SharedIconAssetWriter {
  return async ({ sheetId, bytes }) => {
    const assetsDirectory = join(outputDirectory, 'assets', 'sha256');
    await mkdir(assetsDirectory, { recursive: true });
    const path = join(assetsDirectory, sheetId);
    try {
      await writeFile(path, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(path);
      if (sha256(existing) !== sheetId) {
        throw new Error(`Shared icon object collision at ${sheetId}`, { cause: error });
      }
    }
    const base = baseUrl.replace(/\/+$/, '') || '.';
    return {
      url: `${base}/assets/sha256/${sheetId}`,
      bytes: bytes.byteLength,
      sha256: sheetId,
      encoding: 'identity',
      mediaType: 'image/webp'
    };
  };
}

function chooseWriter(options: SharedIconBuildOptions): SharedIconAssetWriter {
  if (options.writeAsset && options.outputDirectory) {
    throw new Error('Specify only one of writeAsset and outputDirectory');
  }
  if (options.writeAsset) return options.writeAsset;
  if (options.outputDirectory) return standaloneAssetWriter(options.outputDirectory, options.baseUrl ?? '.');
  throw new Error('Shared icon building requires writeAsset or outputDirectory');
}

function ownerMap(owners: readonly SharedIconOwner[]): Map<string, SharedIconOwner> {
  const result = new Map<string, SharedIconOwner>();
  for (const owner of owners) {
    if (typeof owner.id !== 'string' || owner.id.length === 0) {
      throw new Error('Shared icon owner ID must not be empty');
    }
    if (!Number.isInteger(owner.iconId) || owner.iconId < 0) {
      throw new Error(`Shared icon owner ${owner.id} has an invalid atlas icon ID ${String(owner.iconId)}`);
    }
    const existing = result.get(owner.id);
    if (existing && existing.iconId !== owner.iconId) {
      throw new Error(`Shared icon owner ${owner.id} has conflicting atlas icon IDs`);
    }
    result.set(owner.id, owner);
  }
  return result;
}

function buildSheetAsset(
  sheet: PlannedSheet,
  storage: Awaited<ReturnType<SharedIconAssetWriter>>
): SharedIconSheetAsset {
  if (storage.sha256 !== sheet.sheetId
    || storage.bytes !== sheet.bytes.byteLength
    || storage.encoding !== 'identity'
    || storage.mediaType !== 'image/webp') {
    throw new Error(`Icon writer returned invalid storage metadata for ${sheet.sheetId}`);
  }
  return {
    id: sheet.sheetId,
    url: storage.url,
    bytes: sheet.bytes.byteLength,
    sha256: sheet.sheetId,
    encoding: 'identity',
    mediaType: 'image/webp',
    kind: 'iconSheet',
    iconCount: sheet.iconCount,
    columns: SHARED_ICON_SHEET_COLUMNS,
    rows: SHARED_ICON_SHEET_ROWS,
    spriteSize: SHARED_ICON_SPRITE_SIZE
  };
}

/**
 * Build a content-addressed, append-only icon pool for one dataset.
 *
 * Existing sprite hashes retain their first published sheet/index. Existing
 * sheets are never edited or filled. Missing hashes are packed in their first
 * occurrence order in the numeric source atlas, preserving WebP locality while
 * a later dataset appends pages without changing any prior catalog reference.
 * Only sheets needed by the current owner set are returned, although previous
 * sheets must be decoded once to derive their unpublished cell hashes.
 */
export async function buildSharedIcons(options: SharedIconBuildOptions): Promise<SharedIconBuildResult> {
  const owners = ownerMap(options.owners);
  if (owners.size === 0) {
    return {
      assets: [],
      slots: new Map(),
      spriteHashes: new Map(),
      stats: {
        ownerCount: 0,
        uniqueSpriteCount: 0,
        reusedSpriteCount: 0,
        newSpriteCount: 0,
        selectedPreviousSheetCount: 0,
        newSheetCount: 0,
        assetBytes: 0
      }
    };
  }

  const writer = chooseWriter(options);
  const { data: atlas, info: atlasInfo } = await sharp(options.atlasPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (atlasInfo.width !== SHARED_ICON_ATLAS_WIDTH || atlasInfo.channels !== RGBA_CHANNELS) {
    throw new Error(
      `Expected an ${SHARED_ICON_ATLAS_WIDTH}px-wide RGBA atlas, got `
      + `${atlasInfo.width}x${atlasInfo.height} with ${atlasInfo.channels} channels`
    );
  }
  const maxIconId = Math.max(...[...owners.values()].map((owner) => owner.iconId));
  const requiredHeight = (Math.floor(maxIconId / 256) + 1) * SHARED_ICON_SPRITE_SIZE;
  if (atlasInfo.height < requiredHeight) {
    throw new Error(`Atlas height ${atlasInfo.height} cannot contain icon ${maxIconId}`);
  }

  const pixelsByHash = new Map<string, Buffer>();
  const firstIconIdByHash = new Map<string, number>();
  const hashByOwner = new Map<string, string>();
  const pixelsByIconId = new Map<number, { hash: string; pixels: Buffer }>();
  for (const owner of [...owners.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    let source = pixelsByIconId.get(owner.iconId);
    if (!source) {
      const pixels = extractSprite(atlas, atlasInfo.width, owner.iconId);
      source = { hash: sharedIconPixelHash(pixels), pixels };
      pixelsByIconId.set(owner.iconId, source);
      if (!pixelsByHash.has(source.hash)) {
        pixelsByHash.set(source.hash, source.pixels);
        firstIconIdByHash.set(source.hash, owner.iconId);
      }
    }
    hashByOwner.set(owner.id, source.hash);
  }

  const previous = await preparePreviousSheets(options.previous ?? [], options);
  const newHashes: string[] = [];
  const locationByHash = new Map<string, PreviousSpriteLocation>();
  const newLocationByHash = new Map<string, { sheetId: string; index: number }>();
  const selectedPrevious = new Map<string, PreparedPreviousSheet>();
  let reusedSpriteCount = 0;
  const sourceHashes = [...pixelsByHash.keys()].sort((left, right) => (
    firstIconIdByHash.get(left)! - firstIconIdByHash.get(right)!
      || left.localeCompare(right)
  ));
  const ownersByHash = new Map<string, string[]>();
  for (const [ownerId, hash] of hashByOwner) {
    const ids = ownersByHash.get(hash) ?? [];
    ids.push(ownerId);
    ownersByHash.set(hash, ids);
  }
  for (const spriteHash of sourceHashes) {
    let location = previous.bySpriteHash.get(spriteHash);
    if (!location) {
      const currentPixels = pixelsByHash.get(spriteHash)!;
      for (const ownerId of ownersByHash.get(spriteHash) ?? []) {
        for (const source of options.previous ?? []) {
          const slot = source.ownerSlots?.get(ownerId);
          const sheet = slot ? previous.bySha.get(slot.sheetId) : undefined;
          const priorPixels = sheet && slot ? sheet.spritePixels[slot.index] : undefined;
          if (sheet && slot && priorPixels && sharedIconPixelsEquivalent(currentPixels, priorPixels)) {
            location = { sheet, index: slot.index };
            break;
          }
        }
        if (location) break;
      }
    }
    if (location) {
      reusedSpriteCount++;
      locationByHash.set(spriteHash, location);
      selectedPrevious.set(location.sheet.descriptor.sha256, location.sheet);
    } else {
      newHashes.push(spriteHash);
    }
  }

  const planned: PlannedSheet[] = [];
  for (const sheet of [...selectedPrevious.values()].sort((left, right) => (
    left.descriptor.sha256.localeCompare(right.descriptor.sha256)
  ))) {
    planned.push({
      sheetId: sheet.descriptor.sha256,
      bytes: sheet.bytes,
      spriteHashes: sheet.spriteHashes,
      iconCount: sheet.descriptor.iconCount,
      reused: true,
      previous: sheet.descriptor
    });
  }

  for (let offset = 0; offset < newHashes.length; offset += SHARED_ICONS_PER_SHEET) {
    const pageHashes = newHashes.slice(offset, offset + SHARED_ICONS_PER_SHEET);
    const bytes = await encodeSpritePage(pageHashes, pixelsByHash);
    const sheetId = sha256(bytes);
    for (let index = 0; index < pageHashes.length; index++) {
      newLocationByHash.set(pageHashes[index]!, { sheetId, index });
    }
    planned.push({
      sheetId,
      bytes,
      spriteHashes: [
        ...pageHashes,
        ...Array.from({ length: SHARED_ICONS_PER_SHEET - pageHashes.length }, () => null)
      ],
      iconCount: pageHashes.length,
      reused: false
    });
  }

  const assets: SharedIconSheetAsset[] = [];
  const plannedById = new Map<string, PlannedSheet>();
  const assetById = new Map<string, SharedIconSheetAsset>();
  for (const sheet of planned) {
    const existingPlan = plannedById.get(sheet.sheetId);
    if (existingPlan) {
      if (existingPlan.iconCount !== sheet.iconCount
        || !sameHashes(existingPlan.spriteHashes, sheet.spriteHashes)) {
        throw new Error(`Different shared icon pages have the same SHA-256 ${sheet.sheetId}`);
      }
      continue;
    }
    plannedById.set(sheet.sheetId, sheet);
    const existing = assetById.get(sheet.sheetId);
    if (existing) {
      continue;
    }
    const storage = await writer({
      sheetId: sheet.sheetId,
      bytes: sheet.bytes,
      reused: sheet.reused,
      ...(sheet.previous ? { previous: sheet.previous } : {})
    });
    const asset = buildSheetAsset(sheet, storage);
    assetById.set(sheet.sheetId, asset);
    assets.push(asset);
  }

  const slots = new Map<string, SharedIconSlot>();
  for (const [ownerId, spriteHash] of hashByOwner) {
    const previousLocation = locationByHash.get(spriteHash);
    if (previousLocation) {
      slots.set(ownerId, {
        sheetId: previousLocation.sheet.descriptor.sha256,
        index: previousLocation.index,
        spriteHash
      });
      continue;
    }
    const location = newLocationByHash.get(spriteHash);
    if (!location) throw new Error(`No generated shared icon page contains ${spriteHash}`);
    const pageAsset = assetById.get(location.sheetId);
    if (!pageAsset) {
      throw new Error(`No generated shared icon page contains ${spriteHash}`);
    }
    slots.set(ownerId, { sheetId: pageAsset.id, index: location.index, spriteHash });
  }

  return {
    assets,
    slots,
    spriteHashes: hashByOwner,
    stats: {
      ownerCount: owners.size,
      uniqueSpriteCount: new Set(hashByOwner.values()).size,
      reusedSpriteCount,
      newSpriteCount: newHashes.length,
      selectedPreviousSheetCount: selectedPrevious.size,
      newSheetCount: planned.filter((sheet) => !sheet.reused).length,
      assetBytes: assets.reduce((total, asset) => total + asset.bytes, 0)
    }
  };
}
