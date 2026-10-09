import type { CatalogSearchDocument } from './catalogSearch';
import type { materializeCatalog } from './catalogMaterialization';
import type { DatasetManifest, PackedCatalog, PackedRecipeType, PackedOreDictionary, PackedIngredientGroup } from './datasetSchema';
import { assetDigest } from './integrity';
import { mapProgressively } from './progressive';
import { cacheRuntimeData, getRuntimeCache } from './storage';
import type { CatalogBrowseEntry, CatalogEntry } from './types';

type CachedEntry = Omit<CatalogEntry, 'icon'> & { icon?: [number, number] };
type SheetIcon = Omit<NonNullable<CatalogEntry['icon']>, 'index'>;
type BrowseRow = Pick<CatalogBrowseEntry, 'id' | 'variantIds' | 'variantCount' | 'variantKind' | 'variantLabels'>;
export interface PreparedCatalog {
  resolved: Pick<ReturnType<typeof materializeCatalog>, 'entries' | 'recipeTypes' | 'ingredientGroups'>;
  browseRows: BrowseRow[];
  specialViewTypes: PackedCatalog['specialViewTypes'];
  specialServiceIcons: PackedCatalog['specialServiceIcons'];
}
interface PreparedHeader {
  entryChunks: number;
  entryCount: number;
  icons: SheetIcon[];
  recipeTypes: Array<[string, PackedRecipeType]>;
  groupCount: number;
  browseCount: number;
  specialViewTypes: PreparedCatalog['specialViewTypes'];
  specialServiceIcons: PreparedCatalog['specialServiceIcons'];
}
const CHUNK_SIZE = 2_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function encodeJson(value: unknown): ArrayBuffer {
  return encoder.encode(JSON.stringify(value)).buffer;
}
function decodeJson<T>(value: ArrayBuffer): T {
  return JSON.parse(decoder.decode(value)) as T;
}

// Bump when materialization, variant grouping, or search normalization changes.
export function preparedCatalogKey(manifest: DatasetManifest, manifestUrl: string): string {
  return `prepared-v5:${assetDigest(new TextEncoder().encode(JSON.stringify([manifestUrl, manifest])))}`;
}

/** Small JSON records avoid huge, blocking native structured-clone operations on slow devices. */
export async function cachePreparedCatalog(datasetId: string, key: string, prepared: PreparedCatalog): Promise<void> {
  const entries = prepared.resolved.entries;
  const entryChunks = Math.ceil(entries.length / CHUNK_SIZE);
  const icons: SheetIcon[] = [];
  const iconIndices = new Map<string, number>();
  const packEntry = ({ icon, ...entry }: CatalogEntry): CachedEntry => {
    if (!icon) return entry;
    const { index, ...descriptor } = icon;
    const identity = icon.sha256 ?? icon.url;
    let sheet = iconIndices.get(identity);
    if (sheet === undefined) {
      sheet = icons.length;
      iconIndices.set(identity, sheet);
      icons.push(descriptor);
    }
    return { ...entry, icon: [sheet, index] };
  };
  for (let chunk = 0; chunk < entryChunks; chunk++) {
    // Let the grid paint and respond between cache writes. Never block first use on persistence.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!await cacheRuntimeData(datasetId, `${key}:entries:${chunk}`, encodeJson(entries.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE).map(packEntry)))) return;
  }
  // Commit the header last. Interrupted or quota-limited writes cannot acknowledge a complete snapshot.
  const groups = [...prepared.resolved.ingredientGroups];
  for (const [family, rows] of [['groups', groups], ['browse', prepared.browseRows]] as const) {
    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!await cacheRuntimeData(datasetId, `${key}:${family}:${start}`, encodeJson(rows.slice(start, start + CHUNK_SIZE)))) return;
    }
  }
  await cacheRuntimeData(datasetId, key, encodeJson({
    entryChunks, entryCount: entries.length, icons,
    recipeTypes: [...prepared.resolved.recipeTypes], groupCount: groups.length, browseCount: prepared.browseRows.length,
    specialViewTypes: prepared.specialViewTypes, specialServiceIcons: prepared.specialServiceIcons
  } satisfies PreparedHeader));
}

export async function getPreparedCatalog(datasetId: string, key: string): Promise<PreparedCatalog | null> {
  try {
    const saved = await getRuntimeCache<ArrayBuffer>(datasetId, key);
    if (!(saved instanceof ArrayBuffer)) return null;
    const header = decodeJson<PreparedHeader>(saved);
    if (!Number.isSafeInteger(header.entryChunks) || header.entryChunks < 1
      || !Number.isSafeInteger(header.entryCount) || header.entryCount < 1
      || header.entryChunks !== Math.ceil(header.entryCount / CHUNK_SIZE)
      || !Array.isArray(header.icons) || !Array.isArray(header.recipeTypes) || !Number.isSafeInteger(header.groupCount) || header.groupCount < 0
      || !Number.isSafeInteger(header.browseCount) || header.browseCount < 1) return null;
    const chunks = await mapProgressively(Array.from({ length: header.entryChunks }, (_, index) => index), 3, async (index) => {
      const value = await getRuntimeCache<ArrayBuffer>(datasetId, `${key}:entries:${index}`);
      if (!(value instanceof ArrayBuffer)) throw new Error('Incomplete prepared catalog');
      const entries = decodeJson<CachedEntry[]>(value);
      if (!Array.isArray(entries) || entries.length !== Math.min(CHUNK_SIZE, header.entryCount - index * CHUNK_SIZE)) {
        throw new Error('Invalid prepared catalog chunk');
      }
      return entries.map(({ icon, ...entry }): CatalogEntry => {
        if (!icon) return entry;
        const descriptor = header.icons[icon[0]];
        if (!descriptor || !Number.isSafeInteger(icon[1]) || icon[1] < 0) throw new Error('Invalid prepared icon');
        return { ...entry, icon: { ...descriptor, index: icon[1] } };
      });
    });
    const readRows = async <T>(family: string, count: number): Promise<T[]> => {
      const batches = await mapProgressively(Array.from({ length: Math.ceil(count / CHUNK_SIZE) }, (_, index) => index * CHUNK_SIZE), 3, async (start) => {
        const saved = await getRuntimeCache<ArrayBuffer>(datasetId, `${key}:${family}:${start}`);
        if (!(saved instanceof ArrayBuffer)) throw new Error('Incomplete prepared catalog');
        const rows = decodeJson<T[]>(saved);
        if (!Array.isArray(rows) || rows.length !== Math.min(CHUNK_SIZE, count - start)) throw new Error('Invalid prepared catalog rows');
        return rows;
      });
      return batches.flat();
    };
    const groups = await readRows<[string, PackedOreDictionary | PackedIngredientGroup]>('groups', header.groupCount);
    const browseRows = await readRows<BrowseRow>('browse', header.browseCount);
    return {
      resolved: { entries: chunks.flat(), recipeTypes: new Map(header.recipeTypes), ingredientGroups: new Map(groups) },
      browseRows, specialViewTypes: header.specialViewTypes, specialServiceIcons: header.specialServiceIcons
    };
  } catch {
    return null;
  }
}

export async function cachePreparedSearch(datasetId: string, key: string, documents: CatalogSearchDocument[]): Promise<void> {
  for (let start = 0; start < documents.length; start += CHUNK_SIZE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!await cacheRuntimeData(datasetId, `${key}:search:${start}`, encodeJson(documents.slice(start, start + CHUNK_SIZE)))) return;
  }
  await cacheRuntimeData(datasetId, `${key}:search`, documents.length);
}

export async function getPreparedSearch(datasetId: string, key: string, count: number): Promise<CatalogSearchDocument[] | null> {
  if (await getRuntimeCache<number>(datasetId, `${key}:search`) !== count) return null;
  try {
    const chunks = await mapProgressively(Array.from({ length: Math.ceil(count / CHUNK_SIZE) }, (_, index) => index * CHUNK_SIZE), 3, async (start) => {
      const saved = await getRuntimeCache<ArrayBuffer>(datasetId, `${key}:search:${start}`);
      if (!(saved instanceof ArrayBuffer)) throw new Error('Incomplete prepared search');
      const documents = decodeJson<CatalogSearchDocument[]>(saved);
      if (!Array.isArray(documents) || documents.length !== Math.min(CHUNK_SIZE, count - start)) throw new Error('Invalid prepared search');
      return documents;
    });
    return chunks.flat();
  } catch {
    return null;
  }
}
