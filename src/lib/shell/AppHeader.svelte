<script lang="ts">
  import type { Snippet } from 'svelte';
  import ProjectLinks from './ProjectLinks.svelte';
  import type { DatasetState } from '../types';

  let {
    navigation,
    datasetVersion,
    activeDataset,
    datasetUpdateAvailable,
    updateReady,
    landing = false,
    showProjectLinks = true,
    showHome,
    openDatasetManager,
  }: {
    navigation?: Snippet;
    datasetVersion: string;
    activeDataset?: DatasetState;
    datasetUpdateAvailable: boolean;
    updateReady: boolean;
    landing?: boolean;
    showProjectLinks?: boolean;
    showHome: () => void;
    openDatasetManager: () => void;
  } = $props();
</script>

<header class:landing>
  <a
    class="brand"
    href="./"
    title="Home"
    aria-label="GTNH Recipe Browser home"
    onclick={(event) => {
      event.preventDefault();
      showHome();
    }}
  >
    <span class="brand-cube"
      ><img src="./assets/gtnh-logo-header.webp" width="84" height="84" alt="" /></span
    >
    <span class="brand-title"><b>GTNH</b> <small>RECIPE BROWSER</small></span>
  </a>
  {#if navigation}{@render navigation()}{/if}
  <div class="header-utilities">
    {#if showProjectLinks}
      <ProjectLinks variant="header-links" />
    {/if}
    <button
      class:has-update={datasetUpdateAvailable}
      class="mc-button version"
      aria-label={`Dataset ${datasetVersion}. Open dataset manager`}
      title={`Dataset ${datasetVersion} · ${datasetUpdateAvailable ? 'New revision available' : activeDataset?.status === 'complete' ? 'Offline ready' : activeDataset ? 'Catalog cached' : 'Online only'}`}
      onclick={openDatasetManager}
    >
      <span class="version-title">
        <span class="version-number">{datasetVersion}</span>
        {#if datasetUpdateAvailable}
          <span
            class="revision-blip"
            title="A newer published dataset revision is available for this GTNH version."
          ></span>
        {/if}
      </span>
      <svg class="chevron-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 9 5 5 5-5"></path>
      </svg>
    </button>
  </div>
</header>

{#if updateReady}
  <button class="mc-button update-banner" onclick={() => location.reload()}>
    A new app version is ready · Refresh
  </button>
{/if}

<style>
  header {
    height: 60px;
    flex: none;
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 0 16px;
    border-bottom: 1px solid #34373b;
    background: #17181be8;
    backdrop-filter: blur(15px);
    z-index: 5;
  }
  .brand {
    width: max-content;
    display: flex;
    gap: 11px;
    align-items: center;
    text-decoration: none;
    color: white;
  }
  .brand-cube {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    flex: 0 0 42px;
  }
  .brand-cube img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 2px 4px #0009);
  }
  .brand span:last-child {
    display: flex;
    flex-direction: column;
    line-height: 1;
  }
  .brand b {
    font: 18px/24px Minecraft;
    letter-spacing: 0;
    color: #eef0f2;
    text-shadow: 2px 2px #342c34;
  }
  .brand small {
    margin-top: 5px;
    color: #81858a;
    font: 9px/13px Minecraft;
    letter-spacing: 0;
    text-shadow: 2px 2px #342c34;
  }
  .version {
    flex: none;
    width: 118px;
    min-width: 0;
    min-height: 40px;
    padding: 4px 26px 4px 8px;
    position: relative;
    border: 1px solid #3a3d42;
    border-radius: 8px;
    background: #212327;
    text-align: left;
    cursor: pointer;
  }
  .version .version-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
  }
  .version-number {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .version.has-update {
    border-color: #746b3f;
    box-shadow: 0 0 0 1px #d9c4591c;
  }
  .revision-blip {
    display: inline-block;
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border: 1px solid #fff0a3;
    border-radius: 50%;
    background: #ffd84a;
    box-shadow: 0 0 8px #f0c62f;
    animation: revision-pulse 2.4s ease-in-out infinite;
  }
  @keyframes revision-pulse {
    50% {
      opacity: 0.55;
      box-shadow: 0 0 3px #e9ca43;
    }
  }
  .chevron-icon {
    position: absolute;
    right: 10px;
    top: 52%;
    width: 20px;
    height: 20px;
    transform: translateY(-50%);
    fill: none;
    stroke: #9da2a7;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .update-banner {
    border: 0;
    padding: 8px;
    background: #bfc3c7;
    color: #17191b;
    cursor: pointer;
  }
  .header-utilities {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 16px;
    flex: none;
  }
  @media (max-width: 1200px) {
    :global(.header-utilities .header-links) {
      display: none;
    }
  }
  @media (max-width: 800px) {
    header {
      padding: 0 8px;
      gap: 6px;
      height: 54px;
      position: sticky;
      top: 0;
    }
    header.landing {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
    }
    .landing .brand {
      justify-self: start;
    }
    .landing .header-utilities {
      grid-column: 2;
      margin-left: 0;
    }
    :global(header .primary-nav) {
      flex: 1;
      justify-content: center;
    }
    .brand {
      flex: none;
    }
    .brand span.brand-title {
      display: none;
    }
    .brand-cube {
      width: 32px;
      height: 32px;
      flex-basis: 32px;
    }
    .version {
      width: 78px;
    }
    .landing .version {
      width: 94px;
    }
    .chevron-icon {
      width: 14px;
      height: 14px;
      right: 4px;
    }
  }
</style>
