# Real data and icon roadmap

This tracks the immutable GTNH data implementation. Phases 1–5 are implemented and covered by the pinned
format-v5 fixture. Phase 6 is implemented in the client and awaits its final browser-level offline acceptance run.
Client work must remain independent of mutable upstream revisions and unpublished remote assets.

## Source contract

ShadowTheAge's exporter is the source of truth and remains a read-only submodule. It emits:

- `data.bin`: gzip-compressed, little-endian format-v5 memory-mapped data.
- `atlas.webp`: an 8,192-pixel-wide lossless WebP containing 32×32 sprites.
- `RecipeType.dimensions`: eight integers in this order: item-input, fluid-input, item-output, and fluid-output
  width/height pairs.
- Recipe entries with an I/O kind, object pointer, slot index, amount, and integer percentage.
- Goods with a stable generated ID, `iconId`, tooltip HTML, production pointers, and consumption pointers.

The root builder must reject any input whose first decoded integer is not `5`.

## Phase 1 — Obtain and freeze a real fixture (complete)

1. Build `ShadowTheAge/nesql-exporter` against the selected GTNH release.
2. Run it from a real installation to produce the `.minecraft/nesql` directory.
3. Run the upstream processor:

   ```sh
   dotnet run --project gtnh@ShadowTheAge/export/export.csproj \
     <nesql-directory> --output <raw-output-directory>
   ```

4. Keep the private NESQL source export outside Git. Store immutable processed compatibility fixtures in versioned
   `tests/fixtures/` directories, with provenance and rights notices. Never replace an older supported fixture when
   a new upstream data shape is added.
5. Record the GTNH version, exporter commit, upstream processor commit, Java version, and SHA-256 digests in a
   sidecar provenance file.

Exit condition: `data.bin` opens in ShadowTheAge's browser and the fixture includes crafting, an ore-dictionary
input, fluids, a GT machine with metadata, and an item with multiple usages.

Completed in `tests/fixtures/shadowtheage-v5-2.8.0/`, including provenance and immutable source hashes.

## Phase 2 — Implement the format-v5 decoder (complete)

Create `tools/pack-builder/` as a Node TypeScript CLI. Decode the gzip payload using the same offsets documented
by `gtnh@ShadowTheAge/src/repository.ts`; do not import or mutate upstream browser code.

Decoder output should use stable string IDs immediately. It must preserve:

- Items, fluids, ore dictionaries, containers, tooltips, NBT/debug information, search masks, and icon IDs.
- Recipe types in exporter order, all eight grid dimensions, `shapeless`, crafters, and categories.
- Recipe I/O kind, stable goods ID, slot, amount, probability, and production/consumption direction.
- Voltage, duration ticks, amperage, tier, circuit conflicts, special value, and arbitrary metadata.
- Obsolete recipe remaps.

Exit condition: decoder tests cover malformed gzip, unsupported format, invalid pointers, truncated slices, and
representative equality checks against ShadowTheAge.

The decoder preserves reachable hidden goods, containers, ore dictionaries, all recipe grids and slots, GT
metadata, crafters, search masks, and obsolete recipe remaps.

## Phase 3 — Build deterministic packs and real sprites (complete)

Add a CLI resembling:

```sh
npm run pack -- \
  --data <raw-output>/data.bin \
  --atlas <raw-output>/atlas.webp \
  --gtnh-version 2.7.3 \
  --revision 1 \
  --output .pack-output/2.7.3-r1
```

The builder will:

1. Sort stable-ID keyed records and serialize the catalog with MessagePack.
2. Group recipes by recipe type, then split large groups near 2 MiB compressed without splitting a recipe.
3. Repack atlas sprites into lossless 1,024-sprite sheets arranged 32×32. For an upstream `iconId`, read the
   source at `(iconId & 255) × 32`, `(iconId >> 8) × 32`; write it to sheet `floor(iconId / 1024)` at
   `(iconId % 32) × 32`, `floor((iconId % 1024) / 32) × 32`.
4. Use deterministic gzip settings, hash every final byte sequence with SHA-256, and rename assets with a digest
   suffix.
5. Emit a manifest only after every referenced asset has been written and re-read successfully.

Use `@msgpack/msgpack` for records and `sharp` for WebP cropping/repacking unless fixture benchmarks show that a
small .NET companion is materially faster.

Exit condition: two builds from the same input are byte-identical; every digest verifies; no recipe shard
exceeds the agreed cap except a documented single-recipe exception; sampled sprites match the upstream atlas.

The published local pack uses verified MessagePack recipe shards and lossless 1,024-icon WebP sheets with
content-hashed filenames.

## Phase 4 — Connect the client to a real catalog (complete)

Replace direct imports from `demo.ts` with a dataset repository interface:

1. Fetch `versions.json` network-first with a cached fallback.
2. Fetch a selected pack manifest and catalog assets.
3. Verify SHA-256 before one IndexedDB transaction marks the catalog usable.
4. Initialize the cancellable search worker with normalized catalog records.
5. Return stable entry IDs to the UI; discard worker results carrying an old dataset/request generation.
6. Resolve sprite URLs through a sheet cache. Render sheets with CSS background coordinates and
   `image-rendering: pixelated`; retain the current glyph only for an explicit missing-icon state.
7. Convert upstream tooltip HTML to safe plain text; never render raw `innerHTML`.

Exit condition: a real item can be searched, displays its actual sprite and complete tooltip, and deep links
survive reload.

The production client now rejects catalog failures explicitly, keeps query-based deep links stable, and reuses
verified IndexedDB assets across in-app navigation and reloads.

## Phase 5 — Load recipes and usages on demand (complete)

Catalog entries carry production/usage recipe-shard references. On item selection:

1. Determine the needed shards for the current Recipes or Usages view.
2. Read verified blobs from IndexedDB or download, hash, store, then decode them.
3. Preserve recipe-type exporter order and slot indices.
4. Feed the four declared NEI grids to the existing `RecipeGrid` renderer.
5. Add ore-dictionary alternative cycling/inspection, fluid-container behavior, crafter icons, chances, and all GT
   metadata lines.
6. Stream matching results after each shard with bounded decode concurrency and stale-request cancellation.
7. Keep recipe rendering to a fixed 20-card page so large collections never accumulate an unbounded DOM.

Exit condition: crafting is fixed at 3×3, shaped gaps survive, shapeless is labeled, and sampled GT machine cards
match ShadowTheAge's slot placement and values.

Current progress:

- Recipes and usages load only referenced, verified shards and appear progressively with chunk progress.
- Exporter-order NEI grids preserve crafting gaps, item/fluid directions, service-slot bounds, and output chances.
- GT singleblocks select the recipe voltage tier; multiblocks and tabs retain default crafter icons.
- Duration, voltage, amperage, EU, EU/t, fuel, heat, fusion, glass, and conflict metadata follow upstream semantics.
- Fluid and filled-container selections union the same production/consumption lists as ShadowTheAge while retaining
  empty-container and fluid-amount metadata.
- Recipe filtering, machine tabs, ore-dictionary navigation, and cancellation remain available with bounded cards.
- `tests/pinned-parity.test.ts` covers crafting, machines, multiblocks, fluids, containers, metadata, service slots,
  chances, and the real 2,254-recipe Charcoal collection without network access.

The client also preserves multiline Minecraft tooltip formatting and colors. Crafter entries expose a third,
tier-aware Machine Usages view; ore-equivalent machines inherit the same categories, including every
`craftingTableWood` member. Clicking a recipe crafter opens the exporter-ordered singleblock/multiblock category.

Cross-engine/touch parity and continued profiling on representative phones remain ongoing release checks rather
than pack-format work.

### Ore-dictionary compatibility

The client retains ore-dictionary IDs, slots, and complete member lists. Recipe icons use a shared, slower cycle
for readability. Tapping one opens a mobile-friendly chooser for the displayed item or the complete dictionary,
with Recipes and Usages available for either. Dictionary views load the deduplicated union of member shards, and
item usage matching recognizes ore-dictionary membership. Tests cover member matching and overlapping/disjoint
dictionaries.

Remaining compatibility work: exercise empty dictionaries when a future immutable fixture contains one.

## Phase 6 — Complete offline dataset management (browser acceptance pending)

Expand the IndexedDB schema into manifests, assets, and dataset-state stores. Implement:

- Three concurrent downloads, byte progress, cancellation, three retries, and verified resume.
- Storage estimation and persistence requests before a full download.
- Atomic catalog activation, partial/complete states, stored-byte accounting, retry, and explicit deletion.
- No automatic dataset download, activation, or deletion.
- Offline, interruption, quota, corruption, and two-version switching tests.

Exit condition: an interrupted full download resumes after reload and a complete dataset works with the browser
network disabled.

Implemented:

- Dataset records persist catalog, partial, and complete state, verified asset hashes, byte totals, and active
  identity.
- Full installs use three concurrent downloads, SHA-256 verification, three attempts, cancellation, and resume.
- The manager checks quota, requests persistent storage, reports byte/chunk progress, switches only after catalog
  validation, and explicitly deletes unshared local assets.
- Installed icon sheets resolve from IndexedDB object URLs; catalogs and recipe shards already use verified local
  blobs.
- Deterministic tests cover retries, cancellation, resume, quota decisions, corruption, two-version activation,
  and shared-asset-safe deletion using a local IndexedDB implementation.

Remaining acceptance check: run an interrupted install/reload/resume and a network-disabled complete dataset in
current Chromium, Firefox, and WebKit on desktop and mobile-sized viewports.

## Phase 7 — Publish safely

Add two publishing safeguards:

1. A manual pack workflow that builds and verifies immutable assets before adding them under `public/data/`.
2. A Netlify deployed-origin fetch-and-persist smoke test before publishing the updated `versions.json`. Dataset
   assets and their version index deploy atomically from the same site, avoiding cross-origin storage dependencies.

Never update `versions.json` until all assets are remotely readable and their downloaded digests match.

Implemented:

- The pinned NESQL exporter is built from a patched disposable copy; both upstream submodules remain read-only.
- Preparation verifies the official GTNH archive and creates a separate Prism export instance with BugTorch disabled.
- Processing validates tooltip compatibility, builds twice, compares deterministic digests, and verifies every asset.
- Publishing stages the immutable pack before atomically prepending its version entry while retaining older datasets.

## Immediate next milestone

Finish the manual NESQL export for GTNH 2.9.0-beta-2, process and publish its verified immutable pack, then run the
Netlify deployed-origin fetch/persist smoke test. Follow with the remaining Phase 6 cross-browser offline acceptance
run. No recipe, icon, or catalog format change is required.
