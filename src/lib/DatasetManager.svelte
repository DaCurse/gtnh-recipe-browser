<script lang="ts">
  import type {
    DatasetState,
    DatasetStorageReport,
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
    physicalAssetBytes,
    physicalAssetCount,
    storageReport,
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
    physicalAssetBytes: number;
    physicalAssetCount: number;
    storageReport: DatasetStorageReport;
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

  function hasMultipleRevisions(version: DatasetVersion): boolean {
    return datasets.filter(
      (managed) => managed.version.gtnhVersion === version.gtnhVersion
    ).length > 1;
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
    <section class="storage-overview" aria-label="Shared asset storage">
      <div class="storage-overview-heading">
        <span class="storage-overview-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 7.5 12 4l8 3.5L12 11 4 7.5Z"></path><path d="M4 12.5 12 16l8-3.5M4 17.5 12 21l8-3.5"></path></svg>
        </span>
        <div>
          <b>Shared asset cache</b>
          <small>{physicalAssetCount.toLocaleString('en-US')} immutable objects · {formatBytes(storageReport.referencedBytes)} referenced</small>
        </div>
        <strong>{formatBytes(physicalAssetBytes)}</strong>
      </div>
      <div class="storage-overview-metrics">
        <span>
          <b>{formatBytes(storageReport.logicalBytes)}</b>
          <small>logical cached</small>
        </span>
        <span>
          <b>{formatBytes(storageReport.sharedSavingsBytes)}</b>
          <small>saved by sharing</small>
        </span>
        <span>
          <b>{storageReport.sharedAssets.toLocaleString('en-US')}</b>
          <small>shared objects</small>
        </span>
      </div>
      {#if storageReport.untrackedBytes > 0}
        <small class="storage-overview-note">
          {formatBytes(storageReport.untrackedBytes)} in {storageReport.untrackedAssets.toLocaleString('en-US')} unassigned objects
        </small>
      {/if}
    </section>
    {#if loading && datasets.length === 0}
      <div class="manager-loading"><span class="mini-spinner"></span> Checking local datasets…</div>
    {:else}
      <div class="dataset-list">
        {#each datasets as managed (managed.version.datasetId)}
          {@const state = managed.state}
          {@const installing = installingDatasetId === managed.version.datasetId}
          {@const switching = switchingDatasetId === managed.version.datasetId}
          {@const current = currentDatasetId === managed.version.datasetId}
          {@const usage = storageReport.byDataset[managed.version.datasetId]}
          <section
            class:active={current}
            class:stale={managed.stale}
            class:update={managed.newRevisionAvailable}
            class="dataset"
          >
            <div class="dataset-summary">
              <span class="dataset-icon"><img src="./assets/gtnh-logo.png" alt="" /></span>
              <div>
                <div class="dataset-title">
                  <b>{managed.version.gtnhVersion}</b>
                  {#if managed.stale}
                    <span
                      class="status-chip stale-chip"
                      title="Stored on this device, but no longer listed in the published dataset index."
                    >Stale</span>
                  {/if}
                  {#if managed.newRevisionAvailable}
                    <span
                      class="status-chip update-chip"
                      title="A newer published dataset revision is available for this GTNH version."
                    ><span></span>New revision</span>
                  {/if}
                </div>
                {#if hasMultipleRevisions(managed.version)}
                  <small class="dataset-revision">Revision {managed.version.revision.slice(0, 8)}</small>
                {/if}
                <small><i></i> {datasetStateLabel(state, current)}</small>
              </div>
              <div
                class="dataset-size"
                title={state
                  ? 'Bytes referenced only by this version; deleting it would release this amount.'
                  : 'Complete logical size before shared-cache overlap is known.'}
              >
                <strong>{formatBytes(state ? usage?.exclusiveBytes ?? 0 : managed.version.offlineBytes)}</strong>
                <small>{state ? 'unique cache' : 'full download'}</small>
              </div>
            </div>
            <div class="dataset-storage" aria-label={`${managed.version.gtnhVersion} storage details`}>
              {#if state}
                <span><b>{formatBytes(usage?.cachedBytes ?? 0)}</b> cached</span>
                <span><b>{formatBytes(usage?.sharedBytes ?? 0)}</b> shared</span>
                <span><b>{formatBytes(managed.version.offlineBytes ?? state.totalBytes)}</b> complete</span>
              {:else}
                <span><b>{formatBytes(managed.version.offlineBytes)}</b> logical download estimate</span>
                <span class="dataset-storage-muted">Shared overlap is calculated after installation</span>
              {/if}
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
  .dataset.stale { border-color:#605a50; }
  .dataset.update { border-color:#777052; box-shadow:0 0 0 1px #d6bd5526; }
  .dataset-icon { display:grid; place-items:center; width:42px; height:42px; flex:0 0 42px; }
  .dataset-icon img { display:block; width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 2px 4px #0009); }
  .dataset-summary { display:flex; align-items:center; gap:12px; }
  .dataset-summary>div { min-width:0; flex:1; }
  .dataset-title { display:flex; align-items:center; flex-wrap:wrap; gap:7px; }
  .status-chip { display:inline-flex; align-items:center; min-height:20px; padding:1px 7px; border:1px solid; border-radius:999px; font-size:9px; font-weight:800; line-height:1; letter-spacing:.04em; text-transform:uppercase; }
  .stale-chip { border-color:#756d60; background:#3a3630; color:#c2b9aa; }
  .update-chip { gap:5px; border-color:#8b7e42; background:#443e25; color:#eadc8b; }
  .update-chip span { width:6px; height:6px; flex:0 0 6px; border-radius:50%; background:#ffd84a; box-shadow:0 0 7px #f0c62f; }
  .dataset b,.dataset small { display:block; }
  .dataset-summary small { margin-top:6px; color:#b0b4b8; font-size:10px; }
  .dataset-summary .dataset-revision { color:#858a8f; font:10px ui-monospace,monospace; }
  .dataset-size { flex:0 0 auto!important; text-align:right; }
  .dataset-size strong { display:block; color:#d4d7da; font-size:13px; white-space:nowrap; }
  .dataset-size small { margin-top:4px!important; color:#8f959a; font-size:9px; white-space:nowrap; }
  .dataset i { display:inline-block; width:7px; height:7px; border-radius:50%; background:#b6bbc1; box-shadow:0 0 5px #969ba1; }
  .dataset-storage { display:flex; align-items:center; flex-wrap:wrap; gap:5px 13px; margin:11px 0 0 54px; color:#9da2a7; font-size:10px; line-height:1.45; }
  .dataset-storage span { white-space:nowrap; }
  .dataset-storage b { color:#d1d4d7; font-size:11px; }
  .dataset-storage-muted { color:#777d82; }
  .dataset-actions { display:flex; align-items:center; justify-content:flex-end; gap:7px; margin-top:12px; }
  .dataset-actions button,.active-label { min-height:42px; padding:0 13px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:1px solid #5b6066; border-radius:7px; background:#363a3f; color:#e1e4e7; font-size:12px; font-weight:700; cursor:pointer; }
  .dataset-actions button.primary { background:#d1d4d7; border-color:#d1d4d7; color:#17191b; }
  .dataset-actions button.delete { margin-left:auto; color:#c5a4a4; border-color:#654b4b; background:#382b2d; }
  .dataset.stale .dataset-actions button.delete { color:#ffd4d7; border-color:#98525a; background:#663139; }
  .dataset.stale .dataset-actions button.delete:hover { border-color:#bd6872; background:#783943; }
  .dataset-actions button.cancel { color:#d6c4a4; }
  .dataset-actions button:disabled { opacity:.42; cursor:not-allowed; }
  .active-label { border-color:transparent; background:transparent; color:#b8bdc2; }
  .download-icon { width:20px; height:20px; flex:0 0 20px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .dataset-progress { height:7px; overflow:hidden; margin-top:13px; border-radius:999px; background:#17191b; box-shadow:inset 0 1px 3px #0008; }
  .dataset-progress span { display:block; height:100%; border-radius:inherit; background:#c9cdd1; transition:width .15s; }
  .dataset-progress-text { margin-top:7px!important; color:#999ea3!important; font:10px/1.4 ui-monospace,monospace; }
  .manager-loading { min-height:90px; display:flex; align-items:center; justify-content:center; gap:10px; color:#989da2; }
  .manager-error { max-height:130px; overflow:auto; margin:12px 0; padding:10px; border:1px solid #60484b; border-radius:7px; background:#191416; color:#d0b9bc; font:11px/1.45 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
  .storage-overview { margin:18px 0 20px; padding:13px 14px 12px; border:1px solid #4c5258; border-radius:10px; background:linear-gradient(135deg,#2d3237,#272a2e); box-shadow:inset 0 1px #ffffff08; }
  .storage-overview-heading { display:flex; align-items:center; gap:10px; }
  .storage-overview-heading>div { min-width:0; flex:1; }
  .storage-overview-heading b { display:block; color:#e4e7e9; font-size:12px; }
  .storage-overview-heading small { display:block; margin-top:4px; color:#969da3; font-size:10px; }
  .storage-overview-heading>strong { color:#f0f2f3; font-size:15px; white-space:nowrap; }
  .storage-overview-icon { display:grid; place-items:center; width:32px; height:32px; flex:0 0 32px; border:1px solid #697178; border-radius:7px; background:#171a1d80; color:#d1d6da; }
  .storage-overview-icon svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.6; }
  .storage-overview-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:12px; padding-top:10px; border-top:1px solid #ffffff0d; }
  .storage-overview-metrics span { min-width:0; }
  .storage-overview-metrics b { display:block; overflow:hidden; color:#cdd2d6; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
  .storage-overview-metrics small { display:block; margin-top:3px; color:#858c92; font-size:9px; }
  .storage-overview-note { display:block; margin-top:9px; color:#c4a982; font-size:9px; }
  .storage { display:block; margin-top:12px; text-align:center; color:#7c8186; line-height:1.5; }
  @media (max-width:800px) {
    .scrim { padding:12px; }
    .manager { max-height:calc(100dvh - 24px); padding:25px 16px; }
    .dataset-summary { align-items:flex-start; }
    .dataset-size { max-width:120px; }
    .dataset-size strong { white-space:normal; }
    .dataset-storage { margin-left:0; }
    .dataset-actions { flex-wrap:wrap; justify-content:stretch; }
    .dataset-actions button { flex:1; }
    .dataset-actions button.delete { flex:0 0 auto; margin-left:0; }
  }
</style>
