import { describe, expect, it } from 'vitest';
import { layoutOreProcessingGraph, stagesToOreGraph } from '../src/lib/oreProcessingGraph';
import { boundedSpecialPage, specialCategory, specialSearchText, type SpecialRecord } from '../src/lib/specialData';

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
