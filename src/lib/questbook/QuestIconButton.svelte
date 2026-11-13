<script lang="ts">
  import { trackEvent } from '../analytics';
  import { questAnalyticsProperties } from './analytics';
  import { onDestroy } from 'svelte';
  import QuestIcon from './QuestIcon.svelte';
  import QuestText from './QuestText.svelte';
  import { questPreview } from './preview.svelte';
  import { plainQuestText } from './text';
  import type { Quest } from './types';
  import type { QuestPreviewRepository } from './linksTypes';
  let {
    quest,
    repository,
    openQuest,
    text = false,
    source = 'quest_link',
  }: {
    quest: Quest;
    repository: QuestPreviewRepository;
    openQuest: (id: string) => void;
    text?: boolean;
    source?: string;
  } = $props();
  let element: HTMLButtonElement;
  function open() {
    trackEvent('quest_link_opened', { ...questAnalyticsProperties(quest, repository), source });
    openQuest(quest.id);
  }
  onDestroy(() => {
    if (questPreview.current?.node === element) questPreview.clear();
  });
</script>

<button
  bind:this={element}
  class:quest-linked-icon={!text}
  class:quest-name-link={text}
  class:main={!text && quest.main}
  aria-label={plainQuestText(quest.name)}
  onpointerdown={questPreview.pointerKind}
  onpointerenter={(event) => questPreview.pointer(quest.id, repository, event)}
  onpointermove={(event) => questPreview.pointer(quest.id, repository, event)}
  onpointerleave={(event) => {
    if (event.pointerType !== 'touch') questPreview.clear();
  }}
  onfocus={(event) => questPreview.focus(quest.id, repository, event)}
  onblur={questPreview.clear}
  onclick={(event) => questPreview.activate(quest.id, repository, event, open)}
>
  {#if text}<QuestText text={quest.name} />{:else}<QuestIcon
      entry={repository.items.get(quest.icon.goodsId)}
      entries={repository.items}
      size={36}
    />{/if}
</button>

<style>
  .quest-linked-icon {
    width: 48px;
    height: 48px;
    flex: none;
    display: inline-grid;
    place-items: center;
    padding: 0;
    border: 0;
    cursor: pointer;
    image-rendering: pixelated;
    background: url('/quests/assets/quest-normal-48x48.png') center/100% 100% no-repeat;
  }
  .quest-linked-icon.main {
    background-image: url('/quests/assets/quest-main-48x48.png');
  }
  .quest-name-link {
    display: block;
    text-align: left;
    color: inherit;
    font: inherit;
    padding: 0;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .quest-name-link :global(.quest-text) {
    font-size: 16px;
  }
  .quest-linked-icon:hover,
  .quest-linked-icon:focus-visible,
  .quest-name-link:hover,
  .quest-name-link:focus-visible {
    filter: brightness(1.25);
  }
  .quest-linked-icon:focus-visible,
  .quest-name-link:focus-visible {
    outline: 1px solid #d6dce8;
    outline-offset: 2px;
  }
</style>
