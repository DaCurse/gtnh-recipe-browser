import { describe, expect, it } from 'vitest';
import { buildCatalogSearchDocument, catalogDocumentMatches, parseCatalogSearchQuery } from '../src/lib/catalogSearch';
import { parseSearchExpression } from '../src/lib/searchSyntax';

const document = buildCatalogSearchDocument({
  id: 'family:hammer', name: 'Hammer', mod: 'gregtech', members: [
    { id: 'i:gregtech:hammer:0', name: 'Iron Hammer', mod: 'GregTech',
      rawTooltip: 'Iron Hammer\nDurability: 100\nMining Level: 2', oreDictionaryIds: ['o:craftingToolHardHammer'] },
    { id: 'i:gregtech:hammer:1', name: 'Rubber Hammer', mod: 'GregTech',
      rawTooltip: 'Rubber Hammer\nDurability: 50', oreDictionaryIds: ['o:craftingToolSoftHammer'] }
  ]
});
const matches = (source: string) => catalogDocumentMatches(document, parseCatalogSearchQuery(source));

describe('NEI extended search syntax', () => {
  it('combines case-insensitive field filters and both exclusion operators', () => {
    expect(matches('@GREG #"mining level" $craftingToolHardHammer &gregtech:hammer !rubber')).toBe(true);
    expect(matches('iron -#"durability: 100"')).toBe(false);
    expect(matches('hammer !@gregtech')).toBe(false);
    expect(matches('&minecraft')).toBe(false);
    expect(matches('#iron')).toBe(false); // The name line is not tooltip body text in NEI.
    expect(matches('iron')).toBe(true);
  });
  it('requires every term in an OR branch to match the same exact variant', () => {
    expect(matches('iron #"durability: 50"')).toBe(false);
    expect(matches('iron rubber')).toBe(false);
    expect(matches('diamond | rubber #"durability: 50"')).toBe(true);
    expect(matches('diamond | iron #"durability: 50"')).toBe(false);
    expect(matches('iron !rubber')).toBe(true);
    expect(matches('$craftingToolHardHammer #"durability: 50"')).toBe(false);
  });
  it('keeps quoted phrases and escaped quotes intact, including OR inside quotes', () => {
    const parsed = parseSearchExpression('"iron | copper" @"greg tech" "say \\"hello\\""');
    expect(parsed.clauses).toHaveLength(1);
    expect(parsed.clauses[0]?.map(term => term.value)).toEqual(['iron | copper', 'greg tech', 'say "hello"']);
    expect(matches('"iron hammer"')).toBe(true);
    expect(matches('"hammer iron"')).toBe(false);
  });
  it('supports NEI wildcards without treating arbitrary user input as regex', () => {
    expect(matches('ir?n')).toBe(true);
    expect(matches('i*n hammer')).toBe(true);
    expect(matches('&hamme*r')).toBe(false); // NEI * consumes at least one character.
    expect(matches('&ham??er')).toBe(false);
    expect(matches('&gregtech:ham*er')).toBe(true);
    expect(matches('r/iron|diamond/')).toBe(false);
  });
  it('handles empty branches, incomplete prefixes and negation while typing', () => {
    expect(matches('')).toBe(true);
    expect(matches(' | ')).toBe(true);
    expect(matches('iron |')).toBe(true);
    expect(matches('@')).toBe(false);
    expect(matches('!')).toBe(true);
    expect(matches('!@')).toBe(true);
    expect(parseSearchExpression('$').needsOreDictionary).toBe(true);
    expect(parseSearchExpression('"$literal"').needsOreDictionary).toBe(false);
  });
  it('preserves every input character and uses the upstream provider/operator colors', () => {
    const source = '  @GregTech  !#"Mining Level" | $ingotIron &minecraft:stone -copper* ';
    const { spans } = parseSearchExpression(source);
    expect(spans.map(span => span.text).join('')).toBe(source);
    expect(spans).toContainEqual({ text: '@GregTech', format: 'd' });
    expect(spans).toContainEqual({ text: '!', format: '9' });
    expect(spans).toContainEqual({ text: 'Mining Level', format: 'e' });
    expect(spans).toContainEqual({ text: '"', format: '6' });
    expect(spans).toContainEqual({ text: '|', format: '7' });
    expect(spans).toContainEqual({ text: '$ingotIron', format: 'b' });
    expect(spans).toContainEqual({ text: '&minecraft:stone', format: '6' });
    expect(spans).toContainEqual({ text: '-', format: '9' });
  });
});
