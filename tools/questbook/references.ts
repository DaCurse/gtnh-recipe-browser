import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseQuestJson, type NbtObject } from './source';

export interface QuestItemReference {
  id: string;
  source: string;
  path: string;
  role: 'quest-icon' | 'chapter-icon' | 'requirement' | 'reward' | 'decoration';
  title: string;
  stack: NbtObject;
}

/** Inventory the native stacks rather than only those absent from today's pack.
 * Native typed NBT is retained for the game's own BetterQuesting decoder. */
export async function questItemReferences(root: string): Promise<QuestItemReference[]> {
  const references: QuestItemReference[] = [];
  for (const file of (await readdir(root, { recursive: true })).map(file => file.replaceAll('\\', '/')).filter(file => file.endsWith('.json')).sort()) {
    const data = parseQuestJson(await readFile(join(root, file), 'utf8'));
    const properties = data['properties:10'] as NbtObject | undefined;
    const betterquesting = properties?.['betterquesting:10'] as NbtObject | undefined;
    const title = String(betterquesting?.['name:8'] ?? file);
    const visit = (value: unknown, path: string): void => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const object = value as NbtObject;
      if (typeof object['id:8'] === 'string' && ('Count:3' in object || 'Count:1' in object)
        || typeof object['FluidName:8'] === 'string' && 'Amount:3' in object) {
        const role = path.startsWith('/rewards:9/') ? 'reward' : path.startsWith('/tasks:9/') ? 'requirement'
          : path.endsWith('/confetti_icon:10') ? 'decoration' : file.endsWith('/QuestLine.json') ? 'chapter-icon' : 'quest-icon';
        references.push({ id: `${file}#${path}`, source: file, path, role, title, stack: object });
        return; // An item's nested NBT is part of this stack, not another request.
      }
      for (const [key, child] of Object.entries(object)) visit(child, `${path}/${key}`);
    };
    visit(data, '');
  }
  return references;
}
