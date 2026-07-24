<script lang="ts">
  import ProjectLinks from './ProjectLinks.svelte';
  import type { DatasetState } from './types';

  let {
    datasetVersion,
    activeDataset,
    updateReady,
    showHome,
    openDatasetManager
  }: {
    datasetVersion: string;
    activeDataset?: DatasetState;
    updateReady: boolean;
    showHome: () => void;
    openDatasetManager: () => void;
  } = $props();
</script>

<header>
  <a class="brand" href="./" aria-label="GTNH Recipe Browser home" onclick={(event) => {
    event.preventDefault();
    showHome();
  }}>
    <span class="brand-cube"><img src="./assets/gtnh-logo.png" alt="" /></span>
    <span><b>GTNH</b><small>RECIPE BROWSER</small></span>
  </a>
  <button class="version" onclick={openDatasetManager}>
    <span><i></i> {datasetVersion}</span>
    <small>{activeDataset?.status === 'complete'
      ? 'Offline ready'
      : activeDataset
        ? 'Catalog cached'
        : 'Online only'}</small>
    <svg class="chevron-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 9 5 5 5-5"></path>
    </svg>
  </button>
  <ProjectLinks variant="header-links" />
</header>

{#if updateReady}
  <button class="update-banner" onclick={() => location.reload()}>
    A new app version is ready · Refresh
  </button>
{/if}
