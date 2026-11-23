<script lang="ts">
  import { onMount } from 'svelte';
  import { getCachedAsset } from './storage';
  import { questVersions } from '../questbook/repository';
  import { questbook } from '../questbook/state.svelte';
  import type { QuestVersion } from '../questbook/types';
  import type {
    DatasetState,
    DatasetStorageReport,
    DatasetVersion,
    ManagedDataset,
    OfflineInstallProgress,
  } from '../types';
  let {
    datasets,
    currentDatasetId,
    recipeVersion,
    loading,
    error,
    installingDatasetId,
    switchingDatasetId,
    installProgress,
    storageUsage,
    storageReport,
    close,
    install,
    cancelInstall,
    switchDataset,
    deleteDataset,
  }: {
    datasets: ManagedDataset[];
    currentDatasetId?: string;
    recipeVersion: string;
    loading: boolean;
    error: string;
    installingDatasetId: string;
    switchingDatasetId: string;
    installProgress?: OfflineInstallProgress;
    storageUsage?: number;
    storageReport: DatasetStorageReport;
    close: () => void;
    install: (version: DatasetVersion) => void;
    cancelInstall: () => void;
    switchDataset: (version: DatasetVersion) => void;
    deleteDataset: (state: DatasetState) => void;
  } = $props();
  let section = $state<'items' | 'quests'>(
    new URL(location.href).searchParams.get('page') === 'quests' ? 'quests' : 'items',
  );
  let questDatasets = $state<QuestVersion[]>([]);
  let questCached = $state<Record<string, boolean>>({});
  let questIndexLoading = $state(true);
  let questIndexError = $state('');
  let choosingQuest = $state('');
  let rememberedQuest = $state('');
  const selectedQuest = $derived(
    questDatasets.find(
      (version) => version.version === (questbook.version || rememberedQuest || recipeVersion),
    )?.version ??
      questDatasets[0]?.version ??
      '',
  );
  function formatBytes(bytes?: number): string {
    if (bytes === undefined || !Number.isFinite(bytes)) return '';
    return bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  function status(state?: DatasetState): string {
    if (state?.status === 'complete') return 'Available offline';
    if (state?.status === 'partial') return 'Some content cached';
    return state ? 'Opened content is cached' : '';
  }
  async function refreshQuests() {
    questIndexLoading = true;
    questIndexError = '';
    try {
      const index = await questVersions();
      questDatasets = index.value.versions;
      const cached = await Promise.all(
        questDatasets.map(
          async (version) => [version.sha256, !!(await getCachedAsset(version.sha256))] as const,
        ),
      );
      questCached = Object.fromEntries(cached);
    } catch {
      questIndexError = 'Quest versions could not load.';
    } finally {
      questIndexLoading = false;
    }
  }
  async function chooseQuest(version: QuestVersion) {
    choosingQuest = version.version;
    try {
      await questbook.selectVersion(version.version, recipeVersion);
      if (questbook.status === 'ready') {
        rememberedQuest = version.version;
        questCached = {
          ...questCached,
          [version.sha256]: !!(await getCachedAsset(version.sha256)),
        };
      }
    } finally {
      choosingQuest = '';
    }
  }
  onMount(() => {
    try {
      rememberedQuest = localStorage.getItem('gtnh-quest-version') ?? '';
    } catch {
      /* Optional preference. */
    }
    void refreshQuests();
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') close();
  }}
/>
<div
  class="scrim"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) close();
  }}
>
  <div class="manager" role="dialog" aria-modal="true" aria-label="Dataset manager" tabindex="-1">
    <div class="manager-heading">
      <h2>Datasets</h2>
      <button class="close" aria-label="Close dataset manager" onclick={close}>×</button>
    </div>
    <div class="dataset-tabs" role="group" aria-label="Dataset type">
      <button
        id="item-datasets-title"
        class="mc-button compact"
        aria-pressed={section === 'items'}
        onclick={() => (section = 'items')}
        ><img src="./assets/navigation/items.png" alt="" width="20" height="20" />Items & recipes</button
      >
      <button
        id="quest-datasets-title"
        class="mc-button compact"
        aria-pressed={section === 'quests'}
        onclick={() => (section = 'quests')}
        ><img src="./assets/navigation/quests.png" alt="" width="20" height="20" />Questbook</button
      >
    </div>
    <section
      class="dataset-section"
      hidden={section !== 'items'}
      aria-labelledby="item-datasets-title"
    >
      <p>Choose a GTNH version. Save a full download for offline browsing.</p>
      {#if loading && !datasets.length}<p role="status">Loading versions…</p>{/if}
      <div class="dataset-list">
        {#each datasets as managed (managed.version.datasetId)}
          {@const current = currentDatasetId === managed.version.datasetId}
          {@const installing = installingDatasetId === managed.version.datasetId}
          {@const switching = switchingDatasetId === managed.version.datasetId}
          {@const usage = storageReport.byDataset[managed.version.datasetId]}
          <article class="dataset" class:active={current}>
            <div class="dataset-summary">
              <div>
                <h4>
                  {managed.version.gtnhVersion}{#if current}<span class="active-label"
                      >Selected</span
                    >{/if}
                </h4>
                {#if managed.state}<small>{status(managed.state)}</small>{/if}
                {#if managed.newRevisionAvailable}<small class="update-label"
                    >Update available</small
                  >{/if}
                {#if managed.stale}<small>Saved version no longer published</small>{/if}
              </div>
              <span
                class="dataset-size"
                title={managed.state ? 'Space freed if removed' : 'Full offline download'}
                >{formatBytes(
                  managed.state ? usage?.exclusiveBytes : managed.version.offlineBytes,
                )}</span
              >
            </div>
            {#if installing && installProgress}
              <progress
                max={installProgress.totalBytes || 1}
                value={installProgress.loadedBytes}
                aria-label="Offline download progress"
              ></progress>
              <small
                >{formatBytes(installProgress.loadedBytes)} / {formatBytes(
                  installProgress.totalBytes,
                )}</small
              >
            {/if}
            <div class="dataset-actions">
              {#if !current}<button
                  class="mc-button compact"
                  disabled={!!(switchingDatasetId || installingDatasetId)}
                  onclick={() => switchDataset(managed.version)}
                  >{switching ? 'Switching…' : 'Use version'}</button
                >{/if}
              {#if managed.state?.status !== 'complete'}
                {#if installing}<button class="mc-button compact" onclick={cancelInstall}
                    >Cancel download</button
                  >
                {:else}<button
                    class="mc-button compact"
                    disabled={!!(installingDatasetId || switchingDatasetId)}
                    onclick={() => install(managed.version)}
                    >{managed.state?.status === 'partial'
                      ? 'Resume download'
                      : 'Download offline'}</button
                  >{/if}
              {/if}
              {#if managed.state}<button
                  class="mc-button compact delete-download"
                  aria-label={`Remove ${managed.version.gtnhVersion} download`}
                  title="Remove download"
                  disabled={!!(installingDatasetId || switchingDatasetId)}
                  onclick={() => deleteDataset(managed.state!)}
                  ><img
                    src="./assets/machine-ui/nei-trash.png"
                    alt=""
                    width="18"
                    height="18"
                  /></button
                >{/if}
            </div>
          </article>
        {:else}{#if !loading}<p>No item datasets available.</p>{/if}{/each}
      </div>
      {#if error}<p class="manager-error" role="alert">{error}</p>{/if}
    </section>
    <section
      class="dataset-section"
      hidden={section !== 'quests'}
      aria-labelledby="quest-datasets-title"
    >
      <p>Questbooks download when opened and stay cached for your next visit.</p>
      {#if selectedQuest && selectedQuest !== recipeVersion}<p class="version-note">
          Questbook {selectedQuest} · Items {recipeVersion}
        </p>{/if}
      {#if questIndexLoading && !questDatasets.length}<p role="status">Loading versions…</p>{/if}
      {#if questIndexError}<p class="manager-error">
          {questIndexError} <button class="remove" onclick={refreshQuests}>Retry</button>
        </p>{/if}
      <div class="dataset-list">
        {#each questDatasets as version (version.sha256)}
          {@const current = version.version === selectedQuest}
          {@const ready = questbook.status === 'ready' && questbook.version === version.version}
          <article class="dataset" class:active={current}>
            <div class="dataset-summary">
              <div>
                <h4>
                  {version.version}{#if current}<span class="active-label">Selected</span>{/if}
                </h4>
                <small
                  >{version.questCount.toLocaleString()} quests · {version.chapterCount} chapters</small
                ><small
                  >{questCached[version.sha256] ? 'Quest data cached' : 'Not downloaded'}</small
                >
              </div>
              <span class="dataset-size">{formatBytes(version.bytes)}</span>
            </div>
            {#if choosingQuest === version.version}<progress
                value={questbook.progress}
                max="100"
                aria-label="Questbook download progress"
              ></progress>{/if}
            {#if !current || !ready}<div class="dataset-actions">
                <button
                  class="mc-button compact"
                  disabled={questbook.status === 'loading' || !!choosingQuest}
                  onclick={() => chooseQuest(version)}
                  >{choosingQuest === version.version
                    ? 'Loading…'
                    : current
                      ? 'Load questbook'
                      : 'Use version'}</button
                >
              </div>{/if}
          </article>
        {/each}
      </div>
      {#if questbook.status === 'error'}<p class="manager-error" role="alert">
          {questbook.error}
        </p>{/if}
    </section>
    {#if storageUsage !== undefined}<p class="storage">
        {formatBytes(storageUsage)} stored on this device
      </p>{/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 16px;
    background: #050608ba;
    backdrop-filter: blur(6px);
  }
  .manager {
    width: min(640px, 100%);
    height: min(88dvh, 820px);
    max-height: calc(100dvh - 16px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 24px;
    border: 1px solid #44494e;
    border-radius: 10px;
    background: #1b1d20;
    box-shadow: 0 20px 80px #0009;
  }
  .manager-heading {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  h2,
  h4 {
    margin: 0;
    font-family: Minecraft, monospace;
    font-weight: 400;
    text-shadow: 2px 2px #222;
  }
  h2 {
    font-size: 24px;
  }
  h4 {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 18px;
  }
  .close {
    border: 0;
    background: none;
    color: #a6abb0;
    width: 32px;
    height: 32px;
    font-size: 25px;
    cursor: pointer;
  }
  .dataset-tabs {
    flex: none;
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
  }
  .dataset-tabs img,
  .delete-download img {
    image-rendering: pixelated;
  }
  .dataset-section {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .dataset-section[hidden] {
    display: none;
  }
  p {
    color: #999fa6;
    font-size: 12px;
    line-height: 1.5;
    margin: 8px 0 14px;
  }
  .dataset-list {
    display: grid;
    gap: 8px;
  }
  .dataset {
    padding: 12px;
    border: 1px solid #353a40;
    border-radius: 5px;
    background: #23262a;
  }
  .dataset.active {
    border-color: #6b7178;
  }
  .dataset-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .dataset-summary > div {
    min-width: 0;
  }
  small {
    display: block;
    margin-top: 5px;
    color: #939aa2;
    font-size: 11px;
    line-height: 1.4;
  }
  .active-label {
    color: #b9ad7e;
    font:
      11px/16px ui-sans-serif,
      system-ui,
      sans-serif;
    text-shadow: none;
  }
  .dataset-size {
    flex: none;
    color: #979ea6;
    font-size: 11px;
  }
  .update-label {
    color: #d6bd73;
  }
  .dataset-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .remove {
    border: 0;
    background: transparent;
    color: #90979f;
    padding: 6px 2px;
    font-size: 11px;
    cursor: pointer;
  }
  .remove:hover {
    color: #d9dde2;
    text-decoration: underline;
  }
  .remove:disabled {
    opacity: 0.4;
    cursor: default;
  }
  progress {
    width: 100%;
    height: 4px;
    margin-top: 12px;
    accent-color: #b6ad8b;
  }
  .manager-error {
    color: #dfa99d;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .version-note,
  .storage {
    font-size: 10px;
    color: #838b94;
  }
  .storage {
    margin: 16px 0 0;
    text-align: center;
  }
  @media (max-width: 600px) {
    .scrim {
      padding: 8px;
    }
    .manager {
      padding: 16px;
      max-height: calc(100dvh - 16px);
    }
  }
</style>
