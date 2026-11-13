import { createHash } from 'node:crypto';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encode } from '@msgpack/msgpack';
import { itemNavigationIdentity } from '../../src/lib/itemNavigation';
import { questNbtMatches } from '../../src/lib/nbt';
import type { CatalogEntry, AssetDescriptor } from '../../src/lib/types';
import type { SpecialGoods } from '../../src/lib/specialData';
import type { QuestPack } from '../../src/lib/questbook/types';
import type {
  QuestItemRelations,
  QuestLinksData,
  QuestLinksVersions,
} from '../../src/lib/questbook/linksTypes';
import type { SourceStack } from './source';

export function questItemRelations(
  pack: QuestPack,
  entries: ReadonlyMap<string, CatalogEntry>,
  sourceStacks: ReadonlyMap<SpecialGoods, SourceStack>,
): Map<string, QuestItemRelations> {
  const byBase = new Map<string, CatalogEntry[]>(),
    bySemantic = new Map<string, CatalogEntry[]>();
  const base = (entry: CatalogEntry) =>
    JSON.stringify([entry.mod, entry.internalName, entry.damage ?? 0]);
  for (const entry of entries.values()) {
    if (entry.kind !== 'item') continue;
    const key = base(entry),
      members = byBase.get(key) ?? [];
    members.push(entry);
    byBase.set(key, members);
    const identity = itemNavigationIdentity(entry);
    if (identity) {
      const matches = bySemantic.get(identity) ?? [];
      matches.push(entry);
      bySemantic.set(identity, matches);
    }
  }
  const relations = new Map<string, QuestItemRelations>();
  const add = (id: string, quest: string, direction: 'recipes' | 'usages', good: SpecialGoods) => {
    const row = relations.get(id) ?? { recipes: [], usages: [] };
    if (!row[direction].includes(quest)) row[direction].push(quest);
    const goods = (row.goods ??= {});
    const linked = (goods[quest] ??= { recipes: [], usages: [] });
    if (!linked[direction].some((item) => JSON.stringify(item) === JSON.stringify(good)))
      linked[direction].push(good);
    relations.set(id, row);
  };
  const members = (good: SpecialGoods) =>
    (good.alternatives?.length
      ? good.alternatives
      : (entries.get(good.goodsId)?.members ?? [good.goodsId])
    )
      .map((id) => entries.get(id))
      .filter((entry): entry is CatalogEntry => Boolean(entry));
  for (const quest of pack.quests) {
    for (const section of quest.rewards)
      for (const good of section.items)
        for (const entry of members(good)) {
          const key = itemNavigationIdentity(entry);
          for (const candidate of key ? (bySemantic.get(key) ?? [entry]) : [entry])
            add(candidate.id, quest.id, 'recipes', {
              ...good,
              goodsId: candidate.id,
              tooltipNotes:
                section.type === 'choice'
                  ? [...(good.tooltipNotes ?? []), 'Choice reward']
                  : good.tooltipNotes,
            });
        }
    for (const section of quest.tasks.filter((task) =>
      ['crafting', 'retrieval', 'optional_retrieval', 'fluid'].includes(task.type),
    )) {
      for (const good of section.items)
        for (const entry of members(good)) {
          if (entry.kind === 'fluid') {
            add(entry.id, quest.id, 'usages', good);
            continue;
          }
          const source = sourceStacks.get(good);
          const required = source ? source.nbt : (entry.nbt ?? undefined);
          for (const candidate of byBase.get(base(entry)) ?? [entry])
            if (
              section.nbtMatch === 'ignore' ||
              questNbtMatches(required, candidate.nbt ?? undefined, section.nbtMatch === 'partial')
            )
              add(candidate.id, quest.id, 'usages', { ...good, goodsId: candidate.id });
        }
    }
  }
  // Group pages show the union of their actual members, without inventing items.
  for (const entry of entries.values())
    if (entry.members?.length)
      for (const id of entry.members) {
        const related = relations.get(id);
        if (!related) continue;
        for (const direction of ['recipes', 'usages'] as const)
          for (const quest of related[direction])
            for (const good of related.goods?.[quest]?.[direction] ?? [])
              add(entry.id, quest, direction, good);
      }
  for (const row of relations.values()) {
    row.recipes.sort();
    row.usages.sort();
  }
  return relations;
}

export async function writeQuestLinks(
  pack: QuestPack,
  entries: ReadonlyMap<string, CatalogEntry>,
  sourceStacks: ReadonlyMap<SpecialGoods, SourceStack>,
  recipeDatasetId: string,
  publicRoot: string,
): Promise<void> {
  const directory = join(publicRoot, 'quests');
  const asset = async (value: unknown): Promise<AssetDescriptor> => {
    const bytes = gzipSync(encode(value), { level: 9 });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(directory, `${sha256}.links.mpk`), bytes);
    return {
      id: `quest-links-${sha256.slice(0, 12)}`,
      url: `./${sha256}.links.mpk`,
      sha256,
      bytes: bytes.length,
      encoding: 'gzip',
    };
  };
  const relations = questItemRelations(pack, entries, sourceStacks);
  const partitions = new Map<string, Record<string, QuestItemRelations>>();
  for (const [id, row] of [...relations].sort(([a], [b]) => a.localeCompare(b))) {
    const prefix = createHash('sha256').update(id).digest('hex')[0]!;
    const bucket = partitions.get(prefix) ?? {};
    bucket[id] = row;
    partitions.set(prefix, bucket);
  }
  const buckets: Record<string, AssetDescriptor> = {};
  for (const [prefix, rows] of [...partitions].sort()) buckets[prefix] = await asset(rows);
  const bookId = 'i:questbook:ItemQuestBook:0';
  const iconIds = new Set([bookId, ...pack.quests.map((quest) => quest.icon.goodsId)]);
  const items = [...iconIds].sort().map((id) => {
    const item = entries.get(id);
    if (!item?.icon) throw new Error(`Missing quest-link icon ${id}`);
    return {
      id: item.id,
      name: item.name,
      mod: item.mod,
      kind: item.kind,
      tooltip: [],
      color: item.color,
      glyph: item.glyph,
      searchable: false,
      icon: {
        ...item.icon,
        url: './' + new URL(item.icon.url, 'https://quest-build.invalid/').pathname.slice(1),
      },
    } satisfies CatalogEntry;
  });
  const chapters = Object.fromEntries(
    pack.quests.map((quest) => [
      quest.id,
      pack.chapters
        .filter((chapter) => chapter.quests.some((placement) => placement.id === quest.id))
        .map((chapter) => ({ id: chapter.id, name: chapter.name })),
    ]),
  );
  const all = { recipes: new Set<string>(), usages: new Set<string>() };
  for (const row of relations.values())
    for (const direction of ['recipes', 'usages'] as const)
      for (const id of row[direction]) all[direction].add(id);
  const root: QuestLinksData = {
    schemaVersion: 1,
    version: pack.version,
    recipeDatasetId,
    bookId,
    buckets,
    items,
    chapters,
    all: { recipes: [...all.recipes].sort(), usages: [...all.usages].sort() },
    quests: pack.quests.map((quest) => ({
      ...quest,
      description: '',
      tasks: quest.tasks.map((task) => ({ ...task, items: [], lines: [], quests: [] })),
      rewards: [],
    })),
  };
  const descriptor = await asset(root);
  await writeFile(
    join(directory, 'links-versions.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        versions: [{ recipeDatasetId, version: pack.version, root: descriptor }],
      } satisfies QuestLinksVersions,
      null,
      2,
    ) + '\n',
  );
  const retained = new Set(
    [...Object.values(buckets), descriptor].map((asset) => `${asset.sha256}.links.mpk`),
  );
  for (const filename of await readdir(directory))
    if (/^[a-f0-9]{64}\.links\.mpk$/.test(filename) && !retained.has(filename))
      await unlink(join(directory, filename));
  console.log(
    `Quest links: ${relations.size} item/group scopes, ${partitions.size} lazy buckets; ${descriptor.bytes} bytes of quest previews.`,
  );
}
