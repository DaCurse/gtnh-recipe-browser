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

<style>
  header { height:68px; flex:none; display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; padding:0 24px; border-bottom:1px solid #34373b; background:#17181be8; backdrop-filter:blur(15px); z-index:5; }
  .brand { width:max-content; display:flex; gap:11px; align-items:center; text-decoration:none; color:white; }
  .brand-cube { display:grid; place-items:center; width:42px; height:42px; flex:0 0 42px; }
  .brand-cube img { display:block; width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 2px 4px #0009); }
  .brand span:last-child { display:flex; flex-direction:column; line-height:1; }
  .brand b { font:20px Minecraft; letter-spacing:2px; color:#eef0f2; text-shadow:2px 2px #342c34; }
  .brand small { margin-top:5px; color:#81858a; font:11px Minecraft; letter-spacing:1.2px; text-shadow:2px 2px #342c34; }
  .version { grid-column:2; min-width:190px; min-height:48px; padding:6px 35px 6px 13px; position:relative; border:1px solid #3a3d42; border-radius:8px; background:#212327; text-align:left; cursor:pointer; }
  .version span,.version small { display:block; }
  .version span { font-size:13px; font-weight:700; }
  .version small { color:#85898e; font-size:11px; margin:3px 0 0 14px; }
  .version i { display:inline-block; width:7px; height:7px; border-radius:50%; background:#b6bbc1; box-shadow:0 0 5px #969ba1; }
  .chevron-icon { position:absolute; right:10px; top:52%; width:20px; height:20px; transform:translateY(-50%); fill:none; stroke:#9da2a7; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .update-banner { border:0; padding:8px; background:#bfc3c7; color:#17191b; cursor:pointer; }
  @media (max-width:800px) {
    header { padding:0 12px; height:62px; position:sticky; top:0; display:flex; }
    .brand { width:auto; gap:8px; }
    .brand span:last-child { display:flex; }
    .brand b { display:none; }
    .brand small { margin:0; color:#c5c9cd; font-size:10px; letter-spacing:.9px; white-space:nowrap; }
    .version { min-width:0; margin-left:auto; }
  }
  @media (max-width:450px) {
    .brand-cube { width:38px; height:38px; flex-basis:38px; }
    .version { padding-right:38px; }
    .version small { display:none; }
  }
</style>
