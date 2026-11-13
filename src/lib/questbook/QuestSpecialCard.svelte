<script lang="ts">
  import SpecialGoods from '../SpecialGoods.svelte';
  import type { SpecialGoods as Goods, SpecialResolver } from '../specialData';
  import type { RecipeView } from '../types';
  import QuestIconButton from './QuestIconButton.svelte';
  import type { QuestLinksRepository } from './linksRepository';
  let {
    questId,
    repository,
    openQuest,
    goods,
    resolve,
    navigate,
    source,
  }: {
    questId: string;
    repository: QuestLinksRepository;
    openQuest: (id: string) => void;
    goods: Goods[];
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
    source: string;
  } = $props();
  const quest = $derived(repository.quests.get(questId));
</script>

{#if quest}
  <div class="linked-quest">
    <QuestIconButton {quest} {repository} {openQuest} {source} />
    <div>
      <QuestIconButton {quest} {repository} {openQuest} {source} text />
      {#if quest.secret}<small>Secret quest</small>{/if}
    </div>
    {#if goods.length}<div class="quest-linked-goods">
        <SpecialGoods {goods} {resolve} {navigate} horizontal hideLabels pageSize={goods.length} />
      </div>{/if}
  </div>
{/if}

<style>
  .linked-quest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .linked-quest > div {
    min-width: 0;
  }
  .quest-linked-goods {
    margin-left: auto;
    max-width: 100%;
  }
  small {
    color: #969da5;
    font:
      11px/1.5 ui-sans-serif,
      system-ui,
      sans-serif;
    margin: 6px 0 0;
  }
</style>
