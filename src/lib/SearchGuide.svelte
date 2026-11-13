<script lang="ts">
  import { onMount } from 'svelte';
  import { parseSearchExpression } from './searchSyntax';
  let { close, opener }: { close: () => void; opener?: HTMLElement } = $props();
  let dialog: HTMLDialogElement;
  const examples: Array<[string, string]> = [
    ['@gregtech', 'Limit results to a mod.'],
    ['#voltage', 'Search item tooltip text.'],
    ['$ingotIron', 'Search ore-dictionary names.'],
    ['&minecraft:stone', 'Search an item or fluid identifier.'],
    ['hammer !rubber', 'Exclude a match with ! or -. Prefixes work too: !@minecraft.'],
    ['iron | copper', 'Match either side. Spaces within each side require all terms.'],
    ['"iron ingot"', 'Keep words together as a phrase.'],
    ['copp?r ingot*iron', '? matches one character; * matches one or more characters.'],
  ];
  onMount(() => {
    dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="search-guide-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  onclick={(event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      close();
  }}
>
  <header>
    <h2 id="search-guide-title">Search syntax</h2>
    <button class="close" aria-label="Close search syntax" onclick={close}>×</button>
  </header>
  <p>
    Combine these modifiers in the item catalogue and Recipe Finder item pickers. Searches ignore
    case.
  </p>
  <dl>
    {#each examples as [example, explanation] (example)}
      <div>
        <dt>
          <code
            >{#each parseSearchExpression(example).spans as span, index (index)}<span
                class={span.format ? `fmt-${span.format}` : ''}>{span.text}</span
              >{/each}</code
          >
        </dt>
        <dd>{explanation}</dd>
      </div>
    {/each}
  </dl>
  <p class="note">Without a prefix, search names, tooltips and identifiers.</p>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 28px));
    max-height: calc(100dvh - 28px);
    overflow: auto;
    padding: 20px;
    border: 1px solid #62666c;
    border-radius: 10px;
    color: #e7e9eb;
    background: #202226;
  }
  dialog::backdrop {
    background: #050607cc;
    backdrop-filter: blur(4px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
  }
  .close {
    width: 36px;
    height: 36px;
    border: 0;
    background: none;
    color: #bbb;
    font-size: 26px;
    cursor: pointer;
  }
  p {
    color: #b4b8bd;
    font-size: 13px;
    line-height: 1.6;
  }
  dl {
    margin: 14px 0;
  }
  dl > div {
    display: grid;
    grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
    align-items: baseline;
    gap: 14px;
    padding: 9px 0;
    border-bottom: 1px solid #393d42;
  }
  dl > div:last-child {
    border-bottom: 0;
  }
  dt {
    min-width: 0;
  }
  code {
    font:
      14px/1.5 ui-monospace,
      monospace;
    overflow-wrap: anywhere;
  }
  dd {
    margin: 0;
    color: #b4b8bd;
    font-size: 13px;
    line-height: 1.5;
  }
  .note {
    margin-bottom: 0;
    font-size: 12px;
    color: #959ba2;
  }
  @media (max-width: 480px) {
    dialog {
      padding: 16px;
    }
    dl > div {
      grid-template-columns: minmax(0, 1fr);
      gap: 3px;
      padding: 8px 0;
    }
  }
</style>
