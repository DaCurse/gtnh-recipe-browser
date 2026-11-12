<script lang="ts">
  let { query, change }: { query: string; change: (query: string) => void } = $props();
</script>
<label class="quest-search"><span class="sr-only">Search all quests</span>
  <input aria-label="Search all quests" placeholder="Search all quests…" value={query} oninput={event => change(event.currentTarget.value)} />
  {#if query}<button aria-label="Clear quest search" onclick={() => change('')}>×</button>{/if}
</label>
<style>
  .quest-search { display:flex; gap:6px; padding:10px; background:#121315; border:1px solid #45494e; border-radius:6px; min-height:42px; }
  .quest-search:focus-within { border-color:#8c9298; } input { width:100%; min-width:0; background:none; border:0; outline:none; color:#e1e5ea; font-size:13px; }
  button { background:none; border:0; cursor:pointer; color:#999; padding:0 6px; }
</style>
