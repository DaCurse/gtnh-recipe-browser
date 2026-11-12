<script lang="ts">
  import { onMount } from 'svelte';
  import FloatingTooltip from '../FloatingTooltip.svelte';
  import { itemTouchState } from '../itemTouch.svelte';
  import QuestTooltip from './QuestTooltip.svelte';
  import { questPreview } from './preview.svelte';
  const preview=$derived(questPreview.current);
  const quest=$derived(preview?.repository.quests.get(preview.id));
  onMount(()=>questPreview.listen());
</script>
{#if preview && quest}
  <FloatingTooltip x={preview.x} y={preview.y} anchor={preview.anchor} interactive={preview.touch}>
    <QuestTooltip {quest} repository={preview.repository} hint={preview.touch && !itemTouchState.tutorial.opened} />
  </FloatingTooltip>
{/if}
