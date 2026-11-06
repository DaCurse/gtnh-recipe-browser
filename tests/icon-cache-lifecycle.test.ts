import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),cached:vi.fn(),record:vi.fn(),verify:vi.fn()}));
vi.mock('../src/lib/datasetAssets',()=>({fetchVerified:mocks.fetch}));
vi.mock('../src/lib/storage',()=>({getCachedAsset:mocks.cached,recordDatasetAsset:mocks.record}));
vi.mock('../src/lib/integrity',()=>({verifyAssetBytesAsync:mocks.verify}));
const icon={url:'https://example.test/icon',sha256:'a'.repeat(64),bytes:4,encoding:'identity' as const,datasetId:'active'};
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(new Uint8Array(4));mocks.cached.mockResolvedValue(null);
  mocks.record.mockResolvedValue(undefined);mocks.verify.mockResolvedValue(undefined);
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:icon');
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
});
afterEach(()=>vi.restoreAllMocks());
describe('optional icon sheet lifecycle',()=>{
  it('keeps active dataset companions alive even when the base manifest does not list them',async()=>{
    const cache=await import('../src/lib/iconCache');
    await cache.resolveIconSheetUrl(icon,{fallbackToUrl:false});
    cache.clearIconSheetCache(new Set(),'active');await Promise.resolve();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    cache.clearIconSheetCache(new Set(),'older');await Promise.resolve();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:icon');
  });
  it('tracks reuse across owning datasets without refetching a sheet',async()=>{
    const cache=await import('../src/lib/iconCache');
    await cache.resolveIconSheetUrl(icon);
    await cache.resolveIconSheetUrl({...icon,datasetId:'second'});
    cache.clearIconSheetCache(new Set(),'second');await Promise.resolve();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('shows cached previews without a network request',async()=>{
    mocks.cached.mockResolvedValue(new Uint8Array(4));
    const cache=await import('../src/lib/iconCache');
    expect(await cache.resolveCachedIconSheetUrl(icon)).toBe('blob:icon');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });
  it('does not create a stale preview object URL after a dataset switch',async()=>{
    let release!:(bytes:Uint8Array)=>void;
    mocks.cached.mockReturnValue(new Promise<Uint8Array>(resolve=>{release=resolve;}));
    const cache=await import('../src/lib/iconCache');
    const pending=cache.resolveCachedIconSheetUrl(icon);
    cache.clearIconSheetCache();release(new Uint8Array(4));
    expect(await pending).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
