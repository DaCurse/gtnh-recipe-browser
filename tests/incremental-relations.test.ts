import { describe, expect, it } from 'vitest';
import { compactRelations, expandRelations } from '../src/lib/packedRelations';
import { goodsIdentityFromId } from '../src/lib/goodsIdentity';
import { compactRecordPageSelections, recordPageSelections } from '../src/lib/recordPages';
import { minecraftFormattingSpans, parseMinecraftHtml, restoreMinecraftFormatting } from '../src/lib/minecraftText';

describe('incremental wire records', () => {
  it('round-trips compact selectors and rejects truncated or overflowing varints', () => {
    const selections: [number, number, number][] = [[0, 0, 1], [700, 4096, 128], [1, 0xffffffff, 2]];
    expect(recordPageSelections({ segments: compactRecordPageSelections(selections) })).toEqual(selections);
    expect(() => recordPageSelections({ segments: btoa(String.fromCharCode(128)) })).toThrow('Truncated');
    expect(() => recordPageSelections({ segments: btoa(String.fromCharCode(255, 255, 255, 255, 255, 0)) })).toThrow('Invalid');
  });

  it('restores styled tooltip text losslessly without storing a second copy of its text', () => {
    for (const html of ['Plain &amp; safe<br>', '<span class="fmt-a fmt-l">Green</span> plain<br><span class="fmt-4">Red 🟠</span>',
      '<span class="fmt-6">one<br>two</span>']) {
      const parsed = parseMinecraftHtml(html);
      expect(restoreMinecraftFormatting(parsed.plainText, minecraftFormattingSpans(html))).toEqual(parsed.lines);
    }
    expect(() => restoreMinecraftFormatting('text', [[0, 99, 'a']])).toThrow('Invalid');
  });
  it('reconstructs shared lists and implicit self matching without mutating wire records', () => {
    const shared = ['recipe-1'.repeat(10), 'recipe-2'.repeat(10)];
    const records = ['i:a', 'i:b'].map((id) => ({ id, productionShards: shared,
      usageShards: [], productionMatchIds: [id], specialUsageMatchIds: [id] }));
    const packed = compactRelations(records);
    expect(packed.lists).toHaveLength(1);
    expect(packed.records[0]?.productionMatchIds).toBeUndefined();
    const expanded = expandRelations(packed.records as Array<{ id: string }>, packed.lists);
    for (let index = 0; index < records.length; index++) expect(expanded[index]).toMatchObject(records[index]!);
    expect(packed.records[0]?.productionShards).toBeUndefined();
    expect(() => expandRelations(packed.records as Array<{ id: string }>, [])).toThrow('missing relation list');
  });

  it('keeps unaffected relation fingerprints stable after insertion, deletion, modification, and reorder', () => {
    const a = { id: 'i:a', usageShards: ['one'.repeat(30), 'two'.repeat(30)] };
    const b = { id: 'i:b', usageShards: ['three'] };
    const original = compactRelations([a, a, b]);
    for (const changed of [[b, a], [a], [a, b, { id: 'i:c', usageShards: ['new'] }],
      [a, { ...b, usageShards: ['modified'] }]]) {
      const next = compactRelations([...changed, a]);
      expect(next.records.find((record) => record.id === a.id)).toEqual(original.records[0]);
      expect(next.lists).toContainEqual(original.lists[0]);
    }
  });

  it('derives only stable upstream identity defaults', () => {
    expect(goodsIdentityFromId('i:gregtech:gt.blockores2:3001')).toEqual({
      kind: 'item', mod: 'gregtech', internalName: 'gt.blockores2', damage: 3001
    });
    expect(goodsIdentityFromId('i:mod:seed:0:' + 'a'.repeat(40))).toMatchObject({ internalName: 'seed', damage: 0 });
    expect(goodsIdentityFromId('f:mod:fluid:with:colon')).toMatchObject({ internalName: 'fluid:with:colon', kind: 'fluid' });
  });
});
