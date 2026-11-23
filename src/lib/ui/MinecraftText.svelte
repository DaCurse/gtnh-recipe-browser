<script lang="ts">
  import { parseMinecraftCodes, parseMinecraftHtml, plainMinecraftText } from './minecraftText';
  import type { MinecraftTextLine } from './minecraftText';

  let {
    lines,
    raw,
    text,
    inline = false,
    fallback = '',
  }: {
    lines?: MinecraftTextLine[];
    raw?: string | null;
    text?: string;
    inline?: boolean;
    fallback?: string | string[];
  } = $props();

  const displayLines = $derived(
    lines ??
      (text !== undefined ? parseMinecraftCodes(text).lines : undefined) ??
      (raw !== undefined && raw !== null ? parseMinecraftHtml(raw).lines : undefined) ??
      plainMinecraftText(Array.isArray(fallback) ? fallback.join('\n') : fallback).lines,
  );
</script>

<span class="minecraft-text" class:inline>
  {#each displayLines as line, lineIndex (lineIndex)}
    {#if inline && lineIndex > 0}<br />{/if}<span
      class:empty={line.segments.length === 0}
      class="minecraft-line"
    >
      {#each line.segments as segment, segmentIndex (segmentIndex)}
        <span class={segment.formats.map((format) => `fmt-${format}`).join(' ')}
          >{segment.text}</span
        >
      {/each}
    </span>
  {/each}
</span>

<style>
  .inline {
    display: inline;
  }
  .inline .minecraft-line {
    display: contents;
  }
</style>
