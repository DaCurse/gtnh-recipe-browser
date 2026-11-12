import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { questItemReferences } from '../tools/questbook/references';
import { validateQuestExport, validateQuestGoods, type QuestExportReport } from '../tools/data-export/quest-items';
import { exportedQuestItems, questStackIdentity } from '../tools/questbook/exportedItems';
import { questSnbt } from '../tools/questbook/source';
import { configureUnattendedClient } from '../tools/data-export/client-options';

describe('questbook export inventory', () => {
  it('includes icons, requirements, choice rewards and exact spawn egg NBT without treating nested tags as separate items', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quest-export-'));
    try {
      await mkdir(join(root, 'Quests'));
      const egg = { 'id:8': 'minecraft:spawn_egg', 'Count:3': 4, 'Damage:2': 90,
        'tag:10': { 'EntityTag:10': { 'id:8': 'Pig', 'CustomName:8': 'Quest reward', 'Seed:4': '9223372036854775807' } } };
      await writeFile(join(root, 'Quests/test.json'), JSON.stringify({
        'properties:10': { 'betterquesting:10': { 'name:8': 'Test', 'icon:10': { 'id:8': 'minecraft:command_block', 'Count:3': 1 } } },
        'tasks:9': { '0:10': { 'requiredItems:9': { '0:10': { 'id:8': 'minecraft:wool', 'Damage:2': 32767, 'Count:3': 1 } } } },
        'rewards:9': { '0:10': { 'choices:9': { '0:10': egg } } }
      }));
      const references = await questItemReferences(root);
      expect(references).toHaveLength(3);
      expect(references.map(reference => reference.role)).toEqual(['quest-icon', 'requirement', 'reward']);
      expect(references[2]!.stack).toEqual(egg);
      expect(references.every(reference => reference.id === `${reference.source}#${reference.path}`)).toBe(true);
      const report: QuestExportReport = { schemaVersion: 1, version: '2.9.0', references: references.map(reference => ({
        id: reference.id, status: 'resolved', goodsIds: ['i:minecraft:spawn_egg:90:exact-nbt']
      })) };
      expect(() => validateQuestExport(references, report, '2.9.0')).not.toThrow();
      expect(() => validateQuestExport(references, { ...report, references: report.references.slice(1) }, '2.9.0')).toThrow(/omitted/);
      expect(() => validateQuestExport(references, { ...report, references: [report.references[0]!, ...report.references] }, '2.9.0')).toThrow(/duplicate/);
      expect(() => validateQuestGoods(report, new Set())).toThrow(/not retained/);
      expect(() => validateQuestGoods(report, new Set(['i:minecraft:spawn_egg:90:exact-nbt']))).not.toThrow();
      const requestFile = join(root, 'requests.json'), reportFile = join(root, 'report.json');
      await writeFile(requestFile, JSON.stringify({ version: '2.9.0', references }));
      await writeFile(reportFile, JSON.stringify(report));
      const exported = await exportedQuestItems(reportFile, requestFile);
      expect(exported.get(questStackIdentity({ item: 'minecraft:spawn_egg', damage: 90, count: 1, ore: '',
        nbt: questSnbt(egg['tag:10']) }))).toEqual({ goodsIds: ['i:minecraft:spawn_egg:90:exact-nbt'] });
      report.references[2] = { id: references[2]!.id, status: 'unavailable', goodsIds: [], reason: 'unregistered-item' };
      await writeFile(reportFile, JSON.stringify(report));
      expect((await exportedQuestItems(reportFile, requestFile)).get(questStackIdentity({ item: 'minecraft:spawn_egg', damage: 90, count: 1, ore: '',
        nbt: questSnbt(egg['tag:10']) }))).toEqual({ goodsIds: [], unavailableReason: 'unregistered-item' });
      await writeFile(join(root, 'options.txt'), 'renderDistance:7\npauseOnLostFocus:true\nfullscreen:true\n');
      await configureUnattendedClient(root);
      const options = await readFile(join(root, 'options.txt'), 'utf8');
      expect(options).toBe('renderDistance:7\npauseOnLostFocus:false\nfullscreen:false\n');
      await configureUnattendedClient(root);
      expect(await readFile(join(root, 'options.txt'), 'utf8')).toBe(options);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
