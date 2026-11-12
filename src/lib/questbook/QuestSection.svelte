<script lang="ts">
  import SpecialGoods from '../SpecialGoods.svelte';
  import QuestText from './QuestText.svelte';
  import LocationMap from './LocationMap.svelte';
  import { questHighlight } from './theme';
  import type { QuestSection as Section } from './types';
  import type { QuestRepository } from './repository';
  import type { RecipeView } from '../types';
  let { section, repository, openQuest, navigate, framed = false, number }: {
    section: Section; repository: QuestRepository; openQuest: (id: string) => void; navigate: (id: string, view: RecipeView) => void; framed?: boolean; number?: number;
  } = $props();
</script>
<section class="quest-section" class:framed data-section-type={section.type}>
  <h3>{number !== undefined ? `${number}. ${section.type === 'optional_retrieval' ? 'Optional' : section.title} Task` : section.title}</h3>
  <div class="quest-section-content">
  {#if section.type === 'checkbox'}
    <div class="mc-button-surface quest-checkbox">
      <img src={`${import.meta.env.BASE_URL}quests/assets/checkbox-cross.png`} alt="Checkbox task" width="48" height="48" />
    </div>
  {/if}
  <div class:location-row={section.type === 'location'}>
    {#if section.type === 'location'}<LocationMap />{/if}
    <div>{#each section.lines as line, index (index)}<p><QuestText text={line} /></p>{/each}</div>
  </div>
  {#if section.items.length}<SpecialGoods goods={section.items} resolve={id => repository.items.get(id)} {navigate} pageSize={24} showChance={false} wrapLabels rows rowSeparator={section.itemLogic} rowSeparatorColor={questHighlight} />{/if}
  {#each section.quests as id (id)}
    {#if repository.quests.has(id)}<button class="quest-requirement mc-button wrap" onclick={() => openQuest(id)}><QuestText text={repository.quests.get(id)!.name} /></button>
    {:else}<p>Unavailable quest</p>{/if}
  {/each}
  {#if section.conditions}<details><summary>NBT requirements</summary><pre>{section.conditions}</pre></details>{/if}
  </div>
</section>
<style>
  .quest-section { padding:12px 0; border-bottom:1px solid #373a3e; } .quest-section:last-child { border:0; }
  .quest-section.framed { border:0; }
  .framed .quest-section-content { padding:12px; border:1px solid #44474b; }
  h3 { color:#fff; text-align:center; font:17px Minecraft; margin:0 0 10px; text-shadow:2px 2px #342c34; }
  .location-row { display:flex; align-items:flex-start; gap:12px; }
  .location-row>div { min-width:0; }
  p { margin:3px 0; color:#a7adb5; } p :global(.quest-text) { font-size:14px; }
  .quest-requirement { padding:8px 12px; margin-top:8px; text-align:left; }
  :global(.mc-theme .mc-button-surface.quest-checkbox) { display:flex; width:64px; min-width:64px; height:64px; padding:4px; margin:0 auto 12px; }
  details { font-size:12px; color:#939ba3; margin:8px 0; } pre { white-space:pre-wrap; overflow-wrap:anywhere; }
</style>
