import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { AssetDescriptor } from './types';

export function assetDigest(bytes: Uint8Array): string {
  return bytesToHex(nobleSha256(bytes));
}

export function verifyAssetBytes(asset: Pick<AssetDescriptor, 'id' | 'bytes' | 'sha256'>, bytes: Uint8Array): void {
  if (bytes.byteLength !== asset.bytes) throw new Error(`${asset.id}: size mismatch`);
  if (assetDigest(bytes) !== asset.sha256) throw new Error(`${asset.id}: integrity check failed`);
}
