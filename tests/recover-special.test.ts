import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  canonicalFluidId,
  canonicalItemId,
  decodeHsqlString,
  parseHsqlValues,
  recoverSpecialGoodsIds
} from '../tools/data-export/recover-special';

const fixturePath = 'tests/fixtures/nei-special-v1/browser-nei-special.json';

function replaceExact(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => replaceExact(entry, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceExact(child, replacements)])
    );
  }
  return value;
}

describe('offline NESQL special-ID recovery', () => {
  it('parses SQL strings containing commas, parentheses, and escaped quotes', () => {
    const values = parseHsqlValues(
      "INSERT INTO ITEM VALUES('i~demo~thing~0','item/demo,thing.png','thing',0,1,'Demo (thing)','',64,'demo','{name:''x\\u000a}','','tile.demo')"
    );
    expect(values).toHaveLength(12);
    expect(values?.[0]).toBe('i~demo~thing~0');
    expect(values?.[1]).toBe('item/demo,thing.png');
    expect(values?.[5]).toBe('Demo (thing)');
    expect(values?.[9]).toBe("{name:'x\\u000a}");
    expect(decodeHsqlString(values?.[9] ?? '')).toBe("{name:'x\n}");
  });

  it('matches Data/Goods.cs canonical item and fluid identity rules', () => {
    expect(canonicalItemId('demo', 'thing', 0, '')).toBe('i:demo:thing:0');
    expect(canonicalItemId('demo', 'thing', 0, '{foo:bar}'))
      .toBe('i:demo:thing:0:b80755bb506271450f6e0f44e0cd6bdd3e592f09');
    expect(canonicalFluidId('demo', 'water')).toBe('f:demo:water');
    expect(canonicalFluidId('cropsnh', 'cropsnh:jagi')).toBe('f:cropsnh:cropsnh:jagi');
  });

  it('replaces raw IDs in lookup arrays and nested payload fields', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    const replacements = new Map([
      ['i:gregtech:gt.metaitem.01:2816', 'i~gregtech~gt.metaitem.01~2816'],
      ['i:BloodMagic:slate:0', 'i~BloodMagic~slate~0'],
      ['f:gregtech:hydrogen', 'f~gregtech~hydrogen']
    ]);
    const raw = replaceExact(
      source,
      new Map([...replacements].map(([canonical, rawId]) => [canonical, rawId]))
    );
    const mappings = new Map(
      [...replacements].map(([canonicalId, rawId]) => [rawId, { rawId, canonicalId, kind: rawId.startsWith('i~') ? 'item' as const : 'fluid' as const }])
    );
    const result = recoverSpecialGoodsIds(raw, mappings);
    expect(result.unresolvedRawIds).toEqual([]);
    expect(result.replacedIds).toEqual([...mappings.keys()].sort());
    expect(result.data.records[0]?.goodsIds).toContain('i:gregtech:gt.metaitem.01:2816');
    expect(JSON.stringify(result.data)).not.toContain('i~');
    expect(JSON.stringify(result.data)).not.toContain('f~');
  });

  it('reports missing rows instead of silently producing unresolved references', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const records = source.records as Array<Record<string, unknown>>;
    records[0]!.goodsIds = ['i~missing~thing~0'];
    expect(() => recoverSpecialGoodsIds(source, new Map())).toThrow(
      'HSQL script has no row for 1 raw special goods IDs: i~missing~thing~0'
    );
  });
});
