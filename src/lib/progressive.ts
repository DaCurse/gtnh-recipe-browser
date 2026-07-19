export interface ProgressiveResult<T> {
  index: number;
  value: T;
  completed: number;
  total: number;
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Operation was cancelled', 'AbortError');
}

export async function mapProgressively<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
  onResult?: (result: ProgressiveResult<R>) => void,
  signal?: AbortSignal
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer');
  }
  const results = new Array<R>(values.length);
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (true) {
      assertActive(signal);
      const index = next++;
      if (index >= values.length) return;
      const value = await mapper(values[index], index);
      assertActive(signal);
      results[index] = value;
      completed++;
      onResult?.({ index, value, completed, total: values.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  assertActive(signal);
  return results;
}
