import 'fake-indexeddb/auto';
import { cacheAsset, getCachedAsset } from '../src/lib/storage';
import { fetchVerified } from '../src/lib/datasetAssets';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetDigest, verifyAssetBytesAsync } from '../src/lib/integrity';

afterEach(() => vi.unstubAllGlobals());
describe('asynchronous asset integrity', () => {
  it('verifies only the selected byte range with native SHA-256', async () => {
    const whole = new Uint8Array([99, 1, 2, 3, 88]);
    const bytes = whole.subarray(1, 4);
    const descriptor = { id: 'slice', bytes: 3, sha256: assetDigest(bytes) };
    await expect(verifyAssetBytesAsync(descriptor, bytes)).resolves.toBeUndefined();
    await expect(verifyAssetBytesAsync(descriptor, new Uint8Array([1, 2, 4]))).rejects.toThrow(
      'integrity check failed',
    );
    await expect(verifyAssetBytesAsync(descriptor, whole)).rejects.toThrow('size mismatch');
    expect(whole).toEqual(new Uint8Array([99, 1, 2, 3, 88]));
  });

  it('does not evict a valid cached asset when navigation aborts during native verification', async () => {
    const bytes = new Uint8Array([20, 30, 40]);
    const sha256 = assetDigest(bytes);
    await cacheAsset(sha256, bytes);
    const native = globalThis.crypto;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const digest = vi.fn(async (algorithm: AlgorithmIdentifier, input: BufferSource) => {
      await gate;
      return native.subtle.digest(algorithm, input);
    });
    vi.stubGlobal('crypto', { subtle: { digest } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const descriptor = {
      id: 'cached',
      bytes: bytes.length,
      sha256,
      encoding: 'identity' as const,
      url: 'cached.bin',
    };
    const controller = new AbortController();
    const pending = fetchVerified(
      descriptor,
      'https://fixture/manifest.json',
      undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(digest).toHaveBeenCalled());
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    release();
    await rejected;
    expect(await getCachedAsset(sha256)).toEqual(bytes);
    await expect(fetchVerified(descriptor, 'https://fixture/manifest.json')).resolves.toEqual(
      bytes,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains integrity verification when native crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    const bytes = new Uint8Array([7, 8, 9]);
    await expect(
      verifyAssetBytesAsync({ id: 'fallback', bytes: 3, sha256: assetDigest(bytes) }, bytes),
    ).resolves.toBeUndefined();
    await expect(
      verifyAssetBytesAsync({ id: 'fallback', bytes: 3, sha256: '0'.repeat(64) }, bytes),
    ).rejects.toThrow('integrity check failed');
  });
});
