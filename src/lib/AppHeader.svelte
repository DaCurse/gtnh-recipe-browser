<script lang="ts">
  import ProjectLinks from './ProjectLinks.svelte';
  import type { DatasetState } from './types';

  let {
    datasetVersion,
    activeDataset,
    datasetUpdateAvailable,
    updateReady,
    showHome,
    openDatasetManager
  }: {
    datasetVersion: string;
    activeDataset?: DatasetState;
    datasetUpdateAvailable: boolean;
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
  <button
    class:has-update={datasetUpdateAvailable}
    class="version"
    aria-label={datasetUpdateAvailable
      ? `${datasetVersion}, new dataset revision available`
      : `${datasetVersion}, open dataset manager`}
    onclick={openDatasetManager}
  >
    <span class="version-title">
      <i></i> {datasetVersion}
      {#if datasetUpdateAvailable}
        <span
          class="revision-blip"
          title="A newer published dataset revision is available for this GTNH version."
        ></span>
      {/if}
    </span>
    <small>{datasetUpdateAvailable
      ? 'New revision available'
      : activeDataset?.status === 'complete'
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
  .version-title,.version small { display:block; }
  .version .version-title { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; }
  .version small { color:#85898e; font-size:11px; margin:3px 0 0 14px; }
  .version i { display:inline-block; width:7px; height:7px; border-radius:50%; background:#b6bbc1; box-shadow:0 0 5px #969ba1; }
  .version.has-update { border-color:#746b3f; box-shadow:0 0 0 1px #d9c4591c; }
  .version.has-update small { color:#d8ca7c; }
  .revision-blip { display:inline-block; width:8px; height:8px; flex:0 0 8px; border:1px solid #fff0a3; border-radius:50%; background:#ffd84a; box-shadow:0 0 8px #f0c62f; animation:revision-pulse 2.4s ease-in-out infinite; }
  @keyframes revision-pulse {
    50% { opacity:.55; box-shadow:0 0 3px #e9ca43; }
  }
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
