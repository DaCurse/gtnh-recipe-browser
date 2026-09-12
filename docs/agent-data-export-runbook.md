# Agent runbook: direct GTNH dataset exports

Use [`exporting-current-data.md`](exporting-current-data.md) for the operator command. This file records the checks
that must remain true as new GTNH profiles are added.

## Invariants

- Keep `gtnh@ShadowTheAge/` and `nesql-exporter@ShadowTheAge/` read-only.
- Use a fresh disposable workspace below `.export-work/`; never touch a player installation.
- Keep raw NESQL output private and never weaken archive, schema, hash, determinism, sprite, or size validation.
- Add a new immutable fixture only for a genuinely new upstream data shape.
- A format-6 shared layout is persistent metadata, not a disposable optimization. Every published prefix is
  append-only: an existing prefix keeps its meaning and may gain descendants, but prefixes are never merged,
  reassigned, or rebuilt from scratch for a later dataset.
- A complete record that exceeds the target cap is allowed only as a marked `oversizedSingleton`. If the oversized
  value is a secondary index, split that index into its own record family; do not change the trie to accommodate it.
- Run `npm run quality` before committing a release.

## Profile and overlay

Each profile pins the official GTNH archive URL, size, SHA-256, and version. A future profile must be independently
verified before it is added; an existing profile must never be silently retargeted.

The maintained exporter overlay and processor patches are applied only to disposable copies. The 2.9.0-beta-2
runtime pins are:

- CropsNH 2.0.91
- GT5-Unofficial 5.09.54.20
- BloodMagic 1.9.4
- EnhancedLootBags 1.3.4
- VendingMachine 0.4.95
- NEI Custom Diagram 1.8.30
- Roguelike Dungeons 1.6.6-GTNH
- Twilight Forest 2.7.36

For GregTech ore pages, the source of truth is the embedded GTNEIOrePlugin in
GT5-Unofficial, not an old standalone checkout. Its four-layer vein model,
small-ore/drop model, dimension-display item mapping, and normalized
per-dimension vein probabilities are documented in
[`gtneioreplugin-integration.md`](gtneioreplugin-integration.md).
The corresponding icon and slot-layout anchors for world-generation loot,
VendingMachine, CropsNH, LootBags, and Meteor Rituals are kept in
[`nei-special-integrations.md`](nei-special-integrations.md).

The special adapter must emit crop output/mutation/breeding, GT vein/small-ore/processing, meteor ritual, loot-bag,
vending-trade, and worldgen-loot records. It runs before normal plugin processing so referenced goods, fluids, ore
dictionaries, tooltips, and service icons enter the existing factories. Missing categories, duplicate IDs, unknown
references, unresolved service icons, or version mismatches are fatal.

The exporter writes a sorted `browser-nei-special.json` beside the NESQL database. Its records contain pinned source
versions, stable lookup IDs, search text, category payloads, and canonical browser goods IDs. The processor must
retain every referenced goods ID and must reject a missing sidecar; there is no reduced/legacy export mode.

## Automated client and processing checks

`ExportAutomationController` creates a flat creative integrated world, waits for a populated NEI registry, grants the
static Thaumcraft research/aspects required by the export, clears warp, runs the exporter, validates the database,
image archive, and sidecar, then exits the JVM itself. Require distinct atomic launcher/controller/orchestrator
status files and an explicit controller `complete` phase.

Processing must:

1. validate the combined tooltip schema and image-path audit;
2. apply the browser retention, named-ore, and special-retention patches to a disposable processor copy;
3. decode format-v5 output and enforce the item/recipe/tool/tooltip sanity thresholds;
4. build the format-6 pack twice and compare directory digests; it requires the persistent published shared layout
   and passes the same reuse list to both builds;
5. verify all asset hashes, special shards, shard limits, and sprite samples; and
6. write provenance containing source, patch, processed-data, and deterministic-pack hashes.

If processed files are complete but a later step fails, `--resume-processed true` may resume that exact workspace
after the cause is corrected. Never resume after changing a patch or against incomplete files.

## Shared format workflow

For a format-6 release, construct the initial layout from the union of the nearby datasets, or extend the last
published layout with `--existing-layout`:

```sh
npm run shared-layout -- \
  --data <beta-2-processed-data.bin> --data <beta-3-processed-data.bin> \
  --special-data <beta-2-browser-nei-special.json> \
  --special-data <beta-3-browser-nei-special.json> \
  --output .export-work/shared-layout.json
```

Pass that layout to processing with `--layout <layout.json>`, or to the pack builder with the same option. The
processor decodes the unchanged format-v5 source export and the builder emits the canonical format-6,
dataset-independent MessagePack payloads and full-SHA object names. The raw sidecar is
consumed as an input and is not published because its records are already present in the special shards. The verifier
checks manifest membership, the full object SHA, schema/kind, logical ID, the manifest's published prefix map,
recipe type or special category, sorted record IDs, reference counts, and the singleton marker; a payload does not
need to claim a dataset ID. The publisher compares that prefix map against every already-published format-6
manifest, so a release cannot accidentally rebuild or rebalance the persistent trie.

When processing a later export, pass prior local build directories and/or published dataset directories as a
comma-separated `--reuse-packs` list. Local build directories are read from `<pack>/assets/sha256`; published
directories are read from their manifest's physical page URLs in the global `public/assets/sha256` store. The same
resolved list is passed to both deterministic builds, and only complete record pages are reused:

```sh
npm run export:process -- \
  --session .export-work/2.9.0-beta-3-direct/export-session.json \
  --work-dir .export-work/2.9.0-beta-3-direct \
  --layout tools/pack-builder/layouts/2.9.0.json \
  --reuse-packs .export-work/2.9.0-beta-2-direct/pack,public/data/2.9.0-beta-2-r<revision>
```

Do not include the output directory in its own reuse list. Reuse preserves page-level physical bytes while each
manifest remains a complete, independently selectable format-6 dataset; the logical prefix layout remains the
lineage contract and is still checked by the publisher.

The analysis command compares actual packs at record level and evaluates both persistent union hash-prefix and
record-aware CDC simulations:

```sh
npm run analyze:pack-reuse -- --left <beta-2-pack> --right <beta-3-pack> \
  --json .export-work/beta2-beta3-reuse.json \
  --markdown .export-work/beta2-beta3-reuse.md
```

Use its object counts and incremental-byte results to choose targets. CDC boundaries must remain between complete
records, but independently computed CDC layouts do not preserve a stable logical shard map across datasets; the
beta2/beta3 measurements therefore favor the persistent trie. The detailed figures and decision are recorded in
[`pack-reuse-beta-2-beta-3.md`](pack-reuse-beta-2-beta-3.md).

Existing browsers migrate on the first successful format-6 catalog load. Every
older cache row is recognized by its missing or older cache marker, not by a
beta-specific ID or manifest version. The selected replacement manifest is
loaded normally, matching SHA-keyed blobs are retained, and its new row is
written without an expanded catalog snapshot. All obsolete rows and every blob
not referenced by a current-format row are then removed, including orphaned
objects left by older bookkeeping. Because each format-6 manifest remains
complete, users do not depend on an old pack or a version-delta chain after
migration.

## Release gate

Stage the verified pack, deploy it, run `smoke:deploy --all-assets` against the deployed origin, and only then run
`export:publish --mode activate`. For format 6, staging publishes the manifest under `public/data/<dataset-id>/`
and copies each immutable object once into `public/assets/sha256/`; it does not duplicate an `assets/` tree per
dataset. Existing global objects are accepted only when their bytes match the requested SHA. The version index keeps
one revision per GTNH version and retains the 2.8.0 benchmark. After staging or activation, the publisher removes
global objects that are not referenced by any published format-6 manifest. Do not call a revision released until the
deployed-origin fetch succeeds.

The retired interactive export procedure is intentionally documented only as history in Git.
