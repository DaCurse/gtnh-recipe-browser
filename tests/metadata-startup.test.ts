import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonNetworkFirst } from '../src/lib/datasetAssets';
import { cacheMetadata, getCachedMetadata } from '../src/lib/storage';

vi.mock('../src/lib/storage', () => ({
  cacheMetadata: vi.fn(),
  getCachedMetadata: vi.fn(),
  cacheAsset: vi.fn(),
  getCachedAsset: vi.fn(),
  removeCachedAsset: vi.fn()
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('cached startup metadata', () => {
  it('returns cached metadata within its budget while saving a later successful revalidation', async () => {
    vi.useFakeTimers();
    const saved = { url: 'https://example.test/versions.json', value: { epoch: 1 } };
    vi.mocked(getCachedMetadata).mockResolvedValue(saved);
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const loading = fetchJsonNetworkFirst(saved.url, 'versions', 150);
    await vi.advanceTimersByTimeAsync(150);
    expect(await loading).toEqual(saved);
    finish(new Response(JSON.stringify({ epoch: 2 })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cacheMetadata).toHaveBeenCalledWith('versions', saved.url, { epoch: 2 });
  });

  it('waits for a fresh network result when there is no saved metadata', async () => {
    vi.mocked(getCachedMetadata).mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ epoch: 3 }))));
    expect(await fetchJsonNetworkFirst('https://example.test/new.json', 'new', 0))
      .toEqual({ url: 'https://example.test/new.json', value: { epoch: 3 } });
  });

  it('retains cached metadata when revalidation fails', async () => {
    const cached = { url: 'https://example.test/offline.json', value: { version: 'RC1' } };
    vi.mocked(getCachedMetadata).mockResolvedValue(cached);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchJsonNetworkFirst(cached.url, 'offline', 150)).toEqual(cached);
  });
});
