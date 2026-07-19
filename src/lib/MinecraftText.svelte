<script lang="ts">
  import { plainMinecraftText } from './minecraftText';
  import type { MinecraftTextLine } from './minecraftText';

  let {
    lines,
    fallback = ''
  }: {
    lines?: MinecraftTextLine[];
    fallback?: string | string[];
  } = $props();

  const displayLines = $derived(lines ?? plainMinecraftText(
    Array.isArray(fallback) ? fallback.join('\n') : fallback
  ).lines);
</script>

<span class="minecraft-text">
  {#each displayLines as line}
    <span class:empty={line.segments.length === 0} class="minecraft-line">
      {#each line.segments as segment}
        <span class={segment.formats.map((format) => `fmt-${format}`).join(' ')}>{segment.text}</span>
      {/each}
    </span>
  {/each}
</span>
