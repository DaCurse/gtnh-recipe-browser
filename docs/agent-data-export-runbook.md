# Agent runbook: direct GTNH dataset exports

Use [`exporting-current-data.md`](exporting-current-data.md) for the operator command. This file records the checks
that must remain true as new GTNH profiles are added.

## Invariants

- Keep `gtnh@ShadowTheAge/` and `nesql-exporter@ShadowTheAge/` read-only.
- Use a fresh disposable workspace below `.export-work/`; never touch a player installation.
- Keep raw NESQL output private and never weaken archive, schema, hash, determinism, sprite, or size validation.
- Add a new immutable fixture only for a genuinely new upstream data shape.
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
4. build the format-4 pack twice and compare directory digests;
5. verify all asset hashes, special shards, shard limits, and sprite samples; and
6. write provenance containing source, patch, processed-data, and deterministic-pack hashes.

If processed files are complete but a later step fails, `--resume-processed true` may resume that exact workspace
after the cause is corrected. Never resume after changing a patch or against incomplete files.

## Release gate

Stage the verified pack, deploy it, run `smoke:deploy --all-assets` against the deployed origin, and only then run
`export:publish --mode activate`. The version index keeps one revision per GTNH version and retains the 2.8.0
benchmark. Do not call a revision released until the deployed-origin fetch succeeds.

The retired interactive export procedure is intentionally documented only as history in Git.
