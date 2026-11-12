import type { QuestPreviewRepository } from './linksTypes';
import type { Quest } from './types';
import { plainQuestText } from './text';

/** Keep public content readable in analytics across the full book and lazy item links. */
export function questAnalyticsProperties(quest: Quest, repository: QuestPreviewRepository, chapterId?: string) {
  const chapters = repository.chaptersForQuest(quest.id);
  const chapter = chapters.find(chapter => chapter.id === chapterId) ?? chapters[0];
  return {
    quest_id: quest.id,
    quest_name: plainQuestText(quest.name),
    quest_version: repository.version,
    secret: quest.secret,
    task_count: quest.tasks.length,
    ...(chapter ? { chapter_id: chapter.id, chapter_name: plainQuestText(chapter.name) } : {})
  };
}
