<script lang="ts">
  import MinecraftText from '../MinecraftText.svelte';
  import { questText } from './text';
  let { text, questName, openQuest, images = {} }: {
    text: string; questName?: (id: string) => string | undefined; openQuest?: (id: string) => void; images?: Record<string, string>;
  } = $props();
  const runs = $derived(questText(text, questName));
</script>
<span class="quest-text">
  {#each runs as run, index (index)}
    {#if run.image}
      {#if images[run.image.resource]}<img src={images[run.image.resource]} alt="Quest illustration" style:height={`${run.image.height}px`} loading="lazy" />{/if}
    {:else if run.link?.type === 'url'}
      <a href={run.link.target} target="_blank" rel="noopener noreferrer"><MinecraftText text={run.codes + run.text} inline /></a>
    {:else if run.link?.type === 'quest' && openQuest}
      <button class="quest-text-link" onclick={() => openQuest?.(run.link!.target)}><MinecraftText text={run.codes + run.text} inline /></button>
    {:else}<MinecraftText text={run.codes + run.text} inline />{/if}
  {/each}
</span>
<style>
  .quest-text { font:18px/1.55 Minecraft,monospace; text-shadow:2px 2px #342c34; white-space:pre-wrap; overflow-wrap:anywhere; }
  a,.quest-text-link { color:inherit; } .quest-text-link { font:inherit; padding:0; background:none; border:0; cursor:pointer; text-align:inherit; text-shadow:inherit; }
  img { display:block; max-width:100%; width:auto; object-fit:contain; margin:12px auto; image-rendering:pixelated; }
</style>
