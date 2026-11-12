<script lang="ts">
  import QuestIcon from './QuestIcon.svelte';
  import QuestText from './QuestText.svelte';
  import QuestSection from './QuestSection.svelte';
  import BackIcon from '../BackIcon.svelte';
  import { swipeBack } from '../swipeBack';
  import type { Quest } from './types';
  import type { QuestRepository } from './repository';
  import type { RecipeView } from '../types';
  let { quest, repository, back, openQuest, navigate }: {
    quest: Quest; repository: QuestRepository; back: () => void; openQuest: (id: string) => void; navigate: (id: string, view: RecipeView) => void;
  } = $props();
  let viewportWidth = $state(0);
</script>
<svelte:window bind:innerWidth={viewportWidth} />
<section class="quest-detail" aria-label="Quest details" use:swipeBack={back}>
  <header class="quest-title">
    <button class="mc-button quest-back" aria-label="Back to quests" onclick={back}><BackIcon /><span>Back</span></button>
    <QuestIcon entry={repository.items.get(quest.icon.goodsId)} entries={repository.items} size={viewportWidth > 800 ? 48 : 32} />
    <div><h1><QuestText text={quest.name} /></h1>{#if quest.secret}<small>Secret quest</small>{/if}</div>
  </header>
  <div class="quest-detail-columns">
    <div class="quest-left">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region needs keyboard focus for arrow/Page Down scrolling.) -->
      <div class="quest-description" tabindex="0" role="region" aria-label="Quest description">
        <QuestText text={quest.description} questName={id => repository.quests.get(id)?.name} {openQuest} images={repository.pack.images} />
      </div>
      <section class="quest-rewards" aria-label="Quest rewards">
        <h2>Rewards</h2>
        {#each quest.rewards as section, index (`${quest.id}:${index}`)}<QuestSection {section} {repository} {openQuest} {navigate} />{:else}<p>No rewards</p>{/each}
      </section>
    </div>
    <section class="quest-tasks" aria-label="Quest tasks">
      <h2>{quest.tasks.length} {quest.tasks.length === 1 ? 'Task' : 'Tasks'} <span class="task-logic">({quest.taskLogic})</span></h2>
      {#each quest.tasks as section, index (`${quest.id}:${index}`)}<QuestSection {section} {repository} {openQuest} {navigate} framed number={index + 1} />{:else}<p>No tasks</p>{/each}
    </section>
  </div>
</section>
<style>
  .quest-detail { display:flex; flex-direction:column; flex:1; min-height:0; }
  .quest-title { display:flex; gap:14px; align-items:center; padding:12px 24px; border-bottom:1px solid #373a3e; }
  .quest-back { display:flex; align-items:center; gap:8px; flex:none; min-height:44px; padding:8px 14px; } h1 { margin:0; font:22px Minecraft; } h1 :global(.quest-text) { font-size:22px; }
  .quest-title>div { min-width:0; }
  h2 { font:18px Minecraft; color:#c8b98d; margin:0 0 12px; text-shadow:2px 2px #342c34; } small { color:#8d939b; font:12px ui-sans-serif,system-ui,sans-serif; }
  .task-logic { color:#8d939b; font:inherit; }
  .quest-detail-columns { display:grid; grid-template-columns:1fr 1fr; flex:1; min-height:0; }
  .quest-left { display:flex; flex-direction:column; min-height:0; border-right:1px solid #373a3e; }
  .quest-description,.quest-rewards,.quest-tasks { min-width:0; min-height:0; overflow:auto; padding:22px 24px; overscroll-behavior:contain; }
  .quest-description:focus-visible { outline:2px solid #efc62f; outline-offset:-2px; }
  .quest-description { flex:none; max-height:40%; }
  .quest-description :global(.quest-text) { font-size:16px; line-height:1.5; }
  .quest-rewards { flex:1; border-top:1px solid #373a3e; }
  @media(max-width:800px) {
    .quest-title { padding:8px 12px; gap:8px; } .quest-back { width:44px; height:44px; justify-content:center; padding:8px; } .quest-back span { display:none; } h1,h1 :global(.quest-text) { font-size:18px; }
    .quest-detail-columns { display:flex; flex-direction:column; overflow:auto; } .quest-left { display:contents; border:0; }
    .quest-description,.quest-rewards,.quest-tasks { flex:none; overflow:visible; padding:18px 16px; }
    .quest-description { order:0; max-height:40dvh; overflow:auto; } .quest-tasks { order:1; border-top:1px solid #373a3e; } .quest-rewards { order:2; }
  }
</style>
