import type { AssetDescriptor, OfflineInstallProgress } from './types';

export interface OfflineInstallOptions {
  assets: readonly AssetDescriptor[];
  completedHashes?: ReadonlySet<string>;
  concurrency?: number;
  attempts?: number;
  signal?: AbortSignal;
  load: (
    asset: AssetDescriptor,
    onProgress: (loaded: number) => void,
    signal?: AbortSignal
  ) => Promise<void>;
  persist: (completedHashes: ReadonlySet<string>, complete: boolean) => Promise<void>;
  onProgress?: (progress: OfflineInstallProgress) => void;
  retryDelay?: (attempt: number) => Promise<void>;
}

function abortError(): DOMException {
  return new DOMException('Offline download was cancelled', 'AbortError');
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function storageShortfall(
  requiredBytes: number,
  usage?: number,
  quota?: number
): number | undefined {
  if (usage === undefined || quota === undefined) return undefined;
  return Math.max(0, requiredBytes - Math.max(0, quota - usage));
}

export async function installOfflineAssets({
  assets,
  completedHashes = new Set(),
  concurrency = 3,
  attempts = 3,
  signal,
  load,
  persist,
  onProgress,
  retryDelay = (attempt) => new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
}: OfflineInstallOptions): Promise<Set<string>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer');
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('Retry attempts must be a positive integer');
  }

  const assetsByHash = new Map<string, AssetDescriptor>();
  for (const asset of assets) {
    const previous = assetsByHash.get(asset.sha256);
    if (previous && (previous.bytes !== asset.bytes || previous.encoding !== asset.encoding)) {
      throw new Error(`Conflicting descriptors share asset hash ${asset.sha256}`);
    }
    // Keep the first descriptor's URL/label; the SHA is the ownership key and
    // later manifest references must not schedule a second physical download.
    if (!previous) assetsByHash.set(asset.sha256, asset);
  }
  const uniqueAssets = [...assetsByHash.values()];
  const completed = new Set(completedHashes);
  const remaining = uniqueAssets.filter((asset) => !completed.has(asset.sha256));
  const totalBytes = uniqueAssets.reduce((total, asset) => total + asset.bytes, 0);
  const completedBytes = () => uniqueAssets.reduce(
    (total, asset) => total + (completed.has(asset.sha256) ? asset.bytes : 0),
    0
  );
  const liveBytes = new Map<string, number>();
  let lastReportedBytes = 0;
  let next = 0;
  let saveQueue = Promise.resolve();

  const report = (asset?: AssetDescriptor, retry?: number) => {
    const inFlight = [...liveBytes.values()].reduce((total, loaded) => total + loaded, 0);
    lastReportedBytes = Math.max(lastReportedBytes, Math.min(totalBytes, completedBytes() + inFlight));
    onProgress?.({
      loadedBytes: lastReportedBytes,
      totalBytes,
      completedAssets: uniqueAssets.filter((candidate) => completed.has(candidate.sha256)).length,
      totalAssets: uniqueAssets.length,
      currentAsset: asset?.id,
      retry
    });
  };

  report();
  const worker = async () => {
    while (true) {
      assertActive(signal);
      const index = next++;
      if (index >= remaining.length) return;
      const asset = remaining[index];
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        assertActive(signal);
        liveBytes.set(asset.sha256, 0);
        report(asset, attempt > 1 ? attempt : undefined);
        try {
          await load(asset, (loaded) => {
            liveBytes.set(asset.sha256, Math.max(0, Math.min(asset.bytes, loaded)));
            report(asset, attempt > 1 ? attempt : undefined);
          }, signal);
          assertActive(signal);
          liveBytes.delete(asset.sha256);
          completed.add(asset.sha256);
          const complete = completed.size >= uniqueAssets.length;
          saveQueue = saveQueue.then(() => persist(new Set(completed), complete));
          await saveQueue;
          report(asset);
          lastError = undefined;
          break;
        } catch (error) {
          liveBytes.delete(asset.sha256);
          if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            throw abortError();
          }
          lastError = error;
          if (attempt < attempts) await retryDelay(attempt);
        }
      }
      if (lastError !== undefined) throw lastError;
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, remaining.length) }, worker));
    await saveQueue;
    assertActive(signal);
    report();
    return completed;
  } catch (error) {
    await saveQueue;
    throw error;
  }
}
