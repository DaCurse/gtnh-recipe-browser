import { DatasetRepository } from './dataset';
import { hasRevisionUpdate, reconcileDatasetVersions } from './datasetVersions';
import { storageShortfall } from './offline';
import {
  estimateStorage,
  listDatasets,
  removeDataset,
  requestPersistentStorage,
  storageIsPersistent
} from './storage';
import type {
  DatasetState,
  DatasetVersion,
  ManagedDataset,
  OfflineInstallProgress
} from './types';

interface DatasetManagerCallbacks {
  getRepository: () => DatasetRepository | null;
  validateRepository: (repository: DatasetRepository) => void;
  applyRepository: (repository: DatasetRepository, preserveSelection: boolean) => Promise<void>;
  markReady: () => void;
}

function diagnostic(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export class DatasetManagerState {
  open = $state(false);
  availableDatasets = $state<DatasetVersion[]>([]);
  datasetRecords = $state<DatasetState[]>([]);
  loading = $state(false);
  error = $state('');
  installingDatasetId = $state('');
  switchingDatasetId = $state('');
  installProgress = $state<OfflineInstallProgress>();
  storageUsage = $state<number>();
  storageQuota = $state<number>();
  persistentStorage = $state<boolean>();
  private installController: AbortController | null = null;

  constructor(private readonly callbacks: DatasetManagerCallbacks) {}

  get datasets(): ManagedDataset[] {
    return reconcileDatasetVersions(this.availableDatasets, this.datasetRecords);
  }

  get activeDataset(): DatasetState | undefined {
    return this.datasetRecords.find((state) => state.active);
  }

  hasRevisionUpdate(datasetId?: string): boolean {
    return hasRevisionUpdate(this.availableDatasets, this.datasetRecords, datasetId);
  }

  show() {
    this.open = true;
    void this.refresh();
  }

  async refresh() {
    this.loading = true;
    this.error = '';
    try {
      const [versions, records, storage, persisted] = await Promise.all([
        DatasetRepository.availableVersions(),
        listDatasets(),
        estimateStorage(),
        storageIsPersistent()
      ]);
      this.availableDatasets = versions;
      this.datasetRecords = records;
      this.storageUsage = storage.usage;
      this.storageQuota = storage.quota;
      this.persistentStorage = persisted;
    } catch (error) {
      this.error = diagnostic(error);
      this.datasetRecords = await listDatasets();
    } finally {
      this.loading = false;
    }
  }

  async refreshRecords() {
    this.datasetRecords = await listDatasets();
  }

  async refreshAvailability() {
    try {
      const [versions, records] = await Promise.all([
        DatasetRepository.availableVersions(),
        listDatasets()
      ]);
      this.availableDatasets = versions;
      this.datasetRecords = records;
    } catch (error) {
      console.warn('Unable to refresh available GTNH datasets', error);
      this.datasetRecords = await listDatasets();
    }
  }

  async install(version: DatasetVersion) {
    if (this.installingDatasetId) return;
    this.error = '';
    this.installProgress = undefined;
    this.installingDatasetId = version.datasetId;
    const controller = new AbortController();
    this.installController = controller;
    try {
      const repository = this.callbacks.getRepository();
      const state = this.datasetRecords.find((record) => record.datasetId === version.datasetId);
      const totalBytes = version.offlineBytes ?? state?.totalBytes;
      const remainingBytes = totalBytes === undefined
        ? undefined
        : Math.max(0, totalBytes - (state?.storedBytes ?? 0));
      const estimate = await estimateStorage();
      this.storageUsage = estimate.usage;
      this.storageQuota = estimate.quota;
      const shortfall = remainingBytes === undefined
        ? undefined
        : storageShortfall(remainingBytes, estimate.usage, estimate.quota);
      if (shortfall !== undefined && shortfall > 0) {
        const availableBytes = Math.max(0, estimate.quota! - estimate.usage!);
        throw new Error(
          `Not enough browser storage. ${formatBytes(remainingBytes)} is still required, `
          + `but only ${formatBytes(availableBytes)} is estimated available.`
        );
      }
      const persisted = await requestPersistentStorage();
      if (persisted !== undefined) this.persistentStorage = persisted;
      const installer = repository?.datasetId === version.datasetId
        ? repository
        : await DatasetRepository.load(version.datasetId);
      this.callbacks.validateRepository(installer);
      await installer.installOffline((progress) => {
        if (this.installingDatasetId === version.datasetId) this.installProgress = progress;
      }, controller.signal);
      if (repository?.datasetId === version.datasetId) await installer.activate();
      await this.refresh();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.error = diagnostic(error);
      }
      this.datasetRecords = await listDatasets();
    } finally {
      if (this.installingDatasetId === version.datasetId) {
        this.installingDatasetId = '';
        this.installController = null;
      }
    }
  }

  cancelInstall() {
    this.installController?.abort();
  }

  async switchDataset(version: DatasetVersion) {
    const repository = this.callbacks.getRepository();
    if (this.switchingDatasetId || version.datasetId === repository?.datasetId) return;
    this.switchingDatasetId = version.datasetId;
    this.error = '';
    try {
      const loaded = await DatasetRepository.load(version.datasetId);
      this.callbacks.validateRepository(loaded);
      await loaded.activate();
      await this.callbacks.applyRepository(loaded, true);
      this.callbacks.markReady();
      await this.refresh();
    } catch (error) {
      this.error = diagnostic(error);
    } finally {
      this.switchingDatasetId = '';
    }
  }

  async deleteDataset(state: DatasetState) {
    if (this.installingDatasetId === state.datasetId) return;
    const repository = this.callbacks.getRepository();
    const currentNote = repository?.datasetId === state.datasetId
      ? ' The currently open catalog will continue working until this page is reloaded.'
      : '';
    if (!confirm(`Delete locally stored data for GTNH ${state.gtnhVersion}?${currentNote}`)) return;
    this.error = '';
    try {
      await removeDataset(state.datasetId);
      await this.refresh();
    } catch (error) {
      this.error = diagnostic(error);
    }
  }
}
