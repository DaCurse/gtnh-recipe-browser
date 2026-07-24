<script lang="ts">
  import type {
    DatasetState,
    DatasetVersion,
    ManagedDataset,
    OfflineInstallProgress
  } from './types';

  let {
    datasets,
    currentDatasetId,
    loading,
    error,
    installingDatasetId,
    switchingDatasetId,
    installProgress,
    storageUsage,
    storageQuota,
    persistentStorage,
    close,
    install,
    cancelInstall,
    switchDataset,
    deleteDataset
  }: {
    datasets: ManagedDataset[];
    currentDatasetId?: string;
    loading: boolean;
    error: string;
    installingDatasetId: string;
    switchingDatasetId: string;
    installProgress?: OfflineInstallProgress;
    storageUsage?: number;
    storageQuota?: number;
    persistentStorage?: boolean;
    close: () => void;
    install: (version: DatasetVersion) => void;
    cancelInstall: () => void;
    switchDataset: (version: DatasetVersion) => void;
    deleteDataset: (state: DatasetState) => void;
  } = $props();

  function formatBytes(bytes?: number): string {
    if (bytes === undefined || !Number.isFinite(bytes)) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }

  function datasetStateLabel(state?: DatasetState, current = false): string {
    if (current && state?.status === 'complete') return 'Active · Offline ready';
    if (current) return 'Active · Catalog cached';
    if (state?.status === 'complete') return 'Installed · Offline ready';
    if (state?.status === 'partial') return 'Partially downloaded';
    if (state) return 'Catalog cached';
    return 'Available online';
  }
</script>

<div class="scrim" role="presentation" onclick={(event) => {
  if (event.currentTarget === event.target) close();
}}>
  <div class="manager" role="dialog" aria-modal="true" aria-label="Dataset manager">
    <button class="close" onclick={close}>×</button>
    <p class="eyebrow">DATASET MANAGER</p>
    <h2>Your GTNH versions</h2>
    <p>Catalogs stay available after loading. Install every recipe and icon chunk for complete offline use.</p>
    {#if loading && datasets.length === 0}
      <div class="manager-loading"><span class="mini-spinner"></span> Checking local datasets…</div>
    {:else}
      <div class="dataset-list">
        {#each datasets as managed (managed.version.datasetId)}
          {@const state = managed.state}
          {@const installing = installingDatasetId === managed.version.datasetId}
          {@const switching = switchingDatasetId === managed.version.datasetId}
          {@const current = currentDatasetId === managed.version.datasetId}
          <section class:active={current} class="dataset">
            <div class="dataset-summary">
              <span class="dataset-icon"><img src="./assets/gtnh-logo.png" alt="" /></span>
              <div>
                <b>{managed.version.gtnhVersion}</b>
                <small><i></i> {datasetStateLabel(state, current)}</small>
              </div>
              <strong>
                {formatBytes(state?.storedBytes ?? 0)} / {formatBytes(
                  state?.totalBytes ?? managed.version.offlineBytes
                )}
              </strong>
            </div>
            {#if installing && installProgress}
              <div
                class="dataset-progress"
                aria-label={`Offline download ${Math.round(installProgress.loadedBytes / Math.max(1, installProgress.totalBytes) * 100)}%`}
              >
                <span style:width={`${installProgress.loadedBytes / Math.max(1, installProgress.totalBytes) * 100}%`}></span>
              </div>
              <small class="dataset-progress-text">
                {formatBytes(installProgress.loadedBytes)} of {formatBytes(installProgress.totalBytes)}
                · {installProgress.completedAssets}/{installProgress.totalAssets} chunks
                {#if installProgress.retry} · retry {installProgress.retry}/3{/if}
              </small>
            {/if}
            <div class="dataset-actions">
              {#if current}
                <span class="active-label">Active</span>
              {:else}
                <button
                  disabled={Boolean(switchingDatasetId || installingDatasetId)}
                  onclick={() => switchDataset(managed.version)}
                >{switching ? 'Switching…' : 'Switch'}</button>
              {/if}
              {#if state?.status !== 'complete'}
                {#if installing}
                  <button class="cancel" onclick={cancelInstall}>Cancel</button>
                {:else}
                  <button
                    class="primary"
                    disabled={Boolean(installingDatasetId || switchingDatasetId)}
                    onclick={() => install(managed.version)}
                  >
                    <svg class="download-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3v12m-5-5 5 5 5-5M5 20h14"></path>
                    </svg>
                    {state?.status === 'partial' ? 'Resume download' : 'Download offline'}
                  </button>
                {/if}
              {/if}
              {#if state}
                <button
                  class="delete"
                  disabled={Boolean(installingDatasetId || switchingDatasetId)}
                  onclick={() => deleteDataset(state)}
                >Delete</button>
              {/if}
            </div>
          </section>
        {:else}
          <div class="manager-loading">No GTNH datasets are available.</div>
        {/each}
      </div>
    {/if}
    {#if error}<pre class="manager-error">{error}</pre>{/if}
    <small class="storage">
      {storageUsage !== undefined && storageQuota !== undefined
        ? `${formatBytes(storageUsage)} used of ${formatBytes(storageQuota)} browser storage`
        : 'Browser storage usage is unavailable'}
      · {persistentStorage === true
        ? 'persistent storage granted'
        : persistentStorage === false
          ? 'storage may be reclaimed by the browser'
          : 'persistence support unavailable'}
    </small>
  </div>
</div>
