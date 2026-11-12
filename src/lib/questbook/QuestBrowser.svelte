<script lang="ts">
  import { trackEvent, analyticsSearch } from '../analytics';
  import { questAnalyticsProperties } from './analytics';
  import { onMount } from 'svelte';
  import { questPreview } from './preview.svelte';
  import type { RecipeView } from '../types';
  import QuestCanvas from './QuestCanvas.svelte';
  import QuestDetail from './QuestDetail.svelte';
  import QuestText from './QuestText.svelte';
  import QuestIcon from './QuestIcon.svelte';
  import QuestSearch from './QuestSearch.svelte';
  import { questbook } from './state.svelte';
  import { plainQuestText } from './text';
  let { recipeVersion, navigate }: { recipeVersion: string; navigate: (id: string, view: RecipeView) => boolean } = $props();
  let sidebarOpen = $state(false);
  let message = $state('');
  const repository = $derived(questbook.repository);
  const chapter = $derived(repository?.chapters.get(questbook.chapterId));
  const quest = $derived(repository?.quests.get(questbook.questId));
  const matches = $derived(questbook.query.trim() && repository ? repository.search(questbook.query) : []);
  let viewed = '';
  let searched = '';
  $effect(() => {
    if (questbook.status !== 'ready' || !repository) return;
    const key = `${questbook.version}:${quest?.id ?? chapter?.id ?? ''}:${Boolean(quest)}`;
    if (viewed === key) return;
    viewed = key;
    if (quest) trackEvent('quest_viewed', questAnalyticsProperties(quest, repository, chapter?.id));
    else if (chapter) trackEvent('quest_chapter_viewed', {chapter_id:chapter.id,chapter_name:plainQuestText(chapter.name),quest_version:questbook.version,quest_count:chapter.quests.length});
  });
  $effect(() => {
    const query = analyticsSearch(questbook.query);
    const version = questbook.version;
    const resultCount = matches.length;
    if (!query || questbook.status !== 'ready') { if (!query) searched = ''; return; }
    const key = `${version}:${query}`;
    if (searched === key) return;
    const timer = setTimeout(() => { searched = key; trackEvent('quest_search', {query,result_count:resultCount,quest_version:version}); },1200);
    return () => clearTimeout(timer);
  });
  function clearPreview() { questPreview.clear(); }
  function pointerKind(event: PointerEvent) { questPreview.pointerKind(event); }
  function pointerPreview(id: string, event: PointerEvent) {
    if(repository) questPreview.pointer(id,repository,event);
  }
  function focusQuest(id: string, event: FocusEvent) {
    if(repository) questPreview.focus(id,repository,event);
  }
  function activate(id: string, event: MouseEvent) {
    if(repository) questPreview.activate(id,repository,event,()=>questbook.open(id));
  }
  function openQuest(id: string) { clearPreview(); questbook.open(id); }
  function search(query: string) { clearPreview(); questbook.search(query); }
  function goItem(id: string, view: RecipeView) {
    const target = repository?.destination(id) ?? id;
    if (!navigate(target, view)) message = 'This item is unavailable in the selected recipe dataset.';
  }
  onMount(() => {
    questbook.restore(new URLSearchParams(location.search));
    void questbook.load(recipeVersion,new URLSearchParams(location.search).get('quest-version') ?? undefined);
    const pop = () => { clearPreview(); if (new URLSearchParams(location.search).get('page') === 'quests') questbook.restore(new URLSearchParams(location.search)); };
    window.addEventListener('popstate', pop);
    return () => { clearPreview(); window.removeEventListener('popstate', pop); };
  });
</script>
<section class="questbook-browser" aria-label="Questbook Browser">
  {#if questbook.status === 'loading' || questbook.status === 'idle'}
    <div class="quest-loading" role="status"><h1>Loading questbook</h1>
      <div class="load-progress" role="progressbar" aria-label="Questbook loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow={questbook.progress}><span style:width={`${questbook.progress}%`}></span></div>
    </div>
  {:else if questbook.status === 'error'}
    <div class="quest-loading" role="alert"><h1>Questbook could not be loaded</h1><p>{questbook.error}</p><button class="mc-button" onclick={() => questbook.load(recipeVersion)}>Retry</button></div>
  {:else if repository}
    {#if !quest}<div class="mobile-search"><button class="mc-button" aria-expanded={sidebarOpen} onclick={() => sidebarOpen = !sidebarOpen}>Chapters</button><QuestSearch query={questbook.query} change={search} /></div>{/if}
    {#if message}<div class="quest-message" role="status">{message}<button aria-label="Dismiss message" onclick={() => message = ''}>×</button></div>{/if}
    {#if quest}
      {#key quest.id}<QuestDetail {quest} {repository} back={() => { clearPreview(); questbook.back(); }} {openQuest} navigate={goItem} />{/key}
    {:else}
      <div class="questbook-layout">
        {#if sidebarOpen}<button class="chapter-backdrop" aria-label="Close chapters" onclick={() => sidebarOpen = false}></button>{/if}
        <aside class="quest-chapters" class:mobile-open={sidebarOpen} aria-label="Quest chapters">
          <p class="quest-total">{repository.pack.quests.length.toLocaleString()} Quests</p>
          <div class="desktop-search"><QuestSearch query={questbook.query} change={search} /></div>
          <div class="chapter-list">
            {#each repository.pack.chapters as line (line.id)}
              <button class="mc-button wrap quest-chapter" class:selected={line.id === questbook.chapterId} aria-current={line.id === questbook.chapterId ? 'page' : undefined}
                onclick={() => { clearPreview(); questbook.chapter(line.id); sidebarOpen = false; }}>
                <QuestIcon entry={repository.items.get(line.icon.goodsId)} entries={repository.items} size={32} /><QuestText text={line.name} />
              </button>
            {/each}
          </div>
        </aside>
        <section class="quest-page">
          {#if questbook.query.trim()}
            <div class="quest-search-results" aria-label="Quest search results">
              <h1>{matches.length.toLocaleString()} quests</h1>
              {#each matches.slice(0, questbook.searchLimit) as result (result.id)}
                <button class="quest-search-result mc-button wrap" data-quest={result.id} aria-label={plainQuestText(result.name)} onpointerdown={pointerKind}
                  onpointerenter={event => pointerPreview(result.id, event)} onpointermove={event => pointerPreview(result.id, event)} onpointerleave={event => { if (event.pointerType !== 'touch') clearPreview(); }}
                  onfocus={event => focusQuest(result.id, event)} onblur={clearPreview} onclick={event => activate(result.id, event)}>
                  <QuestIcon entry={repository.items.get(result.icon.goodsId)} entries={repository.items} size={40} /><span><QuestText text={result.name} /><small>{repository.memberships.get(result.id)?.map(line => plainQuestText(line.name)).join(' · ') ?? 'Unassigned'}{result.secret ? ' · Secret' : ''}</small></span>
                </button>
              {:else}<p>No matching quests.</p>{/each}
              {#if matches.length > questbook.searchLimit}<button class="mc-button more-quests" onclick={() => questbook.searchLimit += 60}>Show more quests</button>{/if}
            </div>
          {:else if chapter}
            <div class="chapter-title"><span class="compact-chapter-icon"><QuestIcon entry={repository.items.get(chapter.icon.goodsId)} entries={repository.items} size={28} /></span><h1><QuestText text={chapter.name} /></h1><small>{chapter.quests.length} quests</small></div>
            {#key chapter.id}<QuestCanvas {chapter} {repository} preview={pointerPreview} {focusQuest} {activate} {clearPreview} {pointerKind} />{/key}
          {:else}<p>Select a chapter to explore its quests.</p>{/if}
        </section>
      </div>
    {/if}
  {/if}
</section>
<style>
  .questbook-browser { display:flex; flex:1; flex-direction:column; min-height:0; overflow:hidden; font-family:ui-sans-serif,system-ui,sans-serif; }
  .questbook-layout { display:grid; grid-template-columns:290px minmax(0,1fr); flex:1; min-height:0; }
  .quest-chapters { min-width:0; } .quest-total { font:19px Minecraft; color:#c8b98d; margin:18px 16px 10px; text-shadow:2px 2px #342c34; }
  .desktop-search { margin:4px 12px 12px; } .quest-message button { background:none; border:0; cursor:pointer; color:#999; }
  .chapter-list { overflow:auto; min-height:0; padding:0 10px 10px; } .quest-chapter { --item-icon-shadow:drop-shadow(1px 1px 0 #0008); display:flex; align-items:center; width:100%; text-align:left; gap:10px; padding:8px; margin-bottom:6px; min-height:44px; }
  .quest-chapter :global(.quest-text) { font-size:14px; line-height:1.3; } .quest-chapter.selected { outline:1px solid #a8bfdc; outline-offset:-2px; }
  .quest-page { display:flex; flex-direction:column; min-height:0; min-width:0; } .chapter-title { padding:14px 20px; display:flex; align-items:center; gap:15px; border-bottom:1px solid #373a3e; }
  h1 { margin:0; font:20px Minecraft; } .chapter-title :global(.quest-text) { font-size:20px; } .chapter-title small { font-size:11px; color:#777f8a; white-space:nowrap; }
  .compact-chapter-icon { display:none; --item-icon-shadow:drop-shadow(1px 1px 0 #0008); }
  .quest-search-results { overflow:auto; padding:20px 24px; } .quest-search-results h1 { margin-bottom:18px; }
  .quest-search-result { width:100%; display:flex; align-items:center; gap:14px; padding:10px 12px; text-align:left; margin-bottom:8px; }
  .quest-search-result>span { min-width:0; } .quest-search-result small { display:block; margin-top:4px; font-size:11px; color:#929ba7; }
  .more-quests { padding:10px 18px; } .quest-loading { margin:auto; padding:30px; text-align:center; max-width:600px; } .quest-loading h1 { margin-bottom:16px; } .quest-loading p { color:#8c949f; font-size:13px; }
  .quest-message { display:flex; justify-content:space-between; padding:8px 18px; font-size:12px; color:#c7b883; border-bottom:1px solid #4f4a3d; }
  .chapter-backdrop,.mobile-search { display:none; }
  @media(max-width:800px) {
    .questbook-layout { display:flex; position:relative; } .quest-page { width:100%; } .quest-chapters { display:none; }
    .desktop-search { display:none; } .mobile-search { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid #373a3e; }
    .mobile-search :global(.quest-search) { flex:1; min-width:0; }
    .quest-chapters.mobile-open { display:flex; position:absolute; z-index:15; inset:0 auto 0 0; width:min(310px,calc(100% - 40px)); background:#1b1d20; box-shadow:8px 0 20px #0008; }
    .chapter-backdrop { display:block; position:absolute; z-index:14; inset:0; border:0; background:#0008; }
    .chapter-title { padding:12px; gap:10px; } .chapter-title :global(.quest-text) { font-size:17px; }
    .compact-chapter-icon { display:inline-flex; flex:none; }
    .quest-search-results { padding:14px 12px; } .quest-search-result :global(.quest-text) { font-size:16px; }
  }
</style>
