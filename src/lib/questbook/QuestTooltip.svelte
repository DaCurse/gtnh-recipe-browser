<script lang="ts">
  import QuestText from './QuestText.svelte';
  import { questHighlight } from './theme';
  import type { Quest } from './types';
  import type { QuestPreviewRepository } from './linksTypes';
  let { quest, repository, hint = false }: { quest: Quest; repository: QuestPreviewRepository; hint?: boolean } = $props();
</script>
<div class="minecraft-tooltip quest-tooltip" role="tooltip">
  <div class="tooltip-header"><QuestText text={quest.name} /></div>
  {#if quest.secret}<p class="secret">Secret quest</p>{/if}
  <p class="task-count">{quest.tasks.length} {quest.tasks.length === 1 ? 'Task' : 'Tasks'}</p>
  <p class="requirements">Requires: <span class="logic" style:color={questHighlight}>({quest.logic})</span></p>
  {#if quest.requirements.length}
    <ul>{#each quest.requirements as requirement (requirement.id)}
      <li><QuestText text={repository.quests.get(requirement.id)?.name ?? 'Unavailable quest'} />{#if requirement.type !== 'normal'}<small> ({requirement.type})</small>{/if}</li>
    {/each}</ul>
  {:else}<p class="none">None</p>{/if}
  {#if hint}<div class="tooltip-action">Tap quest again to open</div>{/if}
</div>
<style>
  .quest-tooltip p { margin:6px 0 0; } .requirements,.none,ul { color:#aaa; } ul { margin:4px 0 0; padding-left:22px; }
  .secret { color:#c8b47b; } small { font-size:12px; color:#777; text-shadow:none; }
  .task-count { color:#999; }
  /* GuiQuest uses PresetColor.TEXT_HIGHLIGHT for task operators. */
</style>
