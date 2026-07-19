import { describe, expect, it } from 'vitest';
import { installOfflineAssets } from '../src/lib/offline';
import type { AssetDescriptor } from '../src/lib/types';

const assets: AssetDescriptor[] = Array.from({ length: 5 }, (_, index) => ({
  id: `asset-${index}`,
  url: `./asset-${index}`,
  bytes: 10 + index,
  sha256: `hash-${index}`,
  encoding: 'identity'
}));

describe('offline asset installation', () => {
  it('limits downloads to three and persists progressive completion', async () => {
    let active = 0;
    let maximum = 0;
    const persisted: number[] = [];
    const completed = await installOfflineAssets({
      assets,
      load: async (asset, progress) => {
        active++;
        maximum = Math.max(maximum, active);
        progress(asset.bytes);
        await Promise.resolve();
        active--;
      },
      persist: async (hashes) => {
        persisted.push(hashes.size);
      }
    });

    expect(maximum).toBe(3);
    expect(completed.size).toBe(5);
    expect(persisted).toHaveLength(5);
    expect(persisted.at(-1)).toBe(5);
  });

  it('resumes verified assets without loading them again', async () => {
    const loaded: string[] = [];
    await installOfflineAssets({
      assets,
      completedHashes: new Set(['hash-0', 'hash-3']),
      load: async (asset) => {
        loaded.push(asset.id);
      },
      persist: async () => {}
    });

    expect(loaded).toEqual(expect.arrayContaining(['asset-1', 'asset-2', 'asset-4']));
    expect(loaded).not.toContain('asset-0');
    expect(loaded).not.toContain('asset-3');
  });

  it('retries a failed asset at most three times', async () => {
    let calls = 0;
    await installOfflineAssets({
      assets: [assets[0]],
      load: async () => {
        calls++;
        if (calls < 3) throw new Error('temporary failure');
      },
      persist: async () => {},
      retryDelay: async () => {}
    });
    expect(calls).toBe(3);

    calls = 0;
    await expect(installOfflineAssets({
      assets: [assets[0]],
      load: async () => {
        calls++;
        throw new Error('permanent failure');
      },
      persist: async () => {},
      retryDelay: async () => {}
    })).rejects.toThrow('permanent failure');
    expect(calls).toBe(3);
  });

  it('cancels stale work while retaining completed assets', async () => {
    const controller = new AbortController();
    let saved = new Set<string>();
    const pending = installOfflineAssets({
      assets,
      concurrency: 1,
      signal: controller.signal,
      load: async (asset) => {
        if (asset.id === 'asset-1') controller.abort();
      },
      persist: async (hashes) => {
        saved = new Set(hashes);
      },
      retryDelay: async () => {}
    });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(saved).toEqual(new Set(['hash-0']));
  });

  it('reports aggregate byte progress without exceeding the pack size', async () => {
    const loadedBytes: number[] = [];
    await installOfflineAssets({
      assets: assets.slice(0, 2),
      load: async (asset, progress) => {
        progress(Math.floor(asset.bytes / 2));
        progress(asset.bytes);
      },
      persist: async () => {},
      onProgress: (progress) => loadedBytes.push(progress.loadedBytes)
    });

    expect(Math.max(...loadedBytes)).toBe(assets[0].bytes + assets[1].bytes);
    expect(Math.min(...loadedBytes)).toBeGreaterThanOrEqual(0);
  });
});
