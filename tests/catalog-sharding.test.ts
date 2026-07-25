import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { splitCatalogGoods } from '../tools/pack-builder/builder';

function encodedSize(datasetId: string, part: number, goods: unknown[]): number {
  return gzipSync(encode({
    schemaVersion: 3,
    datasetId,
    kind: 'goods',
    part,
    goods
  }), { level: 9 }).byteLength;
}

describe('catalog sharding', () => {
  it('splits deterministically without reordering goods', () => {
    const goods = Array.from({ length: 120 }, (_, index) => ({
      id: `item:${index}`,
      tooltip: `${index}-${'material data '.repeat(30)}`
    }));
    const first = splitCatalogGoods('fixture-r1', goods, 900);
    const second = splitCatalogGoods('fixture-r1', goods, 900);

    expect(second).toEqual(first);
    expect(first.flat()).toEqual(goods);
    expect(first.length).toBeGreaterThan(1);
    first.forEach((part, index) => {
      expect(encodedSize('fixture-r1', index, part)).toBeLessThanOrEqual(900);
    });
  });

  it('keeps one oversized good addressable as its own chunk', () => {
    const good = { id: 'large', tooltip: crypto.randomUUID().repeat(200) };
    const parts = splitCatalogGoods('fixture-r1', [good], 32);

    expect(parts).toEqual([[good]]);
    expect(encodedSize('fixture-r1', 0, parts[0]!)).toBeGreaterThan(32);
  });
});
