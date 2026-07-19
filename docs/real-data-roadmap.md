# Real data and icon roadmap

This is the implementation sequence for replacing `src/lib/demo.ts` with immutable GTNH datasets. Each phase has
an independently testable exit condition; client work should not depend on unpublished release assets.

## Source contract

ShadowTheAge's exporter is the source of truth and remains a read-only submodule. It emits:

- `data.bin`: gzip-compressed, little-endian format-v5 memory-mapped data.
- `atlas.webp`: an 8,192-pixel-wide lossless WebP containing 32×32 sprites.
- `RecipeType.dimensions`: eight integers in this order: item-input, fluid-input, item-output, and fluid-output
  width/height pairs.
- Recipe entries with an I/O kind, object pointer, slot index, amount, and integer percentage.
- Goods with a stable generated ID, `iconId`, tooltip HTML, production pointers, and consumption pointers.

The root builder must reject any input whose first decoded integer is not `5`.

## Phase 1 — Obtain and freeze a real fixture

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

## Phase 2 — Implement the format-v5 decoder

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

## Phase 3 — Build deterministic packs and real sprites

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

## Phase 4 — Connect the client to a real catalog

Replace direct imports from `demo.ts` with a dataset repository interface:

1. Fetch `versions.json` network-first with a cached fallback.
2. Fetch a selected pack manifest and catalog assets.
3. Verify SHA-256 before one IndexedDB transaction marks the catalog usable.
4. Initialize the search worker with the decoded catalog and its four 32-bit search-mask words.
5. Return stable entry IDs to the UI; discard worker results carrying an old dataset/request generation.
6. Resolve sprite URLs through a sheet cache. Render sheets with CSS background coordinates and
   `image-rendering: pixelated`; retain the current glyph only for an explicit missing-icon state.
7. Render tooltip HTML through a narrowly allowlisted Minecraft-format parser, never raw `innerHTML`.

Keep the demonstration dataset behind an explicit development flag so production cannot silently fall back to it.

Exit condition: a real item can be searched, displays its actual sprite and complete tooltip, and deep links
survive reload.

## Phase 5 — Load recipes and usages on demand

Catalog entries carry production/usage recipe-shard references. On item selection:

1. Determine the needed shards for the current Recipes or Usages view.
2. Read verified blobs from IndexedDB or download, hash, store, then decode them.
3. Preserve recipe-type exporter order and slot indices.
4. Feed the four declared NEI grids to the existing `RecipeGrid` renderer.
5. Add ore-dictionary alternative cycling/inspection, fluid-container behavior, crafter icons, chances, and all GT
   metadata lines.
6. Virtualize recipe cards after real-data profiling establishes the card-height strategy.

Exit condition: crafting is fixed at 3×3, shaped gaps survive, shapeless is labeled, and sampled GT machine cards
match ShadowTheAge's slot placement and values.

### Ore-dictionary compatibility TODO

The current client resolves an ore-dictionary input to its first item only. Before treating that as complete,
compare against `gtnh@ShadowTheAge/src/nei.ts` and preserve these upstream semantics:

- An ore-dictionary ingredient represents every member as an interchangeable recipe input, while retaining the
  ore-dictionary ID and slot rather than replacing it with one item ID.
- Recipe and usage lookup for an ore dictionary is the deduplicated union of every member's recipes.
- Search matching checks member items; selecting or cycling an alternative must not change the underlying recipe.
- Verify empty dictionaries, items in multiple dictionaries, duplicate recipes, selected alternatives, and the
  interaction between ore-dictionary matching and fluid-container expansion.

## Phase 6 — Complete offline dataset management

Expand the IndexedDB schema into manifests, assets, and dataset-state stores. Implement:

- Three concurrent downloads, byte progress, cancellation, three retries, and verified resume.
- Storage estimation and persistence requests before a full download.
- Atomic catalog activation, partial/complete states, stored-byte accounting, retry, and explicit deletion.
- No automatic dataset download, activation, or deletion.
- Offline, interruption, quota, corruption, and two-version switching tests.

Exit condition: an interrupted full download resumes after reload and a complete dataset works with the browser
network disabled.

## Phase 7 — Publish safely

Add two workflows:

1. A manual pack workflow that builds, verifies, and uploads immutable assets to a GitHub Release.
2. A Pages workflow that performs a deployed-origin fetch-and-persist smoke test before publishing the updated
   `versions.json`. If Release CORS fails, mirror the exact hashed files in the Pages artifact and change only
   manifest URLs.

Never update `versions.json` until all assets are remotely readable and their downloaded digests match.

## Immediate next milestone

Start with Phases 1–3 as one pull request. The recommended review artifact is a small fixture plus a generated pack,
decoder tests, deterministic-build tests, and an HTML contact sheet comparing 50 source-atlas sprites with their
repacked equivalents. That gives the client a trustworthy format before IndexedDB and download behavior grow around
it.
