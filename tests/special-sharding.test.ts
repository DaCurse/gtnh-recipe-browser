import { encode } from '@msgpack/msgpack';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildSpecialViewTypes,
  readSpecialSidecar,
  serializeSpecialData,
  specialGoodsIds
} from '../tools/data-export/special';
import { splitSpecialRecords } from '../tools/pack-builder/builder';

const fixturePath = 'tests/fixtures/nei-special-v1/browser-nei-special.json';

describe('format-4 special-data packing', () => {
  it('uses canonical view order and retains every nested goods reference', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    expect(buildSpecialViewTypes(data).map((view) => view.id)).toEqual(data.categories);
    expect(specialGoodsIds(data)).toContain('f:gregtech:hydrogen');
    expect(serializeSpecialData(data)).toBe(serializeSpecialData(JSON.parse(serializeSpecialData(data))));
  });

  it('splits special records deterministically and preserves sorted IDs', async () => {
    const data = await readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
    const view = buildSpecialViewTypes(data)[0]!;
    const records = data.records.filter((record) => record.category === view.id);
    const inflated = records.concat(records.map((record) => ({
      ...record,
      id: `${record.id}:copy`,
      searchText: `${record.searchText} ${'metadata '.repeat(80)}`
    })));
    const first = splitSpecialRecords('fixture-r1', view, inflated, 300);
    const second = splitSpecialRecords('fixture-r1', view, inflated, 300);
    expect(second).toEqual(first);
    expect(first.flat()).toEqual(inflated);
    expect(first.length).toBeGreaterThan(1);
    expect(first.flatMap((part) => part.map((record) => record.id))).toEqual(
      inflated.map((record) => record.id)
    );
    first.forEach((part, index) => {
      const bytes = gzipSync(encode({
        schemaVersion: 4,
        datasetId: 'fixture-r1',
        kind: 'special',
        specialViewTypeId: view.id,
        specialViewTypeOrder: data.categories.indexOf(view.id),
        part: index,
        records: part
      }), { level: 9 });
      expect(bytes.byteLength <= 300 || part.length === 1).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
    });
  });
});
