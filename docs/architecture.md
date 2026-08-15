# Application Architecture

The browser is organized around feature-owned state and a small application coordinator.

## Runtime layers

`src/App.svelte` owns startup, URL/history synchronization, the selected catalog entry, and wiring between features. It should not implement search workers, recipe loading, or dataset-manager workflows.

Feature views live in `src/lib/*.svelte`:

- `CatalogPane.svelte` owns catalog search, incremental result paging, tooltips, and sidebar resizing.
- `RecipeBrowser.svelte` renders tabs, filters, loading progress, bounded recipe pages, and recipe cards.
- `DatasetManager.svelte` renders local dataset installation and switching.

Stateful feature workflows use Svelte 5 rune modules:

- `recipeBrowserState.svelte.ts` owns progressive shard requests, stale-request cancellation, and the recipe-search worker.
- `datasetManagerState.svelte.ts` owns installation, quota checks, switching, deletion, and storage reporting.

## Dataset boundary

`DatasetRepository` is the public client-data facade. Its supporting modules have narrower contracts:

- `datasetSchema.ts` defines immutable manifest and MessagePack wire shapes.
- `datasetAssets.ts` performs verified network/cache reads and decompression.
- `storage.ts` owns versioned IndexedDB records for verified blobs and decoded catalog snapshots.
- `catalogMaterialization.ts` builds (and serializes/restores) searchable items, ore dictionaries, and machine capabilities.
- `recipeMaterialization.ts` converts packed recipes into display-domain recipes.

The service worker precaches only the application shell. Immutable dataset bytes,
on-demand icon sheets, and the decoded catalog snapshot stay in IndexedDB so
dataset deletion and storage accounting remain explicit. Recipe shards remain
lazy and are decoded only when a tab needs them.

UI code should depend on `DatasetRepository` and `types.ts`, not packed wire interfaces. Pack-generation code under `tools/` remains independent from browser storage and UI modules.

## Maintenance rules

- Keep worker lifecycle and cancellation with the feature that consumes the worker.
- Prefer a new focused module when a file begins owning unrelated UI, storage, routing, and transformation behavior.
- Preserve raw exporter fields even when the current UI does not display them.
- Never import from generated `public/data/` assets or the read-only upstream submodule.
- Move reusable test builders to `tests/support/`; keep immutable compatibility data in `tests/fixtures/`.

Run `npm run quality` before committing. `npm run deadcode` must remain clean; configure genuine dynamic entry points explicitly instead of broadly ignoring source directories.
