import { readFile } from 'node:fs/promises';
import { validateQuestExport, type QuestExportReport } from '../data-export/quest-items';
import type { QuestItemReference } from './references';
import { nbtIdentity } from '../../src/lib/nbt';
import { parseQuestJson, questSnbt, type SourceStack } from './source';

export function questStackIdentity(stack: SourceStack): string {
  return JSON.stringify([Boolean(stack.fluid), stack.item, stack.damage, stack.ore, stack.nbt ? nbtIdentity(stack.nbt) : '']);
}

/** Join the game's canonical IDs back to the exact quest stacks. This also
 * handles native registry remapping and wildcard groups without icon aliases. */
export async function exportedQuestItems(reportPath: string, requestsPath: string): Promise<Map<string, { goodsIds: string[]; unavailableReason?: string }>> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as QuestExportReport;
  const requests = parseQuestJson(await readFile(requestsPath, 'utf8')) as unknown as { version: string; references: QuestItemReference[] };
  validateQuestExport(requests.references, report, requests.version);
  const byId = new Map(requests.references.map(reference => [reference.id, reference.stack]));
  const result = new Map<string, { goodsIds: string[]; unavailableReason?: string }>();
  for (const row of report.references) {
    const raw = byId.get(row.id)!;
    const fluid = typeof raw['FluidName:8'] === 'string';
    const key = questStackIdentity({ item: String(raw[fluid ? 'FluidName:8' : 'id:8']), damage: Number(raw['Damage:2'] ?? 0),
      count: 1, ore: String(raw['OreDict:8'] ?? ''), fluid, ...(raw['tag:10'] ? { nbt: questSnbt(raw['tag:10']) } : {}) });
    const resolution = { goodsIds: row.goodsIds, ...(row.reason ? { unavailableReason: row.reason } : {}) };
    const previous = result.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(resolution)) throw new Error(`Inconsistent game resolution for quest stack ${key}`);
    result.set(key, resolution);
  }
  return result;
}
