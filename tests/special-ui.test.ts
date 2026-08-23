import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { layoutOreProcessingGraph, stagesToOreGraph } from '../src/lib/oreProcessingGraph';
import {
  boundedSpecialPage,
  gtDimensionDisplayGoodsId,
  humanizeGtOreName,
  isSpecialViewEnabled,
  specialCategory,
  humanizeSpecialName,
  specialLookupMatchesView,
  specialSearchText,
  toSpecialGoodsList,
  type SpecialRecord
} from '../src/lib/specialData';

describe('NEI special browser presentation', () => {
  it('maps canonical sidecar category IDs to focused renderers', () => {
    expect(specialCategory('crop-output')).toBe('crop');
    expect(specialCategory('crop-outputs')).toBe('crop');
    expect(specialCategory('mutation-pool')).toBe('cropPool');
    expect(specialCategory('mutation-pools')).toBe('cropPool');
    expect(specialCategory('gt-ore-vein')).toBe('gtOreVein');
    expect(specialCategory('gt-ore-veins')).toBe('gtOreVein');
    expect(specialCategory('gt-small-ore')).toBe('gtSmallOre');
    expect(specialCategory('gt-small-ores')).toBe('gtSmallOre');
    expect(specialCategory('meteor-ritual')).toBe('meteorRitual');
    expect(specialCategory('meteor-rituals')).toBe('meteorRitual');
    expect(specialCategory('loot-bag')).toBe('lootBag');
    expect(specialCategory('lootbags')).toBe('lootBag');
    expect(specialCategory('vending-trade')).toBe('vending');
    expect(specialCategory('vending-trades')).toBe('vending');
    expect(specialCategory('worldgen-loot')).toBe('worldgenLoot');
    expect(specialCategory('gt-ore-processing')).toBe('oreProcessing');
  });

  it('maps directional lookup IDs to their individual NEI tabs', () => {
    expect(specialLookupMatchesView('special:crop:cropsnh-rubyne:recipes', 'crop-output')).toBe(true);
    expect(specialLookupMatchesView('special:pool:cropsnh-gray:usages', 'mutation-pool')).toBe(true);
    expect(specialLookupMatchesView('special:ore-processing:iron:recipes', 'gt-ore-processing')).toBe(true);
    expect(specialLookupMatchesView('special:crop:cropsnh-rubyne:recipes', 'gt-ore-processing')).toBe(false);
  });

  it('keeps the unreliable ore-processing view disabled', () => {
    expect(isSpecialViewEnabled('gt-ore-processing')).toBe(false);
    expect(isSpecialViewEnabled('crop-output')).toBe(true);
  });

  it('humanizes legacy CropsNH localization keys', () => {
    expect(humanizeSpecialName('cropsnh_crops.aluminiumOreBerry')).toBe('Aluminium Ore Berry');
    expect(humanizeSpecialName('cropsnh_mutationPool.danger')).toBe('Danger');
    expect(humanizeSpecialName('Mutation Pool: cropsnh_mutationPool.oreBerry')).toBe('Ore Berry');
  });

  it('humanizes GT vein and small-ore registry names', () => {
    expect(humanizeGtOreName('GT Ore Vein: ore.mix.copper')).toBe('Copper');
    expect(humanizeGtOreName('GT Small Ore: ore.small.amber')).toBe('Amber');
    expect(humanizeGtOreName('ore.mix.brownLimonite')).toBe('Brown Limonite');
  });

  it('resolves GTNEIOrePlugin dimension-display aliases to real catalog goods', () => {
    const resolver = (id: string) => /blockDimensionDisplay_(?:Ow|Ga|Ne):0$/.test(id)
      ? { id, kind: 'item', name: id, mod: 'gtneioreplugin' } as never
      : undefined;
    expect(gtDimensionDisplayGoodsId('Overworld', resolver)).toBe(
      'i:gtneioreplugin:blockDimensionDisplay_Ow:0'
    );
    expect(gtDimensionDisplayGoodsId('ganymed', resolver)).toBe(
      'i:gtneioreplugin:blockDimensionDisplay_Ga:0'
    );
    expect(gtDimensionDisplayGoodsId('0', resolver)).toBe(
      'i:gtneioreplugin:blockDimensionDisplay_Ow:0'
    );
    expect(gtDimensionDisplayGoodsId('-1', resolver)).toBe(
      'i:gtneioreplugin:blockDimensionDisplay_Ne:0'
    );
  });

  it('keeps the GT stat card aligned with the embedded NEI page structure', async () => {
    const source = await readFile('src/lib/VeinSpecialCard.svelte', 'utf8');
    for (const label of ['Primary', 'Secondary', 'Between', 'Sporadic', 'Generated World']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('dimensionGoodsIds');
    expect(source).toContain('overflow-x:auto');
    expect(source).toContain('goods: goodsId ? [{ goodsId, chance }] : []');
    expect(source).toContain('Chances per ore chunk');
    expect(source).not.toContain('dimension-copy');
    expect(source).toContain('smallOreDrops');
    expect(source).toContain('per chunk');
  });

  it('labels machine tabs and keeps variant metadata separators stable', async () => {
    const browser = await readFile('src/lib/RecipeBrowser.svelte', 'utf8');
    const variants = await readFile('src/lib/VariantPicker.svelte', 'utf8');
    expect(browser).toContain('class="machine-tab"');
    expect(browser).toContain('<small>{tab}</small>');
    expect(variants).toContain(".filter(Boolean).join(' · ')");
  });

  it('does not carry a special tab into another item or recipe direction', async () => {
    const state = await readFile('src/lib/recipeBrowserState.svelte.ts', 'utf8');
    expect(state).toContain('private lastRecipeContextKey: string | undefined;');
    expect(state).toContain("const contextKey = `${mode}:${selected.id}`;");
    expect(state).toContain("this.specialType = '';");
    expect(state).toContain("this.specialQuery = '';");
    expect(state).toContain("this.specialFilter = '';");
  });

  it('normalizes object-shaped crop soil references without stringifying objects', () => {
    expect(toSpecialGoodsList([
      { goodsId: 'i:minecraft:stone:0' },
      { id: 'i:minecraft:dirt:0', label: 'Dirt' }
    ])).toEqual([
      { goodsId: 'i:minecraft:stone:0' },
      { goodsId: 'i:minecraft:dirt:0', label: 'Dirt' }
    ]);
  });

  it('uses a unique key for duplicate semantic ore routes', async () => {
    const source = await readFile('src/lib/OreProcessingGraph.svelte', 'utf8');
    expect(source).toContain('as edge, edgeIndex (`${edge.from}:${edge.to}:${edge.branch ?? \'\'}:${edgeIndex}`)');
    const input = {
      nodes: [
        { id: 'source', label: 'Source', kind: 'source' },
        { id: 'result', label: 'Result', kind: 'result' }
      ],
      edges: [
        { from: 'source', to: 'result', chance: 0.5 },
        { from: 'source', to: 'result', chance: 0.25 }
      ]
    } as const;
    expect(layoutOreProcessingGraph(input).edges).toHaveLength(2);
  });

  it('retains category payload fields in search text', () => {
    const record: SpecialRecord = {
      id: 'meteor:iron',
      category: 'meteorRitual',
      title: 'Iron Meteor',
      payload: {
        lpCost: 12_000,
        ritual: 'Meteor Ritual',
        requirements: ['Moon dimension'],
        outputs: []
      }
    };
    const text = specialSearchText(record);
    expect(text).toContain('12000');
    expect(text).toContain('moon dimension');
  });

  it('bounds large drop tables to one mounted slot page', () => {
    const records = Array.from({ length: 137 }, (_, index) => index);
    expect(boundedSpecialPage(records, 0, 12)).toHaveLength(12);
    expect(boundedSpecialPage(records, 11, 12)).toHaveLength(5);
  });

  it('wraps loot-table names and Fortune summaries instead of ellipsizing them', async () => {
    const source = await readFile('src/lib/SpecialGoods.svelte', 'utf8');
    expect(source).toContain('wrapLabels = false');
    expect(source).toContain('class:wrap-labels={wrapLabels}');
    expect(source).toContain('.special-goods.wrap-labels .special-goods-grid');
    expect(source).toContain('text-overflow:clip;');
    expect(source).toContain('font-weight:400;');
    const lootSource = await readFile('src/lib/LootBagSpecialCard.svelte', 'utf8');
    expect(lootSource).toContain('wrapLabels label="Drops"');
  });

  it('renders world-generation tables as chance grids and vending trades as NEI slots', async () => {
    const worldgenSource = await readFile('src/lib/WorldgenLootSpecialCard.svelte', 'utf8');
    expect(worldgenSource).toContain('entry.weight ?? entry.rarity');
    expect(worldgenSource).toContain('Math.max(0, weight) / totalWeight');
    expect(worldgenSource).toContain('table.entries ?? table.items ?? table.drops');
    expect(worldgenSource).toContain('Possible loot');
    expect(worldgenSource).toContain('Previous tables');

    const vendingSource = await readFile('src/lib/VendingSpecialCard.svelte', 'utf8');
    expect(vendingSource).toContain('rawPayload.fromCurrency');
    expect(vendingSource).toContain('rawPayload.fromItems');
    expect(vendingSource).toContain('rawPayload.toItems');
    expect(vendingSource).toContain('trade-layout');
    expect(vendingSource).toContain('Requirements');
    expect(vendingSource).toContain('Better Questing quest');
  });

  it('removes legacy world-generation title prefixes at the card boundary', async () => {
    const source = await readFile('src/lib/SpecialCard.svelte', 'utf8');
    expect(source).toContain('^(?:Forge|Twilight) Loot:');
  });

  it('keys duplicate meteor reagent effects by row as well as content', async () => {
    const source = await readFile('src/lib/MeteorSpecialCard.svelte', 'utf8');
    expect(source).toContain('effects as reagent, index (`${index}:${String(reagent.goodsId ?? reagent.effect)}`)');
  });

  it('builds semantic stage nodes, including reagent and branch outputs', () => {
    const graph = stagesToOreGraph([
      {
        id: 'bath',
        machine: 'Chemical Bath',
        kind: 'chemicalBath',
        inputs: [{ goodsId: 'fluid:acid', role: 'reagent' }],
        outputs: [{ goodsId: 'dust:washed', chance: 0.75, role: 'output' }],
        branches: ['acid']
      },
      {
        id: 'sift',
        machine: 'Sifter',
        kind: 'sifter',
        outputs: [{ goodsId: 'dust:nugget', chance: 0.2, role: 'output' }]
      }
    ], { goodsId: 'ore:raw' });
    expect(graph.nodes.find((node) => node.goodsId === 'fluid:acid')?.kind).toBe('reagent');
    expect(graph.nodes.find((node) => node.id === 'bath')?.kind).toBe('chemicalBath');
    expect(graph.nodes.find((node) => node.id === 'sift')?.kind).toBe('sifter');
    expect(graph.edges.some((edge) => edge.branch === 'acid')).toBe(true);
  });

  it('allocates stable non-overlapping boxes and orthogonal routes', () => {
    const input = {
      nodes: [
        { id: 'source', label: 'Source', kind: 'source' },
        { id: 'machine', label: 'Macerator', kind: 'machine' },
        { id: 'result-a', label: 'A', kind: 'result' },
        { id: 'result-b', label: 'B', kind: 'result' }
      ],
      edges: [
        { from: 'source', to: 'machine' },
        { from: 'machine', to: 'result-a', chance: 0.5 },
        { from: 'machine', to: 'result-b', chance: 0.25 }
      ]
    } as const;
    const left = layoutOreProcessingGraph(input);
    const right = layoutOreProcessingGraph(input);
    expect(left).toEqual(right);
    for (let index = 0; index < left.nodes.length; index += 1) {
      for (let next = index + 1; next < left.nodes.length; next += 1) {
        const a = left.nodes[index]!;
        const b = left.nodes[next]!;
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x
          && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
    expect(left.edges[1]?.points.length).toBe(4);
    expect(left.edges[1]?.points[1]?.x).toBe(left.edges[1]?.points[2]?.x);
  });
});
