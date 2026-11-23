<script lang="ts">
  let {
    page = $bindable(),
    count,
    label,
    noun,
  }: { page: number; count: number; label: string; noun: string } = $props();
</script>

{#if count > 1}
  <nav class="loot-group-pages" aria-label={label}>
    <button
      class="mc-button"
      disabled={page === 0}
      onclick={() => (page -= 1)}
      aria-label={`Previous ${noun}`}>Previous</button
    >
    <span>{page + 1} / {count}</span>
    <button
      class="mc-button"
      disabled={page >= count - 1}
      onclick={() => (page += 1)}
      aria-label={`Next ${noun}`}>Next</button
    >
  </nav>
{/if}

<style>
  .loot-group-pages {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
  }
  .loot-group-pages span {
    color: var(--recipe-text);
    font-size: 11px;
  }
</style>
