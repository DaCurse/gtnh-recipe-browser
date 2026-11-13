<script lang="ts">
  import { formatNbt } from './nbt';
  let { source }: { source: string } = $props();
  const formatted = $derived.by(() => {
    try {
      return formatNbt(source);
    } catch {
      return source;
    }
  });
</script>

<pre class="nbt-tree" aria-label="Item NBT">{formatted}</pre>

<style>
  .nbt-tree {
    margin: 8px 0 0;
    padding: 8px 0 0;
    border-top: 1px solid #65416c;
    color: #b9a8c2;
    font:
      12px/1.5 ui-monospace,
      monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    text-shadow: none;
  }
</style>
