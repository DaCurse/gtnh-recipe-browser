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
- `storage.ts` owns versioned IndexedDB records for verified blobs and a lightweight size index.
- `preparedCatalogCache.ts` persists CPU-ready catalogs and search documents as bounded JSON chunks.
- `catalogMaterialization.ts` projects lightweight goods and group stubs for browse/search.
- `packedRelations.ts` interns repeated relation lists; `recordPages.ts` reconstructs complete logical assets.
- `recipeMaterialization.ts` converts packed recipes into display-domain recipes.
- `specialData.ts` defines and normalizes the discriminated display records
  used by the special cards and ore-processing graph.

GregTech ore special pages follow the embedded GTNEIOrePlugin in
GT5-Unofficial. See [`gtneioreplugin-integration.md`](gtneioreplugin-integration.md)
for the reusable handler/helper map, dimension-display IDs, and probability
semantics; future GT ore or dimension-stat requests should start there.
For the other NEI special categories, use the handler/icon anchors in
[`nei-special-integrations.md`](nei-special-integrations.md).

The service worker precaches only the application shell. Immutable dataset bytes,
and on-demand icon sheets stay in IndexedDB so
dataset deletion and storage accounting remain explicit. Recipe shards remain
lazy and are decoded only when a tab needs them.

Canonical catalogs declare `specialViewTypes`. Goods reference
production and usage special shards separately, using the same Recipes/Usages
direction as normal recipes. `DatasetRepository` is still the only component
which reads those immutable shards. Special tabs therefore share verified asset
loading, request cancellation, offline accounting, and dataset deletion without
exposing packed wire records to Svelte components. Service icons referenced only
by special views are retained in the catalog but remain non-searchable.

Format 7 is the canonical shared-data pack path. A dataset manifest remains complete and
independently selectable, but its asset descriptors can point at immutable,
full-SHA-256-named objects in the global `assets/sha256/` store. Reusable payloads
carry schema/kind and stable logical-shard metadata rather than a dataset owner;
membership in the manifest, the object SHA, and runtime schema checks provide
ownership and integrity. A logical shard ID is separate from its current content
hash. Logical shards select runs of complete encoded records from immutable
4-MiB record pages. Pages are gzip-compressed MessagePack arrays of binary
record values. Manifest selectors are base64 unsigned-varint triples. A later build reuses existing
record locations and writes new records into new pages; its manifest lists every physical page it needs.
Bootstrap-only compaction may replace pages containing superseded records to meet the startup budget;
the predecessor pages remain immutable and unrelated fully referenced pages are retained.
It never needs another dataset's manifest, a patch chain, or a base dataset.
Deleted records are omitted by the selectors; unused bytes in a retained page
are the bounded tradeoff for keeping object counts and requests practical.
Both physical page hashes and reconstructed logical-shard hashes are verified.
`part` and ordering fields are presentation metadata, not semantic identity.

Recipes are partitioned inside stable recipe-type namespaces. Goods and special
records use the same deterministic prefix routing where it is useful, while
icons deduplicate canonical RGBA pixels into frozen WebP sheets. The catalog
maps an owner to a sheet SHA and cell; changed pixels receive new cells in new
sheets without invalidating unchanged sprites. The shared layout is a persistent
union hash-prefix trie: every published prefix is append-only. Existing prefixes
retain their meaning forever; later datasets may keep a prefix or add descendants
to it, but may never merge, reassign, or rebuild published prefixes because a
later dataset is smaller or differently distributed. A partition containing one
record that is still above the byte target is explicitly marked as an
`oversizedSingleton` and remains above the cap. If the payload is a large
secondary index, model that index as a separate record family instead; never
distort the trie to hide the exception. See
[`pack-reuse-beta-2-beta-3.md`](pack-reuse-beta-2-beta-3.md) for the measured
comparison with record-aware CDC. Format-7 manifests carry the compact prefix
map and its fingerprint; publishing compares it with every existing format-7
manifest and rejects removal, reassignment, or a changed target cap.

The browser cache is already physical and SHA-keyed. Installing two manifests
stores one copy of an identical object; dataset state records which hashes each
dataset references, and deletion removes only hashes no other dataset references.
Offline progress and the manager report both logical dataset totals and physical
cache bytes, so shared objects are not counted twice. Startup favors CPU and latency over minimum disk usage. In addition to verified
compressed pages and sheets, IndexedDB stores prepared catalog entries and variant
grouping, normalized search documents, and decoded lazy shards in `runtime-cache`.
Prepared catalogs and search documents use small UTF-8 JSON buffers to avoid blocking
native structured-clone operations and browser per-record size limits. A final header
commits each complete projection; missing chunks fall back to verified source data.
The prepared catalog key includes an application projection version, manifest SHA,
and resolved manifest URL, so a changed projection, dataset revision, or asset base
cannot reuse stale display data. These disposable caches can be rebuilt from verified
source bytes. Search data is read or built progressively only on the first query;
blank browsing uses the already sorted catalog and renders 60 tiles per batch.
Lazy shards are cached only after selection and validation. Dataset deletion removes
its projections along with its source references. Quota failures leave browsing usable.
Browser storage usage includes these projections; immutable-object accounting and
offline download estimates describe source assets only. A lightweight size index
avoids reading binary data to display source usage. Decoded pages also remain in bounded memory.

Cached startups give version-index revalidation 150 ms before using saved metadata,
while immutable manifest revalidation runs in the background without delaying
browsing. The shell update check is likewise bounded to 150 ms; a later activating
worker still performs takeover. Current shells announce readiness before catalog work
so a busy slow-device client is not mistaken for a legacy window. Fresh metadata is saved for subsequent startup
and availability checks. Offline or stalled-network refreshes retain their selected
catalog and do not wait for a network timeout.

When switching versions, the active repository lends the replacement any
lazy detail, group, recipe, or special shard promises whose SHA and
logical identity match. The replacement validates them against its own
manifest and catalog, so this is an in-memory acceleration rather than a
cross-version dependency. The switch loads the target manifest and catalog,
then leaves recipe and special shards lazy; only target data that is not already
cached or loaded is read.
After the target manifest is known, its dataset row also adopts any matching
hashes already present in the physical cache. That keeps shared blobs owned by
both manifests during later deletion and lets an offline install skip them in
one indexed lookup rather than probing every descriptor separately.

Format-7 bootstrap contains core metadata, browse goods with icon references and tooltip-text references,
recipe types, and special-category metadata. It never selects detail, group, recipe, or special pages.
Physical record reuse is scoped by load family: bootstrap, goods-details, ingredient-groups, recipes, special.
Detail/group partitions additionally isolate reuse within their logical partition to bound selection fan-out.

`DatasetRepository.entryFor(id, signal)` hydrates and memoizes one detail partition. The application overlays
that immutable result on the lightweight selected entry and cancels stale navigation. Recipe and special
loaders call this boundary themselves. Recipe batches hydrate the matching-side ingredient groups before filtering, then load presentation
groups only for matching recipes. Production fallbacks reference their effective ore dictionary instead
of duplicating its membership in every goods row; that group loads when recipes or special results need it.
Matching scopes, shard relationships, and machine capabilities are computed at build time. Special tabs
use precomputed per-category lookup counts; full handler lookup IDs remain in lazy special records.
Tooltip text is stored once in bootstrap, with lazy formatting spans restoring the selected tooltip losslessly.
Unused exporter numeric IDs and unlocalized names are not published. Ordinary NBT is represented by a stable
variant fingerprint; CropsNH state remains in browse records because seed variants require it before selection.

The new shell reads only `versions-v7.json`. The existing `versions.json` and v6 public manifests are
frozen for old PWA shells. The generated worker imports a takeover hook that navigates legacy windows
after successful shell activation, preserving their URLs even when catalog loading is stalled. Current shells
answer its probe and reload once on controller replacement. Startup registers and checks the worker before
loading data, with a 150-millisecond startup budget for unavailable update servers. Canonical build, verification,
and publication are v7-only. Cache bookkeeping version 3 migrates same-semantic-version obsolete rows
only after successful bootstrap load, retaining shared hashes and pruning only those rows' unreferenced blobs.
Each v7 manifest remains independently selectable. Prepared catalogs and decoded lazy shards are cached
per dataset; identical immutable downloads remain shared by hash. The detail pane mounts immediately on
selection, displaying its tabs and loading indicator while details hydrate and recipe search initializes.

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

The optional v7 index `rollout` policy carries a positive integer `epoch` and a published `targetDatasetId`.
Startup treats a URL repeating the saved active dataset as saved state and applies an unacknowledged epoch once.
Other explicit supported links and manager selections remain deliberate choices. Successful activation records
its epoch in IndexedDB metadata; a failed target load leaves it pending. If a usable active v7 dataset exists,
startup falls back to it while the rollout target is unavailable. Legacy cache rows and frozen bridge links are
resolved to published semantic-version replacements before any manifest fetch. No v6 manifest is selectable.
