import { decode } from '@msgpack/msgpack';
import type { AssetDescriptor } from './types';

export const RECORD_PAGE_TARGET_BYTES = 4 * 1024 * 1024;

/** A run of complete encoded values in an immutable compressed record page. */
export type RecordPageSelection = [pageIndex: number, first: number, count: number];

interface SelectionDescriptor { segments?: RecordPageSelection[] | string }
const selectionCache = new WeakMap<SelectionDescriptor, RecordPageSelection[]>();

/** Format-7 manifests store triples as unsigned varints in a base64 string. */
export function compactRecordPageSelections(selections: readonly RecordPageSelection[]): string {
  const bytes: number[] = [];
  for (const selection of selections) for (const value of selection) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Invalid record selection integer');
    let remaining = value;
    while (remaining >= 128) { bytes.push((remaining % 128) | 128); remaining = Math.floor(remaining / 128); }
    bytes.push(remaining);
  }
  return btoa(bytes.map((byte) => String.fromCharCode(byte)).join(''));
}

export function recordPageSelections(asset: SelectionDescriptor): RecordPageSelection[] {
  if (Array.isArray(asset.segments)) return asset.segments;
  if (asset.segments === undefined) return [];
  const cached = selectionCache.get(asset);
  if (cached) return cached;
  const encoded = atob(asset.segments);
  const numbers: number[] = [];
  let value = 0;
  let shift = 0;
  for (let index = 0; index < encoded.length; index++) {
    const byte = encoded.charCodeAt(index);
    value += (byte & 127) * 2 ** shift;
    if (value > 0xffffffff || shift > 28) throw new Error('Invalid packed record selection');
    if (byte & 128) { shift += 7; continue; }
    numbers.push(value);
    value = 0;
    shift = 0;
  }
  if (shift !== 0 || numbers.length % 3) throw new Error('Truncated packed record selection');
  const selections: RecordPageSelection[] = [];
  for (let index = 0; index < numbers.length; index += 3) selections.push([numbers[index]!, numbers[index + 1]!, numbers[index + 2]!]);
  selectionCache.set(asset, selections);
  return selections;
}

export interface LogicalAsset extends AssetDescriptor {
  segments?: RecordPageSelection[] | string;
}

export function decodeRecordPage(bytes: Uint8Array): Uint8Array[] {
  const value: unknown = decode(bytes);
  if (!Array.isArray(value) || !value.every((record) => record instanceof Uint8Array)) {
    throw new Error('Invalid record page: expected encoded record values');
  }
  if (value.length === 0 || (value.length > 1 && value.reduce((size, record) => size + record.length, 0) > RECORD_PAGE_TARGET_BYTES)) {
    throw new Error('Invalid record page: oversized pages must contain a single complete record');
  }
  return value;
}

export function assembleRecordPages(
  asset: LogicalAsset,
  pages: ReadonlyMap<number, readonly Uint8Array[]>
): Uint8Array {
  if (!asset.segments || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
    throw new Error(`${asset.id}: invalid logical asset`);
  }
  const output = new Uint8Array(asset.bytes);
  let offset = 0;
  for (const [hash, first, count] of recordPageSelections(asset)) {
    const records = pages.get(hash);
    if (!records || !Number.isSafeInteger(hash) || hash < 0 || !Number.isSafeInteger(first) || !Number.isSafeInteger(count)
      || first < 0 || count < 1 || first + count > records.length) {
      throw new Error(`${asset.id}: invalid record page selection`);
    }
    for (let index = first; index < first + count; index++) {
      const record = records[index]!;
      if (offset + record.length > output.length) throw new Error(`${asset.id}: record page size overflow`);
      output.set(record, offset);
      offset += record.length;
    }
  }
  if (offset !== output.length) throw new Error(`${asset.id}: incomplete record page selection`);
  return output;
}
