import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { questItemReferences } from './references';
import { questSnbt, type NbtObject } from './source';
import { nbtIdentity } from '../../src/lib/nbt';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw new Error('Usage: tsx tools/questbook/export-list.ts <DefaultQuests> <output.json>');
const references = await questItemReferences(root);
const audit = JSON.parse(await readFile('.pack-output/quest-icon-audit.json', 'utf8')) as {
  unresolved: { item: string; damage: number; ore: string; fluid: boolean; nbt?: string; reason: string }[];
};
const identity = (stack: NbtObject): string => JSON.stringify([
  stack['FluidName:8'] ?? stack['id:8'], stack['Damage:2'] ?? 0, stack['OreDict:8'] ?? '',
  stack['tag:10'] ? nbtIdentity(questSnbt(stack['tag:10'])) : ''
]);
const groups = new Map<string, typeof references>();
for (const reference of references) {
  const key = identity(reference.stack), uses = groups.get(key) ?? [];
  uses.push(reference); groups.set(key, uses);
}
const missing = audit.unresolved.map(item => {
  const key = JSON.stringify([item.item, item.damage, item.ore, item.nbt ? nbtIdentity(item.nbt) : '']);
  return { ...item, uses: groups.get(key) ?? [] };
});
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ schemaVersion: 1, version: '2.9.0', references, missing }, null, 2) + '\n');
const cell = (value: string) => value.replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
const report = ['# GTNH 2.9.0 questbook export shopping list', '',
  `All ${references.length} native stack references (${groups.size} distinct item/fluid/ore/NBT identities) are export inputs, including requirements, rewards, choices, chapter icons and quest icons.`, '',
  ...(['quest-icon', 'chapter-icon', 'requirement', 'reward', 'decoration'] as const).map(role => `- ${role}: ${references.filter(reference => reference.role === role).length} references`), '',
  'Every valid stack goes through the existing game item/fluid/ore factories. Wildcards expand to registered subitems. Invalid game references must be recorded explicitly; never substitute unrelated metadata or draw replacement assets.', '',
  `## Missing from the current recipe dataset (${missing.length} distinct references)`, '',
  '| Registry ID | Damage | NBT | Reason | Uses | Locations |', '| --- | ---: | --- | --- | ---: | --- |',
  ...missing.map(item => `| ${cell(item.item)} | ${item.damage} | ${item.nbt ? 'Yes' : 'No'} | ${item.reason} | ${item.uses.length} | ${cell([...new Set(item.uses.map(use => `${use.role}: ${use.title}`))].join('; '))} |`), '',
  'The machine-readable inventory includes full typed NBT, source JSON paths, and every use. Generate it with:', '',
  '```sh', `npx tsx tools/questbook/export-list.ts <DefaultQuests> ${output.replaceAll('\\', '/')}`, '```', ''];
await writeFile(`${output.replace(/\.json$/i, '')}.md`, report.join('\n'));
console.log(`${references.length} references, ${groups.size} unique stacks, ${missing.length} current missing variants; ${missing.filter(item => !item.uses.length).length} unmatched audit entries.`);
