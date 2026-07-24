import { describe, expect, it } from 'vitest';
import fixture from './fixtures/gtnh-2.9.0-beta-2-browser-policy/parity.json';
import { buildCatalogBrowseEntries } from '../src/lib/catalogVariants';
import { parseMinecraftHtml } from '../src/lib/minecraftText';
import type { CatalogEntry } from '../src/lib/types';
import type { DecodedItem } from '../tools/pack-builder/model';

function catalogEntry(item: DecodedItem): CatalogEntry {
  return {
    id: item.id,
    name: item.name,
    mod: item.mod,
    kind: 'item',
    internalName: item.internalName,
    damage: item.damage,
    nbt: item.nbt,
    rawTooltip: item.tooltip,
    tooltip: [],
    color: '#aaa',
    glyph: '□',
    searchable: item.searchable
  };
}

describe('pinned browser catalog policy parity', () => {
  it('retains a high-cardinality exact GT tool catalog', () => {
    expect(fixture.source.formatVersion).toBe(5);
    expect(fixture.counts.items).toBe(101_438);
    expect(fixture.counts.recipes).toBe(306_831);
    expect(fixture.counts.searchableGtTools).toBe(19_010);
    expect(fixture.source.dataSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.source.atlasSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves all four Ichorium turbine sizes as exact NBT stacks', () => {
    expect(fixture.turbines.map((item) => item.damage)).toEqual([170, 172, 174, 176]);
    for (const turbine of fixture.turbines) {
      expect(turbine.internalName).toBe('gt.metatool.01');
      expect(turbine.nbt).toContain('PrimaryMaterial:"Ichorium"');
      expect(turbine.searchable).toBe(true);
      expect(turbine.iconId).toBeGreaterThan(65_535);
      expect(turbine.productionRecipeIds).toHaveLength(1);
    }
  });

  it('preserves the general Assembler relationship from blade to turbine', () => {
    const bladeId = fixture.ichoriumBlade.id;
    const expectedBladeAmounts = new Map([
      [170, 4],
      [172, 8],
      [174, 12],
      [176, 16]
    ]);
    for (const turbine of fixture.turbines) {
      const recipe = fixture.recipes.find((candidate) =>
        candidate.outputs.some((output) => output.goodsId === turbine.id)
      );
      expect(recipe?.recipeTypeId).toContain(':gregtech:Assembler');
      expect(recipe?.inputs.find((input) => input.goodsId === bladeId)?.amount)
        .toBe(expectedBladeAmounts.get(turbine.damage));
      expect(recipe?.outputs).toContainEqual(expect.objectContaining({
        goodsId: turbine.id,
        amount: 1
      }));
      expect(recipe?.gt?.voltage).toBeGreaterThan(0);
      expect(recipe?.gt?.durationTicks).toBeGreaterThan(0);
    }
  });

  it('groups real exact variants for browsing without merging tool sizes', () => {
    const entries = [
      ...fixture.turbines.map((item) => catalogEntry(item as DecodedItem)),
      catalogEntry(fixture.comparisonTurbine as DecodedItem)
    ];
    const groups = buildCatalogBrowseEntries(entries);
    const small = groups.find((entry) => entry.damage === 170);

    expect(small?.variantCount).toBe(2);
    expect(small?.variantIds).toContain(fixture.turbines[0]!.id);
    expect(small?.variantIds).toContain(fixture.comparisonTurbine.id);
    expect(groups.filter((entry) => entry.damage !== 170)).toHaveLength(3);
  });

  it('preserves a colored potion effect when it is the final tooltip line', () => {
    const parsed = parseMinecraftHtml(fixture.effectTooltipItem.tooltip);

    expect(fixture.effectTooltipItem.nbt).toContain('CustomFlaskEffects');
    expect(parsed.plainText).toBe('Swigs Left: 8/8\nFlight (7:06)');
    expect(parsed.lines[1]?.segments).toEqual([
      { text: 'Flight (7:06)', formats: ['7'] }
    ]);
  });
});
