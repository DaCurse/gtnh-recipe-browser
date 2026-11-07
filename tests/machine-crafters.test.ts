import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addRecipeTypeCrafters, parseMachineCrafters, publishedMachineCrafters } from '../src/lib/machineCrafters';
import { machineCanProcessVoltage, machineCapabilitiesByCrafter, recipeCrafterId, recipeTypeCrafters, recipeTypeMachineCapabilities, type AdditionalCrafter } from '../src/lib/recipePresentation';

const type = { id: 'recipeType:gregtech:Furnace', name: 'Furnace', singleblocks: [{ id: 'microwave' }], multiblocks: [], defaultCrafter: { id: 'microwave' } };
const candidates: AdditionalCrafter[] = [
  { id: 'i:test:electric:0', role: 'singleblock', maxVoltageTier: 0 },
  { id: 'i:test:induction:0', role: 'singleblock', maxVoltageTier: 0 },
  { id: 'i:test:advanced:0', role: 'singleblock', maxVoltageTier: 1 }
];
describe('complete machine crafter lists', () => {
  it('keeps multiple families at one tier without replacing the display representative', () => {
    const complete = addRecipeTypeCrafters(type, candidates, new Set(candidates.map(value => value.id)));
    expect(complete.singleblocks).toEqual(type.singleblocks);
    expect(recipeTypeCrafters(complete)).toHaveLength(4);
    expect(addRecipeTypeCrafters(complete, candidates, new Set(candidates.map(value => value.id)))).toEqual(complete);
    const capabilities = machineCapabilitiesByCrafter([complete], [{ id: 'furnace-shard', recipeTypeId: type.id }]);
    expect(capabilities.get(candidates[0]!.id)?.[0]).toMatchObject({ maxVoltageTier: 0, recipeShards: ['furnace-shard'] });
    expect(capabilities.get(candidates[1]!.id)?.[0]?.maxVoltageTier).toBe(0);
    const advanced = capabilities.get(candidates[2]!.id)![0]!;
    expect(machineCanProcessVoltage(advanced, 0)).toBe(true);
    expect(machineCanProcessVoltage(advanced, 1)).toBe(true);
    expect(machineCanProcessVoltage(advanced, 2)).toBe(false);
  });
  it('rejects invalid annotations and missing catalogue references', () => {
    const source = { schemaVersion: 1, sourceScriptSha256: 'a'.repeat(64), types: { [type.id]: candidates } };
    expect(parseMachineCrafters(source)).toEqual(source);
    expect(() => parseMachineCrafters({ ...source, schemaVersion: 2 })).toThrow();
    expect(() => parseMachineCrafters({ ...source, types: { [type.id]: [{ ...candidates[0], maxVoltageTier: 14 }] } })).toThrow();
    expect(() => addRecipeTypeCrafters(type, candidates, new Set())).toThrow(/missing from the catalogue/);
    expect(publishedMachineCrafters('unrelated-dataset')).toBeUndefined();
  });
  it('corrects a compacted representative tier using authoritative source metadata', () => {
    const legacy = { id: 'bio', singleblocks: [{ id: 'i:test:hv:0' }], multiblocks: [], defaultCrafter: { id: 'i:test:hv:0' } };
    const corrected = addRecipeTypeCrafters(legacy, [{ id: 'i:test:hv:0', role: 'singleblock', maxVoltageTier: 2 }], new Set(['i:test:hv:0']));
    expect(recipeTypeMachineCapabilities(corrected)[0]?.maxVoltageTier).toBe(2);
    expect(recipeCrafterId(corrected, 2)).toBe('i:test:hv:0');
    expect(recipeTypeCrafters(corrected)).toHaveLength(1);
  });
  it('recovers every lost current-release furnace family from the original source', () => {
    const source = publishedMachineCrafters('2.9.0-v7-rbd0b48ae8ad7')!;
    const restored = source.types[type.id]!;
    expect(restored).toHaveLength(17);
    expect(restored).toContainEqual({ id: 'i:gregtech:gt.blockmachines:262', role: 'singleblock', maxVoltageTier: 1 });
    expect(restored).toContainEqual({ id: 'i:gregtech:gt.blockmachines:671', role: 'singleblock', maxVoltageTier: 0 });
  });
  it('reads source catalysts without tier collisions and uses input voltage rather than other tier labels', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gtnh-crafters-'));
    try {
      const sql = (table: string, values: string[]) => `INSERT INTO ${table} VALUES(${values.map(value => `'${value.replaceAll("'", "''")}'`).join(',')})\n`;
      const item = (id: string, name: string, tooltip: string) => sql('ITEM', [id, 'image', name, '0', '1', name, '0', '64', 'test', '', tooltip, name]);
      const source = item('one', 'electric', 'Voltage IN: 128 (MV)\\u000aVoltage OUT: 32 (LV)')
        + item('two', 'induction', 'Voltage IN: 128 (MV)')
        + sql('RECIPE_TYPE', ['furnace-mv', 'gregtech', '0', '0', '0', '0', '', '1', '1', '1', '1', 'TRUE', 'Furnace (MV)'])
        + sql('RECIPE_TYPE_ITEM', ['furnace-mv', 'one']) + sql('RECIPE_TYPE_ITEM', ['furnace-mv', 'two']);
      const script = join(directory, 'source.script'), output = join(directory, 'crafters.json');
      await writeFile(script, source);
      execFileSync('python3', ['tools/data-export/machine-crafters.py', '--script', script, '--output', output]);
      const parsed = parseMachineCrafters(JSON.parse(await readFile(output, 'utf8')));
      expect(parsed.sourceScriptSha256).toBe(createHash('sha256').update(source).digest('hex'));
      expect(parsed.types[type.id]).toEqual([
        { id: 'i:test:electric:0', role: 'singleblock', maxVoltageTier: 1 },
        { id: 'i:test:induction:0', role: 'singleblock', maxVoltageTier: 1 }
      ]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
