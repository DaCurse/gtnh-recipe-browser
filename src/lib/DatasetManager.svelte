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

<style>
  .scrim { position:fixed; inset:0; z-index:20; display:grid; place-items:center; padding:18px; background:#050806c7; backdrop-filter:blur(7px); }
  .manager { position:relative; width:min(620px,100%); max-height:min(88vh,760px); overflow:auto; padding:30px; border:1px solid #4b4f54; border-radius:14px; background:#202226; box-shadow:0 30px 90px #000; }
  .manager h2 { font:23px Minecraft; margin:0 0 8px; text-shadow:2px 2px #342c34; }
  .manager>p:not(.eyebrow) { color:#a6abb0; font-size:14px; line-height:1.5; }
  .close { position:absolute; right:12px; top:10px; width:44px; height:44px; border:0; background:none; color:#989da2; font-size:25px; cursor:pointer; }
  .dataset-list { display:flex; flex-direction:column; gap:10px; margin:20px 0; }
  .dataset { padding:14px; border:1px solid #484c51; border-radius:9px; background:#292c30; }
  .dataset.active { border-color:#737980; background:#2d3034; }
  .dataset-icon { display:grid; place-items:center; width:42px; height:42px; flex:0 0 42px; }
  .dataset-icon img { display:block; width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 2px 4px #0009); }
  .dataset-summary { display:flex; align-items:center; gap:12px; }
  .dataset-summary>div { min-width:0; flex:1; }
  .dataset b,.dataset small { display:block; }
  .dataset-summary small { margin-top:6px; color:#b0b4b8; font-size:10px; }
  .dataset-summary strong { color:#9a9fa4; font-size:12px; text-align:right; white-space:nowrap; }
  .dataset i { display:inline-block; width:7px; height:7px; border-radius:50%; background:#b6bbc1; box-shadow:0 0 5px #969ba1; }
  .dataset-actions { display:flex; align-items:center; justify-content:flex-end; gap:7px; margin-top:12px; }
  .dataset-actions button,.active-label { min-height:42px; padding:0 13px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:1px solid #5b6066; border-radius:7px; background:#363a3f; color:#e1e4e7; font-size:12px; font-weight:700; cursor:pointer; }
  .dataset-actions button.primary { background:#d1d4d7; border-color:#d1d4d7; color:#17191b; }
  .dataset-actions button.delete { margin-left:auto; color:#c5a4a4; border-color:#654b4b; background:#382b2d; }
  .dataset-actions button.cancel { color:#d6c4a4; }
  .dataset-actions button:disabled { opacity:.42; cursor:not-allowed; }
  .active-label { border-color:transparent; background:transparent; color:#b8bdc2; }
  .download-icon { width:20px; height:20px; flex:0 0 20px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .dataset-progress { height:7px; overflow:hidden; margin-top:13px; border-radius:999px; background:#17191b; box-shadow:inset 0 1px 3px #0008; }
  .dataset-progress span { display:block; height:100%; border-radius:inherit; background:#c9cdd1; transition:width .15s; }
  .dataset-progress-text { margin-top:7px!important; color:#999ea3!important; font:10px/1.4 ui-monospace,monospace; }
  .manager-loading { min-height:90px; display:flex; align-items:center; justify-content:center; gap:10px; color:#989da2; }
  .manager-error { max-height:130px; overflow:auto; margin:12px 0; padding:10px; border:1px solid #60484b; border-radius:7px; background:#191416; color:#d0b9bc; font:11px/1.45 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
  .storage { display:block; margin-top:12px; text-align:center; color:#7c8186; line-height:1.5; }
  @media (max-width:800px) {
    .scrim { padding:12px; }
    .manager { max-height:calc(100dvh - 24px); padding:25px 16px; }
    .dataset-summary { align-items:flex-start; }
    .dataset-summary strong { max-width:120px; white-space:normal; }
    .dataset-actions { flex-wrap:wrap; justify-content:stretch; }
    .dataset-actions button { flex:1; }
    .dataset-actions button.delete { flex:0 0 auto; margin-left:0; }
  }
</style>
