import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import registry from '../src/lib/generated/ore-diagrams.json';
import versions from '../public/versions-v7.json';
import { oreArrowRects, oreDiagramMatches, oreLineRect, oreSceneBounds, type OreDiagramIndex, type OreScene } from '../src/lib/oreDiagram';
import type { CatalogEntry } from '../src/lib/types';

const datasetId = versions.versions.find(version => version.gtnhVersion === '2.9.0')!.datasetId;
async function verified<T>(asset: { sha256: string; bytes: number }): Promise<T> {
  const bytes = await readFile(`public/assets/sha256/${asset.sha256}`);
  expect(bytes.length).toBe(asset.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  return JSON.parse(gunzipSync(bytes).toString()) as T;
}
const index = await verified<OreDiagramIndex>((registry.releases as Record<string, { sha256: string; bytes: number }>)[datasetId]!);
const data = await verified<{ scenes: Record<string, OreScene>; datasetId: string }>(index.scenes);

describe('native GTNH ore diagrams', () => {
  it('draws the original two-pixel routes and three-step arrowheads in every direction', () => {
    expect(oreLineRect([10, 20], [10, 40])).toEqual({ x: 9, y: 19, width: 2, height: 22 });
    expect(oreArrowRects([10, 20], [10, 40])).toEqual([
      { x: 9, y: 39, width: 2, height: 2 }, { x: 8, y: 38, width: 4, height: 2 }, { x: 7, y: 37, width: 6, height: 2 }
    ]);
    expect(oreArrowRects([10, 40], [10, 20])[2]).toEqual({ x: 7, y: 21, width: 6, height: 2 });
    expect(oreArrowRects([20, 10], [40, 10])[2]).toEqual({ x: 37, y: 7, width: 2, height: 6 });
    expect(oreArrowRects([40, 10], [20, 10])[2]).toEqual({ x: 21, y: 7, width: 2, height: 6 });
  });
  it('retains every diagram and every directional matcher reference from the runtime', () => {
    expect(data.datasetId).toBe(datasetId);
    expect(Object.keys(data.scenes)).toHaveLength(331);
    expect(index.sceneIds).toHaveLength(331);
    for (const direction of ['recipes', 'usages'] as const) {
      for (const list of Object.values(index.matches[direction])) {
        expect(index.lists[list]?.length).toBeGreaterThan(0);
        for (const scene of index.lists[list]!) expect(data.scenes[index.sceneIds[scene]!]).toBeDefined();
      }
    }
  });
  it('matches NBT variants and fluid containers through the upstream matcher, with independent directions', () => {
    const iron = { id: 'i:gregtech:gt.blockores2:32' } as CatalogEntry;
    const normal = oreDiagramMatches(index, iron, 'usages');
    expect(normal).toHaveLength(1);
    expect(oreDiagramMatches(index, { ...iron, id: `${iron.id}:bf21a9e8fbc5a3846fb05b4fa0859e0917b2202f` }, 'usages')).toEqual(normal);
    expect(oreDiagramMatches(index, iron, 'machineUsages')).toEqual([]);
    const fluid = { id: 'f:gregtech:mercury' } as CatalogEntry;
    const fluidMatches = oreDiagramMatches(index, fluid, 'usages');
    expect(fluidMatches.length).toBeGreaterThan(0);
    expect(oreDiagramMatches(index, { id: 'i:test:mercury-cell:0', container: { fluidId: fluid.id } } as CatalogEntry, 'usages')).toEqual(fluidMatches);
    expect(oreDiagramMatches(index, { id: 'o:iron', members: [iron.id, iron.id] } as CatalogEntry, 'usages')).toEqual(normal);
  });
  it('contains all optional native routes, including distinct thermal centrifuge branches', () => {
    const layouts = Object.values(data.scenes).map(scene => new Set(scene.slots.map(slot => slot.key)));
    for (const key of ['crushed-ore-bath-mercury', 'crushed-ore-bath-sodium-persulfate', 'purified-ore-sift',
      'purified-dust-electromagnetic-separate', 'additional-recipe-outputs']) {
      expect(layouts.some(keys => keys.has(key)), key).toBe(true);
      expect(layouts.some(keys => !keys.has(key)), `optional ${key}`).toBe(true);
    }
    expect(layouts.some(keys => keys.has('ore-thermal-centrifuge-crushed') && keys.has('ore-thermal-centrifuge-purified'))).toBe(true);
  });
  it('preserves native slot geometry and orthogonal paths without orphan item groups', () => {
    for (const scene of Object.values(data.scenes)) {
      const bounds = oreSceneBounds(scene);
      expect(bounds.width).toBeGreaterThanOrEqual(166);
      for (const group of scene.groups) {
        expect(group.components.length).toBeGreaterThan(0);
        expect(scene.slots.some(slot => slot.pos[0] === group.pos[0] && slot.pos[1] === group.pos[1])).toBe(true);
        for (const component of group.components) expect(component.id).toMatch(/^[if]:/);
      }
      for (const slot of scene.slots) expect([18, 26]).toContain(slot.size);
      for (const path of scene.paths) expect(path.a[0] === path.b[0] || path.a[1] === path.b[1]).toBe(true);
    }
  });
});
