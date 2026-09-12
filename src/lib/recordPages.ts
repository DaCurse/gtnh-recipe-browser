import { decode } from '@msgpack/msgpack';
import type { AssetDescriptor } from './types';

export const RECORD_PAGE_TARGET_BYTES = 2 * 1024 * 1024;

/** A run of complete encoded values in an immutable compressed record page. */
export type RecordPageSelection = [pageIndex: number, first: number, count: number];

export interface LogicalAsset extends AssetDescriptor {
  segments?: RecordPageSelection[];
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
  for (const [hash, first, count] of asset.segments) {
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
