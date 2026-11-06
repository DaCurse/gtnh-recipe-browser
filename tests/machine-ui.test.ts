import { describe, expect, it } from 'vitest';
import { machineUiFor, machineUiBounds, UI_GROUPS, machineUiProfiles } from '../src/lib/machineUi';
import { voltageTierDescription, voltageTierFormats } from '../src/lib/recipeMetadata';
import type { Recipe } from '../src/lib/types';

const profiles = machineUiProfiles;
function recipeFor(name: string): Recipe {
  const profile = profiles.find(profile => profile.name === name)!;
  const dimensions = (group: typeof UI_GROUPS[number]) => ({
    columns: new Set(profile[group].map(slot => slot.pos[0])).size,
    rows: new Set(profile[group].map(slot => slot.pos[1])).size
  });
  return { id: 'test', type: name, typeId: `recipeType:1:gregtech:${name}`,
    gtnhVersion: '2.9.0', inputs: [], outputs: [],
    layout: { itemInputs: dimensions('itemInputs'), itemOutputs: dimensions('itemOutputs'),
      fluidInputs: dimensions('fluidInputs'), fluidOutputs: dimensions('fluidOutputs') } };
}
describe('runtime-derived machine layouts', () => {
  it('preserves GTNH voltage colours and high-tier formatting', () => {
    expect(voltageTierFormats('MV')).toEqual(['6']);
    expect(voltageTierFormats('UV')).toEqual(['2', 'n']);
    expect(voltageTierFormats('UIV')).toEqual(['1', 'l', 'n']);
    expect(voltageTierFormats('unrecognized')).toEqual([]);
    expect(voltageTierDescription('LV')).toBe('Tier: Low Voltage');
    expect(voltageTierDescription('UV')).toBe('Tier: Ultimate Voltage');
  });
  it('retains the distillation tower output order instead of flattening it row-major', () => {
    const profile = machineUiFor(recipeFor('Distillation Tower'))!;
    expect(profile.itemOutputs[0]!.pos).toEqual([106,62]);
    expect(profile.fluidOutputs.slice(0,4).map(slot => slot.pos)).toEqual([[124,62],[142,62],[106,44],[124,44]]);
  });
  it('retains the assembly line custom progress path', () => {
    const profile = machineUiFor(recipeFor('Assemblyline Process'))!;
    expect(profile.itemInputs).toHaveLength(16);
    expect(profile.widgets.filter(widget => widget.kind === 'ProgressBar').map(widget => widget.size))
      .toEqual([[17,72],[18,72],[10,18]]);
  });
  it('uses identical geometry safely when upstream categories share a display name', () => {
    expect(machineUiFor(recipeFor('Furnace'))?.id).toBe('gt.recipe.furnace');
    expect(machineUiFor(recipeFor('Cutting Machine'))?.id).toBe('gt.recipe.cuttingsaw');
  });
  it('falls back for another release, unrelated mod, or incompatible capacity', () => {
    const recipe = recipeFor('Mixer');
    expect(machineUiFor({ ...recipe, gtnhVersion: '2.8.0' })).toBeUndefined();
    expect(machineUiFor({ ...recipe, typeId: 'recipeType:ic2:Mixer' })).toBeUndefined();
    expect(machineUiFor({ ...recipe, layout: { ...recipe.layout, fluidInputs: { columns: 99, rows: 1 } } })).toBeUndefined();
  });
  it('falls back when a custom frontend stacks slots for recipe-specific rotation', () => {
    expect(machineUiFor(recipeFor('Baryonic Perfection'))).toBeUndefined();
  });
  it('never drops extra recipe slots to make them fit a native frontend', () => {
    const recipe = recipeFor('Mixer');
    expect(machineUiFor({ ...recipe, inputs: [{ id: 'item:extra', slot: 100, kind: 'item', amount: 1 }] })).toBeUndefined();
  });
  it('has finite slot positions and an atlas viewport containing every sprite crop', () => {
    expect(profiles).toHaveLength(172);
    for (const profile of profiles) {
      const bounds = machineUiBounds(profile);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      for (const group of UI_GROUPS) {
        for (const slot of profile[group]) for (const coordinate of slot.pos) expect(Number.isFinite(coordinate)).toBe(true);
      }
      for (const texture of [...profile.widgets.map(widget => widget.texture),
        ...UI_GROUPS.flatMap(group => profile[group].flatMap(slot => slot.overlay ? [slot.overlay] : []))]) {
        expect(texture.file).toMatch(/^atlas-[a-f0-9]{20}\.png$/);
        const [u0,v0,u1,v1] = texture.uv;
        expect(u0).toBeGreaterThanOrEqual(0); expect(v0).toBeGreaterThanOrEqual(0);
        expect(u1).toBeLessThanOrEqual(1); expect(v1).toBeLessThanOrEqual(1);
        expect(u1).toBeGreaterThan(u0); expect(v1).toBeGreaterThan(v0);
      }
    }
  });
});
