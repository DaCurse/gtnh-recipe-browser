import { decode } from '@msgpack/msgpack';
import { fetchJsonNetworkFirst, fetchVerified, decompress, yieldToBrowser } from '../datasetAssets';
import type { QuestPack, QuestVersion, QuestVersions, Quest, QuestChapter } from './types';
import type { CatalogEntry } from '../types';
import { plainQuestText } from './text';

export class QuestRepository {
  readonly quests = new Map<string, Quest>();
  readonly chapters = new Map<string, QuestChapter>();
  readonly items = new Map<string, CatalogEntry>();
  readonly memberships = new Map<string, QuestChapter[]>();
  private readonly searchText = new Map<string, string>();
  private constructor(readonly pack: QuestPack) {}
  static async load(version: QuestVersion, indexUrl: string, report: (percent: number) => void): Promise<QuestRepository> {
    const bytes = await fetchVerified(version, indexUrl, ({ loaded, total }) => report(Math.round(loaded / Math.max(1, total) * 85)));
    await yieldToBrowser();
    const pack = decode(await decompress(bytes)) as QuestPack;
    if (pack.schemaVersion !== 1 || pack.version !== version.version || pack.sourceCommit !== version.sourceCommit
      || !Array.isArray(pack.quests) || pack.quests.length !== version.questCount || !Array.isArray(pack.chapters) || pack.chapters.length !== version.chapterCount
      || !Array.isArray(pack.items) || !pack.images) throw new Error('Questbook dataset identity mismatch');
    const repository = new QuestRepository(pack);
    for (const entry of pack.items) {
      if (entry.icon) entry.icon = { ...entry.icon, url: new URL(entry.icon.url, new URL('../', indexUrl)).href };
      repository.items.set(entry.id, entry);
    }
    for (const [key, value] of Object.entries(pack.images)) pack.images[key] = new URL(value, new URL('../', indexUrl)).href;
    for (const chapter of pack.chapters) {
      repository.chapters.set(chapter.id, chapter);
      for (const placement of chapter.quests) {
        const memberships = repository.memberships.get(placement.id) ?? [];
        memberships.push(chapter); repository.memberships.set(placement.id, memberships);
      }
    }
    for (let start = 0; start < pack.quests.length; start += 100) {
      for (const quest of pack.quests.slice(start, start + 100)) {
        repository.quests.set(quest.id, quest);
        repository.searchText.set(quest.id, [plainQuestText(quest.name), plainQuestText(quest.description),
          ...(repository.memberships.get(quest.id) ?? []).map(chapter => plainQuestText(chapter.name)),
          ...[...quest.tasks, ...quest.rewards].flatMap(section => [section.title, ...section.lines, ...section.items.map(item => repository.items.get(item.goodsId)?.name ?? item.label ?? '')])].join(' ').normalize('NFKD').toLowerCase());
      }
      report(Math.min(100, 85 + Math.round((start + 100) / pack.quests.length * 15)));
      await yieldToBrowser();
    }
    if (repository.quests.size !== pack.quests.length || repository.chapters.size !== pack.chapters.length) throw new Error('Duplicate questbook IDs');
    return repository;
  }
  async entryFor(id: string): Promise<CatalogEntry | undefined> { return this.items.get(id); }
  destination(id: string): string { return this.pack.navigationTargets[id] ?? id; }
  search(query: string): Quest[] {
    const terms = query.normalize('NFKD').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.pack.quests.filter(quest => terms.every(term => this.searchText.get(quest.id)?.includes(term)));
  }
}

let versionsPromise: Promise<{ url: string; value: QuestVersions }> | undefined;
const loads = new Map<string, Promise<QuestRepository>>();
export function questVersions(): Promise<{ url: string; value: QuestVersions }> {
  if (!versionsPromise) {
    const pending = fetchJsonNetworkFirst<QuestVersions>(new URL('./quests/versions.json', location.href).href, 'questbook-versions', 400)
      .then(result => {
        if (result.value.schemaVersion !== 1 || !Array.isArray(result.value.versions) || !result.value.versions.length) throw new Error('Invalid questbook versions');
        return result;
      });
    versionsPromise = pending;
    void pending.catch(() => { versionsPromise = undefined; });
  }
  return versionsPromise;
}
export function loadQuestbook(version: QuestVersion, indexUrl: string, report: (percent: number) => void): Promise<QuestRepository> {
  let pending = loads.get(version.sha256);
  if (!pending) {
    pending = QuestRepository.load(version, indexUrl, report);
    loads.set(version.sha256, pending);
    void pending.catch(() => loads.delete(version.sha256));
  }
  return pending;
}
