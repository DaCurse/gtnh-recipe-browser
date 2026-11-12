import { trackEvent } from '../analytics';
import { loadQuestbook, questVersions, type QuestRepository } from './repository';
import type { QuestVersion } from './types';
import { questLinkId, questUrlId } from './types';
import { clearItemTouch, itemTouchState } from '../itemTouch.svelte';

function questbookUrl(base: string | URL): URL {
  const url = new URL(base);
  const version = url.searchParams.get('version');
  url.search = '';
  if (version) url.searchParams.set('version', version);
  url.searchParams.set('page', 'quests');
  return url;
}
interface QuestCamera { x: number; y: number; zoom: number }
class QuestbookState {
  repository = $state.raw<QuestRepository>();
  versions = $state<QuestVersion[]>([]);
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  progress = $state(0);
  error = $state('');
  version = $state('');
  chapterId = $state('');
  questId = $state('');
  query = $state('');
  searchLimit = $state(60);
  readonly cameras = new Map<string, QuestCamera>();
  private generation = 0;
  restore(params: URLSearchParams): void {
    this.questId = questLinkId(params.get('quest') ?? '') ?? '';
    this.chapterId = questLinkId(params.get('chapter') ?? '') ?? this.repository?.memberships.get(this.questId)?.[0]?.id ?? this.repository?.pack.chapters[0]?.id ?? '';
    this.query = params.get('quest-search') ?? '';
  }
  async load(recipeVersion: string, selected?: string): Promise<void> {
    if (this.status === 'loading' && !selected || this.status === 'ready' && (!selected || selected === this.version)) return;
    const generation = ++this.generation;
    const started = performance.now();
    this.status = 'loading'; this.progress = 0; this.error = '';
    try {
      const index = await questVersions();
      this.versions = index.value.versions;
      let remembered = '';
      try { remembered = localStorage.getItem('gtnh-quest-version') ?? ''; } catch { /* Optional preference. */ }
      const preferred = selected || new URL(location.href).searchParams.get('quest-version') || remembered || recipeVersion;
      const version = this.versions.find(version => version.version === preferred) ?? this.versions[0];
      if (!version) throw new Error('No questbook datasets are available');
      const repository = await loadQuestbook(version, index.url, percent => { if (generation === this.generation) this.progress = percent; });
      if (generation !== this.generation) return;
      this.repository = repository; this.version = version.version;
      if (!repository.chapters.has(this.chapterId)) this.chapterId = repository.memberships.get(this.questId)?.[0]?.id ?? repository.pack.chapters[0]?.id ?? '';
      this.status = 'ready'; this.progress = 100;
      trackEvent('questbook_loaded', { quest_version: this.version, duration_ms: Math.round(performance.now() - started), quest_count: repository.pack.quests.length, chapter_count: repository.pack.chapters.length });
      try { localStorage.setItem('gtnh-quest-version', version.version); } catch { /* Optional preference. */ }
    } catch (error) {
      if (generation === this.generation) { trackEvent('questbook_load_failed', { duration_ms: Math.round(performance.now() - started) }); this.error = error instanceof Error ? error.message : String(error); this.status = 'error'; }
    }
  }
  url(base: string | URL): URL {
    const url = questbookUrl(base);
    if (this.version) url.searchParams.set('quest-version', this.version);
    if (this.chapterId) url.searchParams.set('chapter', questUrlId(this.chapterId));
    if (this.questId) url.searchParams.set('quest', questUrlId(this.questId));
    if (this.query) url.searchParams.set('quest-search', this.query);
    return url;
  }
  private write(replace = false, returnTo?: string): void {
    clearItemTouch(); itemTouchState.menu = undefined;
    const url = this.url(location.href);
    if (url.href === location.href) return;
    if (replace) history.replaceState({ route: 'quests' }, '', url);
    else history.pushState({ route: 'quests', ...(returnTo ? { questReturnTo: returnTo } : {}) }, '', url);
  }
  chapter(id: string): void { this.chapterId = id; this.questId = ''; this.query = ''; this.write(); }
  open(id: string): void {
    if (!this.repository?.quests.has(id)) return;
    const returnTo = location.href;
    this.questId = id;
    if (!this.repository.chapters.get(this.chapterId)?.quests.some(quest => quest.id === id)) this.chapterId = this.repository.memberships.get(id)?.[0]?.id ?? this.chapterId;
    this.write(false, returnTo);
  }
  back(): void {
    const returnTo = history.state?.questReturnTo;
    if (typeof returnTo === 'string' && new URL(returnTo, location.href).origin === location.origin) history.back();
    else { this.questId = ''; this.write(true); }
  }
  search(query: string): void { this.query = query; this.questId = ''; this.searchLimit = 60; this.write(true); }
  async selectVersion(version: string, recipeVersion: string): Promise<void> {
    trackEvent('quest_version_changed', { previous_version: this.version, quest_version: version });
    this.questId = ''; this.chapterId = ''; this.query = ''; this.cameras.clear();
    await this.load(recipeVersion, version); this.write();
  }
}
export const questbook = new QuestbookState();
