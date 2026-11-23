<script lang="ts">
  import FeatureLink from './FeatureLink.svelte';
  let {
    itemsHref,
    finderHref,
    questsHref,
    finderOpen,
    questsOpen,
    finderDiscovered,
    questsDiscovered,
    openItems,
    openFinder,
    openQuests,
  }: {
    itemsHref: string;
    finderHref: string;
    questsHref: string;
    finderOpen: boolean;
    questsOpen: boolean;
    finderDiscovered: boolean;
    questsDiscovered: boolean;
    openItems: () => void;
    openFinder: () => void;
    openQuests: () => void;
  } = $props();
</script>

<nav class="primary-nav" aria-label="Main navigation">
  <FeatureLink
    label="Items"
    icon={`${import.meta.env.BASE_URL}assets/navigation/items.png`}
    href={itemsHref}
    active={!finderOpen && !questsOpen}
    onclick={openItems}
  />
  <FeatureLink
    label="Recipe Finder"
    shortLabel="Finder"
    icon={`${import.meta.env.BASE_URL}assets/navigation/finder.png`}
    href={finderHref}
    active={finderOpen}
    undiscovered={!finderDiscovered}
    onclick={openFinder}
  />
  <FeatureLink
    label="Questbook Browser"
    shortLabel="Quests"
    icon={`${import.meta.env.BASE_URL}assets/navigation/quests.png`}
    href={questsHref}
    active={questsOpen}
    undiscovered={!questsDiscovered}
    onclick={openQuests}
  />
</nav>

<style>
  .primary-nav {
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    font-weight: 600;
  }
</style>
