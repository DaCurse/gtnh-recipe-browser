<script lang="ts">
  import { questbook } from './state.svelte';
  let { recipeVersion }: { recipeVersion: string } = $props();
</script>
  <div class="quest-version-control">
    <label><span>Quest version</span><select disabled={!questbook.versions.length} aria-label="Questbook version" title="Quest version" value={questbook.version} onchange={event => questbook.selectVersion(event.currentTarget.value, recipeVersion)}>
      {#if !questbook.versions.length}<option value="">…</option>{/if}
      {#each questbook.versions as version (version.id)}<option value={version.version}>{version.version}</option>{/each}
    </select></label>
    {#if questbook.version && recipeVersion && recipeVersion !== '…' && recipeVersion !== questbook.version}<small>Recipes: {recipeVersion}</small>{/if}
  </div>
<style>
  .quest-version-control { display:flex; flex:none; flex-direction:column; justify-content:center; margin-left:auto; gap:2px; }
  select { min-width:64px; max-width:100%; color:#d9dde2; background:#22262b; border:1px solid #454a51; border-radius:0; padding:5px 4px; font:12px ui-sans-serif,system-ui,sans-serif; }
  small { color:#7b828c; font:9px ui-sans-serif,system-ui,sans-serif; text-align:right; }
  label { display:flex; align-items:center; gap:6px; } label span { color:#8d939b; font:11px ui-sans-serif,system-ui,sans-serif; white-space:nowrap; }
  @media(max-width:800px) { label { flex-direction:column; gap:2px; } label span { font-size:9px; } select { width:100%; padding:3px 4px; } }
</style>
