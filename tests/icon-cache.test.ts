import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetDigest } from '../src/lib/integrity';
import { clearIconSheetCache, resolveIconSheetUrl } from '../src/lib/iconCache';
import { getCachedAsset, getDataset, saveDataset } from '../src/lib/storage';

describe('verified icon sheet cache', () => {
  afterEach(() => {
    clearIconSheetCache();
    vi.restoreAllMocks();
  });

  it('downloads an atlas once, persists it, and records its dataset usage', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sha256 = assetDigest(bytes);
    const datasetId = 'icon-cache-version';
    await saveDataset({
      datasetId,
      gtnhVersion: 'fixture',
      revision: 'r1',
      displayName: 'Fixture',
      manifestUrl: 'https://example.test/manifest.json',
      status: 'catalog',
      storedBytes: 0,
      totalBytes: bytes.byteLength,
      active: false,
      assetHashes: [],
      updatedAt: Date.now()
    });
    const fetchMock = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/webp' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const icon = {
      id: 'icons-0',
      url: 'https://example.test/icons.webp',
      bytes: bytes.byteLength,
      sha256,
      encoding: 'identity' as const,
      datasetId
    };

    await resolveIconSheetUrl(icon);
    await resolveIconSheetUrl(icon);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getCachedAsset(sha256)).toEqual(bytes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await getDataset(datasetId))?.assetHashes).toContain(sha256);
  });
});
