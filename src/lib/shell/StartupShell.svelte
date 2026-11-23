<script lang="ts">
  import AppHeader from './AppHeader.svelte';
  import LandingPage from '../landing/LandingPage.svelte';
  const noop = () => {};
</script>

<div class="app-shell" data-startup-shell>
  <AppHeader
    datasetVersion="…"
    datasetUpdateAvailable={false}
    updateReady={false}
    showProjectLinks={false}
    showHome={noop}
    openDatasetManager={noop}
  />
  <LandingPage
    assetBase="./"
    exactEntries={new Map()}
    families={[]}
    loading
    progress={0}
    itemsUrl="./?page=items"
    finderHref="./?page=finder"
    questHref="./?page=quests"
    finderDiscovered={false}
    questsDiscovered={false}
    openQuests={noop}
    openItems={noop}
    openFinder={noop}
    navigate={noop}
  />
</div>
