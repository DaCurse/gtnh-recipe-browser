<script lang="ts">
  import { parseMinecraftHtml, plainMinecraftText } from './minecraftText';
  import type { MinecraftTextLine } from './minecraftText';

  let {
    lines,
    raw,
    fallback = ''
  }: {
    lines?: MinecraftTextLine[];
    raw?: string | null;
    fallback?: string | string[];
  } = $props();

  const displayLines = $derived(
    lines
    ?? (raw !== undefined ? parseMinecraftHtml(raw).lines : undefined)
    ?? plainMinecraftText(Array.isArray(fallback) ? fallback.join('\n') : fallback).lines
  );
</script>

<span class="minecraft-text">
  {#each displayLines as line, lineIndex (lineIndex)}
    <span class:empty={line.segments.length === 0} class="minecraft-line">
      {#each line.segments as segment, segmentIndex (segmentIndex)}
        <span class={segment.formats.map((format) => `fmt-${format}`).join(' ')}>{segment.text}</span>
      {/each}
    </span>
  {/each}
</span>
