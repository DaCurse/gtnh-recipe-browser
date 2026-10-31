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

/** Native SHA-256 avoids blocking the main thread on multi-megabyte pages. */
export async function verifyAssetBytesAsync(
  asset: Pick<AssetDescriptor, 'id' | 'bytes' | 'sha256'>,
  bytes: Uint8Array
): Promise<void> {
  if (bytes.byteLength !== asset.bytes) throw new Error(`${asset.id}: size mismatch`);
  if (!globalThis.crypto?.subtle) {
    verifyAssetBytes(asset, bytes);
    return;
  }
  const input = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);
  const hash = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)));
  if (hash !== asset.sha256) throw new Error(`${asset.id}: integrity check failed`);
}
