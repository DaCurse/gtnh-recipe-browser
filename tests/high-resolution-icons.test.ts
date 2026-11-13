import { beforeEach, describe, expect, it, vi } from 'vitest';
import registry from '../src/lib/generated/high-resolution-icons.json';
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  sheet: vi.fn(),
  record: vi.fn(),
  decode: vi.fn(),
  epoch: vi.fn(),
}));
vi.mock('../src/lib/datasetAssets', () => ({
  fetchVerified: mocks.fetch,
  decompress: async (bytes: Uint8Array) => bytes,
}));
vi.mock('../src/lib/iconCache', () => ({
  resolveIconSheetUrl: mocks.sheet,
  decodeIconSheetUrl: mocks.decode,
  iconSheetCacheEpoch: mocks.epoch,
}));
vi.mock('../src/lib/storage', () => ({ recordDatasetAsset: mocks.record }));
const datasetId = Object.keys(registry.releases)[0]!;
const base = {
  url: 'low.webp',
  index: 7,
  columns: 32,
  sha256: 'c'.repeat(64),
  bytes: 100,
  encoding: 'identity' as const,
  datasetId,
};
const page = { sha256: 'b'.repeat(64), bytes: 200 };
let lookup: Record<string, unknown>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('document', { baseURI: 'https://example.test/browser/' });
  lookup = {
    schemaVersion: 1,
    datasetId,
    lowSheet: base.sha256,
    columns: 8,
    spriteSize: 64,
    pages: [page],
    cells: { '7': [0, 3] },
    owners: { 'i:special:0': [0, 4] },
  };
  mocks.record.mockResolvedValue(undefined);
  mocks.decode.mockResolvedValue(undefined);
  mocks.epoch.mockReturnValue(0);
  mocks.sheet.mockImplementation(async (icon) =>
    icon.sha256 === page.sha256 ? 'high.webp' : 'low.webp',
  );
  mocks.fetch.mockImplementation(async (asset) =>
    new TextEncoder().encode(
      JSON.stringify(
        asset.sha256 === 'a'.repeat(64)
          ? lookup
          : {
              schemaVersion: 1,
              datasetId,
              lookups: { [base.sha256]: { sha256: 'a'.repeat(64), bytes: 150 } },
            },
      ),
    ),
  );
});
describe('original resolution icon companions', () => {
  it('shares a pending decode and exposes only a ready sprite, with stable scale keys', async () => {
    let release!: () => void;
    mocks.decode.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const icons = await import('../src/lib/highResolutionIcons');
    const key = icons.iconRenderKey(base, 'item', 42);
    expect(icons.iconRenderKey({ ...base }, 'item', 86)).toBe(key);
    const first = icons.resolveRenderedIcon(base, 'item', 42);
    expect(icons.resolveRenderedIcon({ ...base }, 'item', 86)).toBe(first);
    await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalled());
    expect(icons.cachedRenderedIcon(key)).toBeUndefined();
    release();
    const ready = await first;
    expect(icons.cachedRenderedIcon(key)).toBe(ready);
    expect(icons.cachedRenderedIcon(icons.iconRenderKey(base, 'item', 24))).toBe(ready);
    expect(await icons.resolveRenderedIcon(base, 'item', 24)).toBe(ready);
    expect(await icons.resolveRenderedIcon(base, 'item', 86)).toBe(ready);
    expect(mocks.sheet).toHaveBeenCalledTimes(1);
  });
  it('binds asynchronous results to the requested immutable sprite identity', async () => {
    const icons = await import('../src/lib/highResolutionIcons');
    const mutable = { ...base };
    const key = icons.iconRenderKey(mutable, 'item', 42);
    const pending = icons.resolveRenderedIcon(mutable, 'item', 42);
    mutable.index = 8;
    const ready = await pending;
    expect(ready).toMatchObject({ resolution: 64, index: 3 });
    expect(icons.cachedRenderedIcon(key)).toBe(ready);
    expect(icons.cachedRenderedIcon(icons.iconRenderKey(mutable, 'item', 42))).toBeUndefined();
  });
  it('does not reuse decoded sprites after their object URL cache is cleared', async () => {
    const icons = await import('../src/lib/highResolutionIcons');
    await icons.resolveRenderedIcon(base, 'item', 42);
    mocks.epoch.mockReturnValue(1);
    expect(icons.cachedRenderedIcon(icons.iconRenderKey(base, 'item', 42))).toBeUndefined();
    await icons.resolveRenderedIcon(base, 'item', 42);
    expect(mocks.sheet).toHaveBeenCalledTimes(2);
  });
  it('keeps a decoded base image when a verified HD image cannot decode', async () => {
    mocks.decode.mockImplementation(async (url) => {
      if (url === 'high.webp') throw new Error('Decode failed');
    });
    const icons = await import('../src/lib/highResolutionIcons');
    expect((await icons.resolveRenderedIcon(base, 'item', 42)).resolution).toBe(32);
    expect(icons.cachedRenderedIcon(icons.iconRenderKey(base, 'item', 42))?.resolution).toBe(32);
  });

  it('uses existing sheets for small icons and unsupported datasets without HD requests', async () => {
    const { resolveRenderedIcon } = await import('../src/lib/highResolutionIcons');
    expect(await resolveRenderedIcon(base, 'item', 32)).toEqual({
      url: 'low.webp',
      index: 7,
      columns: 32,
      resolution: 32,
    });
    expect(
      (await resolveRenderedIcon({ ...base, datasetId: 'older' }, 'item', 80)).resolution,
    ).toBe(32);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('selects 64px crops and shares verified metadata loads across icons', async () => {
    const { resolveRenderedIcon } = await import('../src/lib/highResolutionIcons');
    expect(await resolveRenderedIcon(base, 'item', 42)).toEqual({
      url: 'high.webp',
      index: 3,
      columns: 8,
      resolution: 64,
    });
    expect((await resolveRenderedIcon(base, 'item', 86)).resolution).toBe(64);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.sheet).toHaveBeenCalledWith(expect.objectContaining({ sha256: page.sha256 }), {
      fallbackToUrl: false,
    });
    expect(new URL(mocks.sheet.mock.calls[0]![0].url).origin).toBe('https://example.test');
  });
  it('preserves owner-specific original images when 32px sprites lost distinguishing detail', async () => {
    const { resolveRenderedIcon } = await import('../src/lib/highResolutionIcons');
    expect((await resolveRenderedIcon(base, 'i:special:0', 42)).index).toBe(4);
    expect((await resolveRenderedIcon(base, 'other', 42)).index).toBe(3);
  });
  it('falls back without blanking icons when optional metadata is offline', async () => {
    mocks.fetch.mockRejectedValue(new Error('Offline'));
    const { resolveRenderedIcon } = await import('../src/lib/highResolutionIcons');
    expect((await resolveRenderedIcon(base, 'item', 42)).url).toBe('low.webp');
  });
  it('keeps entries with missing original renders on their existing fallback', async () => {
    mocks.fetch.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({ schemaVersion: 1, datasetId, unavailable: ['missing'], lookups: {} }),
      ),
    );
    const { resolveRenderedIcon } = await import('../src/lib/highResolutionIcons');
    expect((await resolveRenderedIcon(base, 'missing', 80)).resolution).toBe(32);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a wrong release, wrong sheet, or invalid crop', async () => {
    lookup.lowSheet = 'wrong';
    const { resolveRenderedIcon } = await import('../src/lib/highResolutionIcons');
    expect((await resolveRenderedIcon(base, 'item', 42)).resolution).toBe(32);
    lookup.lowSheet = base.sha256;
    lookup.cells = { '7': [0, 99] };
    vi.resetModules();
    const fresh = await import('../src/lib/highResolutionIcons');
    expect((await fresh.resolveRenderedIcon(base, 'item', 42)).resolution).toBe(32);
  });
  it('falls back if the high-resolution image cannot be verified or loaded', async () => {
    mocks.sheet.mockImplementation(async (icon, options) => {
      if (options?.fallbackToUrl === false) throw new Error('Corrupt HD image');
      return icon.url;
    });
    const { resolveRenderedIcon } = await import('../src/lib/highResolutionIcons');
    expect(await resolveRenderedIcon(base, 'item', 42)).toEqual({
      url: 'low.webp',
      index: 7,
      columns: 32,
      resolution: 32,
    });
  });
});
