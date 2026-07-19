import { describe, expect, it } from 'vitest';
import { mapProgressively } from '../src/lib/progressive';

describe('progressive bounded-concurrency work', () => {
  it('exposes completed batches before slower work finishes', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const seen: number[] = [];
    const pending = mapProgressively(
      [0, 1, 2],
      2,
      async (value) => {
        if (value === 0) await firstGate;
        return value;
      },
      ({ value }) => seen.push(value)
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toContain(1);
    expect(seen).not.toContain(0);
    releaseFirst();
    await expect(pending).resolves.toEqual([0, 1, 2]);
  });

  it('stops exposing stale results after cancellation', async () => {
    const controller = new AbortController();
    const pending = mapProgressively(
      [0, 1],
      1,
      async (value) => value,
      ({ completed }) => {
        if (completed === 1) controller.abort();
      },
      controller.signal
    );

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
