import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('modal tooltip layering', () => {
  it('clears and suppresses recipe-grid tooltips while the ore chooser is open', async () => {
    const source = await readFile('src/lib/RecipeGrid.svelte', 'utf8');
    expect(source).toContain('function openGroupChooser(itemId: string, groupId: string) {\n    hideTooltip();');
    expect(source).toContain('{#if !chooserOpen && tooltipEntry}');
  });

  it('clears and suppresses special-goods tooltips while the ore chooser is open', async () => {
    const source = await readFile('src/lib/SpecialGoods.svelte', 'utf8');
    expect(source).toContain('if (item.oreDictionaryId && resolve(item.oreDictionaryId)) {\n      hideTooltip();');
    expect(source).toContain('{#if !chooserOpen && tooltipEntry}');
  });
});
