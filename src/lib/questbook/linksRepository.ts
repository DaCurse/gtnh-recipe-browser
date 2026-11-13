import { decode } from '@msgpack/msgpack';
import { assetDigest } from '../integrity';
import { decompress, fetchJsonNetworkFirst, fetchVerified } from '../datasetAssets';
import type { CatalogEntry, RecipeView } from '../types';
import type { SpecialRecord, SpecialRepository, SpecialViewType } from '../specialData';
import type { Quest } from './types';
import type {
  QuestItemRelations,
  QuestLinksData,
  QuestLinksVersions,
  QuestPreviewRepository,
} from './linksTypes';
import { plainQuestText } from './text';

export class QuestLinksRepository implements SpecialRepository, QuestPreviewRepository {
  readonly quests: ReadonlyMap<string, Quest>;
  readonly items: ReadonlyMap<string, CatalogEntry>;
  readonly specialViewTypes: SpecialViewType[];
  private readonly relations = new Map<string, QuestItemRelations>();
  private readonly loads = new Map<string, Promise<void>>();
  constructor(
    readonly data: QuestLinksData,
    private readonly indexUrl: string,
  ) {
    this.quests = new Map(data.quests.map((quest) => [quest.id, quest]));
    this.items = new Map(
      data.items.map((entry) => [
        entry.id,
        {
          ...entry,
          icon: entry.icon
            ? { ...entry.icon, url: new URL(entry.icon.url, new URL('../', indexUrl)).href }
            : undefined,
        },
      ]),
    );
    this.specialViewTypes = [
      { id: 'quests', label: 'Quests', category: 'quest', iconId: data.bookId, order: 110 },
    ];
  }
  get version(): string {
    return this.data.version;
  }
  chaptersForQuest(id: string): readonly { id: string; name: string }[] {
    return this.data.chapters[id] ?? [];
  }
  async prepare(id: string): Promise<void> {
    const prefix = assetDigest(new TextEncoder().encode(id))[0]!;
    const descriptor = this.data.buckets[prefix];
    if (!descriptor) return;
    let pending = this.loads.get(prefix);
    if (!pending) {
      pending = fetchVerified(descriptor, this.indexUrl).then(async (bytes) => {
        const rows = decode(await decompress(bytes)) as Record<string, QuestItemRelations>;
        for (const [key, row] of Object.entries(rows)) this.relations.set(key, row);
      });
      this.loads.set(prefix, pending);
      void pending.catch(() => this.loads.delete(prefix));
    }
    await pending;
  }
  countFor(id: string, view: RecipeView): number {
    return view === 'machineUsages' ? 0 : (this.relations.get(id)?.[view].length ?? 0);
  }
  private records(
    ids: readonly string[],
    view: RecipeView,
    relations?: QuestItemRelations,
  ): SpecialRecord[] {
    return ids.map((id) => {
      const quest = this.quests.get(id);
      if (!quest) throw new Error(`Unknown linked quest ${id}`);
      const chapters = this.data.chapters[id] ?? [];
      return {
        id: `quest:${id}`,
        category: 'quest',
        title: plainQuestText(quest.name),
        subtitle: chapters.map((chapter) => plainQuestText(chapter.name)).join(' · '),
        searchText: plainQuestText(
          [quest.name, ...chapters.map((chapter) => chapter.name)].join(' '),
        ),
        inputs: relations?.goods?.[id]?.usages ?? [],
        outputs: relations?.goods?.[id]?.recipes ?? [],
        payload: { questId: id, view },
      };
    });
  }
  async specialFor(id: string, view: RecipeView): Promise<SpecialRecord[]> {
    if (view === 'machineUsages') return [];
    await this.prepare(id);
    return this.records(this.relations.get(id)?.[view] ?? [], view, this.relations.get(id));
  }
  async specialForAll(view: RecipeView): Promise<SpecialRecord[]> {
    return view === 'machineUsages' ? [] : this.records(this.data.all[view], view);
  }
}

const loads = new Map<string, Promise<QuestLinksRepository | undefined>>();
export function loadQuestLinks(datasetId: string): Promise<QuestLinksRepository | undefined> {
  let pending = loads.get(datasetId);
  if (!pending) {
    const url = new URL(`${import.meta.env.BASE_URL}quests/links-versions.json`, location.href)
      .href;
    pending = fetchJsonNetworkFirst(url, 'quest-links-versions', 400).then(async (result) => {
      const versions = result.value as QuestLinksVersions;
      if (versions.schemaVersion !== 1) throw new Error('Invalid quest links version index');
      const version = versions.versions.find((version) => version.recipeDatasetId === datasetId);
      if (!version) return undefined;
      const data = decode(
        await decompress(await fetchVerified(version.root, url)),
      ) as QuestLinksData;
      if (data.schemaVersion !== 1 || data.recipeDatasetId !== datasetId)
        throw new Error('Quest links dataset mismatch');
      return new QuestLinksRepository(data, url);
    });
    loads.set(datasetId, pending);
    void pending.catch(() => loads.delete(datasetId));
  }
  return pending;
}
