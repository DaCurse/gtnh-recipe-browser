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
- `specialData.ts` defines and normalizes the discriminated display records
  used by the special cards and ore-processing graph.

GregTech ore special pages follow the embedded GTNEIOrePlugin in
GT5-Unofficial. See [`gtneioreplugin-integration.md`](gtneioreplugin-integration.md)
for the reusable handler/helper map, dimension-display IDs, and probability
semantics; future GT ore or dimension-stat requests should start there.

The service worker precaches only the application shell. Immutable dataset bytes,
on-demand icon sheets, and the decoded catalog snapshot stay in IndexedDB so
dataset deletion and storage accounting remain explicit. Recipe shards remain
lazy and are decoded only when a tab needs them.

Format-4 catalogs additionally declare `specialViewTypes`. Goods reference
production and usage special shards separately, using the same Recipes/Usages
direction as normal recipes. `DatasetRepository` is still the only component
which reads those immutable shards. Special tabs therefore share verified asset
loading, request cancellation, offline accounting, and dataset deletion without
exposing packed wire records to Svelte components. Service icons referenced only
by special views are retained in the catalog but remain non-searchable.

Special records are semantic data, not exported screenshots. In particular, the
GT ore-processing view lays out typed nodes and edges in the browser. Its layout
module is UI-independent so rank assignment, box separation, branch depth, and
orthogonal connector routing can be tested without mounting Svelte.

UI code should depend on `DatasetRepository` and `types.ts`, not packed wire interfaces. Pack-generation code under `tools/` remains independent from browser storage and UI modules.

## Export runtime boundary

`tools/data-export/direct-runtime.ts` resolves the ordered MultiMC component
metadata embedded in an official GTNH archive into a direct JVM launch: verified
libraries, the platform-native classifier, assets, natives, JVM arguments, game
arguments, and main class. It does not depend on a locally installed launcher.
The reviewed version profile pins only the official archive URL, byte size, and
SHA-256; runtime components continue to come from that signed-off archive shape.

`direct-export.ts` composes archive verification, disposable exporter
preparation, headless client launch, in-client automation, and deterministic pack
processing. The JVM launcher and the in-client controller write distinct atomic
status files. The orchestrator requires both a successful JVM exit and an
explicit `complete` controller phase, preventing a legacy Forge bootstrap error
with exit code zero from being accepted as an export.

The exporter overlay remains source-controlled outside both read-only
submodules. `RuntimeSpecialAdapter.java` reads the pinned live mod registries;
`ExportAutomationController.java` creates a disposable integrated world and
starts NESQL only after the client player and NEI item registry are ready.

## Maintenance rules

- Keep worker lifecycle and cancellation with the feature that consumes the worker.
- Prefer a new focused module when a file begins owning unrelated UI, storage, routing, and transformation behavior.
- Preserve raw exporter fields even when the current UI does not display them.
- Never import from generated `public/data/` assets or the read-only upstream submodule.
- Move reusable test builders to `tests/support/`; keep immutable compatibility data in `tests/fixtures/`.

Run `npm run quality` before committing. `npm run deadcode` must remain clean; configure genuine dynamic entry points explicitly instead of broadly ignoring source directories.
