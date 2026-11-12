<script lang="ts">
  import { parseSearchExpression } from './searchSyntax';

  let { value = $bindable(), input = $bindable(), placeholder, label }: {
    value: string;
    input?: HTMLInputElement;
    placeholder: string;
    label: string;
  } = $props();
  let scrollLeft = $state(0);
  let composing = $state(false);
  const spans = $derived(parseSearchExpression(value).spans);
</script>

<div class="highlighted-search" class:composing>
  <div class="paint" aria-hidden="true">
    <span class="text" style:transform={`translateX(${-scrollLeft}px)`}>{#each spans as span, index (index)}<span class={span.format ? `fmt-${span.format}` : ''}>{span.text}</span>{/each}</span>
  </div>
  <input class="editor" bind:this={input} bind:value {placeholder} aria-label={label}
    autocomplete="off" autocapitalize="off" spellcheck="false"
    onscroll={(event) => scrollLeft = event.currentTarget.scrollLeft}
    oncompositionstart={() => composing = true} oncompositionend={() => composing = false} />
</div>

<style>
  .highlighted-search { position:relative; flex:1; min-width:0; align-self:stretch; overflow:hidden; font-size:14px; line-height:44px; font-kerning:none; font-variant-ligatures:none; }
  .paint { position:absolute; inset:0; overflow:hidden; pointer-events:none; color:#eef0f2; }
  .text { display:block; width:max-content; white-space:pre; }
  .editor { display:block; position:relative; width:100%; height:100%; min-width:0; padding:0; margin:0; border:0; outline:0; background:transparent; font:inherit; color:transparent; caret-color:#eef0f2; }
  .editor::placeholder { color:#74787d; }
  .editor::selection { color:#fff; background:#355a88; }
  .composing .paint { visibility:hidden; }
  .composing .editor { color:#eef0f2; }
  @media (forced-colors:active) { .paint { display:none; } .editor { color:CanvasText; caret-color:CanvasText; } }
</style>
