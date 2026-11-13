<script lang="ts">
  import { flushSync } from 'svelte';
  import { parseSearchExpression } from './searchSyntax';

  let { value = $bindable(), input = $bindable(), placeholder, label }: {
    value: string;
    input?: HTMLInputElement;
    placeholder: string;
    label: string;
  } = $props();
  let textLayer: HTMLSpanElement;
  const spans = $derived(parseSearchExpression(value).spans);

  // Native caret scrolling can happen after input/selection events. Follow it
  // before paint while editing, without waiting for a reactive render cycle.
  function followInputScroll(node: HTMLInputElement) {
    let frame = 0;
    let paintedOffset: number | undefined;
    function paint() {
      const offset = node.scrollLeft;
      if (textLayer && offset !== paintedOffset) {
        textLayer.style.transform = `translateX(${-offset}px)`;
        paintedOffset = offset;
      }
    }
    function follow() {
      paint();
      frame = document.activeElement === node ? requestAnimationFrame(follow) : 0;
    }
    function start() { if (!frame) frame = requestAnimationFrame(follow); }
    node.addEventListener('focus', start);
    node.addEventListener('scroll', paint);
    const resize = new ResizeObserver(paint);
    resize.observe(node);
    paint();
    if (document.activeElement === node) start();
    return { destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      node.removeEventListener('focus', start);
      node.removeEventListener('scroll', paint);
    } };
  }

  function updateValue(event: Event) {
    const next = (event.currentTarget as HTMLInputElement).value;
    // Paint composition edits in the same event turn; never swap to plain text.
    flushSync(() => { value = next; });
  }
</script>

<div class="highlighted-search">
  <div class="paint" aria-hidden="true">
    <span class="text" bind:this={textLayer}>{#each spans as span, index (index)}<span class={span.format ? `fmt-${span.format}` : ''}>{span.text}</span>{/each}</span>
  </div>
  <input class="editor" bind:this={input} bind:value {placeholder} aria-label={label}
    autocomplete="off" autocapitalize="off" spellcheck="false"
    use:followInputScroll oninput={updateValue} />
</div>

<style>
  .highlighted-search { position:relative; flex:1; min-width:0; align-self:stretch; overflow:hidden; font-size:14px; line-height:44px; font-kerning:none; font-variant-ligatures:none; }
  .paint { position:absolute; inset:0; overflow:hidden; pointer-events:none; color:#eef0f2; }
  .text { display:block; width:max-content; white-space:pre; will-change:transform; }
  .editor { display:block; position:relative; width:100%; height:100%; min-width:0; padding:0; margin:0; border:0; outline:0; background:transparent; font:inherit; color:transparent; -webkit-text-fill-color:transparent; caret-color:#eef0f2; }
  .editor::placeholder { color:#74787d; -webkit-text-fill-color:#74787d; }
  .editor::selection { color:#fff; -webkit-text-fill-color:#fff; background:#355a88; }
  @media (forced-colors:active) { .paint { display:none; } .editor { color:CanvasText; -webkit-text-fill-color:CanvasText; caret-color:CanvasText; } }
</style>
