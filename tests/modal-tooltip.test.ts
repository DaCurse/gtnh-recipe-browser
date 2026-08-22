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

  it('keeps variant-picker modal rows inline-only', async () => {
    const source = await readFile('src/lib/VariantPicker.svelte', 'utf8');
    expect(source).not.toContain('FloatingCatalogTooltip');
    expect(source).not.toContain('tooltipEntry');
    expect(source).not.toContain('onpointerenter');
    expect(source).toContain('<em><MinecraftText raw={entry.rawTooltip} fallback={entry.tooltip} /></em>');
  });
});
