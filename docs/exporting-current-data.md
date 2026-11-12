# Exporting a GTNH dataset

There is one supported release path. It launches a fresh GTNH client directly from the reviewed archive, runs the
unchanged format-v5 source exporter, processes the private NESQL output, builds the format-7 browser pack twice, and
verifies every result.
Both `gtnh@ShadowTheAge/` and `nesql-exporter@ShadowTheAge/` remain pinned, read-only submodules.

## Requirements

Native Windows is supported with MSYS2 `bash`, `patch`, `unzip`, Python, JDK 21,
and the .NET 8 SDK on PATH. The launcher selects Windows natives and the Windows
classpath separator automatically; Xvfb is only used on Linux. Keep Java 26 out
of this build's PATH: the pinned Gradle version runs on JDK 21.
Windows launches through `launch-hidden.ps1` by default: it hides only windows
owned by the renderer JVM, suppresses console windows, streams logs, and returns
the JVM's actual exit code. The OpenGL context still exists. Use `--windowed` for
interactive debugging. Preparation and launch both disable pause-on-lost-focus
in the disposable client's options, so Alt+Tab or hiding cannot pause automation.
The default launcher and automation timeouts are 90 minutes to accommodate the
full Windows export, including database post-processing. Both remain configurable
with the direct-export timeout options.

The current 2.9.0 profile uses the official runnable client ZIP at
`https://downloads.gtnewhorizons.com/Multi_mc_downloads/GT_New_Horizons_2.9.0_Java_17-26.zip`,
747,848,389 bytes, SHA-256 `6d0ebe7e6be18fb74b4fc920916cc5710e142a3f885072d324da05244d398b16`.
This is a newly reviewed source, distinct from the historical local assembly documented below.

The preparation/launch boundary inventories every native quest stack. The game
loads exact typed NBT using BetterQuesting's decoder, retains rewards, choices,
requirements and icons through the existing NESQL factories, and expands wildcard
metadata using the populated NEI registry. `browser-quest-items.json` records every
source path and resolved canonical goods ID. Invalid registry references are
explicitly marked unavailable instead of assigned substitute assets.
Processing checks complete request coverage and rejects any resolved item lost
by retention. The request/report digests are recorded in release provenance.

After staging the verified recipe pack and selecting it in the local version
index, build the separate quest dataset with the native resolution report:

```sh
npm run build:quests -- <modpack-checkout> <betterquesting-checkout> \
  <game-dir>/nesql/browser-export/browser-quest-items.json \
  <export-work-dir>/quest-item-requests.json \
  <export-work-dir>/processed/data.bin
```

The builder verifies the processed database and atlas against the recipe
manifest's source hashes before using raw NBT for semantic navigation and exact
quest tooltips. Published recipe shards deliberately omit most raw NBT for size.
The shared resolver and its source-backed family defaults live in
`src/lib/itemNavigation.ts`; mappings are rebuilt from export data, not maintained
as individual item aliases.

The same build generates the item-to-quest companion: shared quest preview
metadata plus 16 lazy relation buckets, bound to the exact recipe dataset.
Recipes link to reward and choice-reward quests; usages link to matching task
requirements. Matching follows each task's native NBT mode (ignored, partial,
or exact), with full typed source stacks retained during generation. Runtime
item tabs and vending requirements use these previews without downloading the
full questbook; opening a quest downloads the separately cached full pack.
Generated links and pack files no longer referenced by the quest indexes are
pruned by the builder.

Navigation button PNGs are cropped from the verified recipe sprites during this
build, with source IDs, sheet hashes and output hashes recorded in
`assets/source/navigation-icons/provenance.json`. No manually substituted item
art is needed. Run `npm run test:quest-links -- <app-url> <playwright-module>`
to check item quest tabs, vending requirements, shared mouse/touch previews,
Shift-only NBT, native OR placement and compact quest links.

The builder rejects missing inventory entries and canonical IDs absent from the
selected recipe dataset. Native wildcard alternatives and ore-group members use
the existing item renderer. Unavailable references carry a tooltip note; an empty
ore dictionary can show its valid configured base item without offering that
empty group as a chooser. The inventory rules and audit command are
documented in `docs/questbook-export-shopping-list.md`.

If preparation completed but launch preflight failed, `--prepared-session
<work-dir>/export-session.json` can retry that disposable preparation. Its archive,
version and workspace must still match, and an existing NESQL output repository
is rejected. This does not resume or overwrite an incomplete game export.

On Linux/WSL use native Node.js/npm, `bash`, `patch`, `unzip`, JDK 8, JDK 17, JDK 21, and the .NET 8 SDK. Initialize
the submodules before an export:

```sh
git submodule update --init --recursive
```

Raw NESQL output and all intermediate work stay under ignored `.export-work/`. Never point the command at an existing
player installation.

## Run

For 2.9.0, the profile in `tools/data-export/direct-export.ts` pins the official
MultiMC client URL, byte size and SHA-256. Supply the matching downloaded client
with `--archive <path>` if it is stored elsewhere. The GitHub configuration-only
ZIP is not a runnable client.

```sh
npm run export:direct -- \
  --version 2.9.0 \
  --shared-layout tools/pack-builder/layouts/2.9.0.json \
  --reuse-packs public/data/2.9.0-RC-1-v7-rbf5fd70ecad0 \
  --java /usr/lib/jvm/java-21-openjdk/bin/java
```

The profile pins the reviewed archive location, byte size, and SHA-256. A local archive can be supplied with
`--archive <file>`; it is still verified before use. The orchestrator resolves the archive's component metadata,
libraries, natives, assets, and launch arguments, starts the client under Xvfb, creates the deterministic creative
world, waits for NEI, grants static Thaumcraft state, runs the exporter, and waits for the controller's explicit
`complete` state. It then invokes processing automatically.

The client writes separate launcher, controller, and orchestrator status files under
`.export-work/direct-export-cache/status/`. A zero JVM exit is not sufficient: the controller must report completion
and processing must write `process-result.json`.

## Verify and release

Processing validates the combined tooltip schema, all ten special-data categories, every goods/ore-dictionary/icon
reference, the browser retention policy, deterministic format-7 pack bytes, hashes, shard limits, and sprite samples. The
sidecar digest participates in the generated revision, but the raw sidecar is not copied into the browser pack: its
records are already present in the shared special shards. Verify a generated pack explicitly when diagnosing a run:

```sh
npm run verify-pack -- \
  --pack .export-work/2.9.0-beta-2-direct/pack \
  --atlas .export-work/2.9.0-beta-2-direct/processed/atlas.webp \
  --data .export-work/2.9.0-beta-2-direct/processed/data.bin \
  --layout .export-work/2.9.0-beta-2-direct/shared-layout.json
```

Format-6 logical catalog, recipe, and special descriptors reconstruct from record-page segments; only record pages
and icon sheets are physical assets. A local build's physical objects are verified from its `assets/sha256/` directory. Add
`--special-data <browser-nei-special.json>` with `--data <processed-data.bin>` when you also want the verifier to check the recorded
normalized input digest, including repaired service icons and generated ore aliases.
For a staged global object store, pass `--asset-directory public/assets/sha256`.

To reuse frozen record pages from previous releases, pass a comma-separated list to processing. Build directories use
their local `assets/sha256` store; published dataset directories use the manifest and resolve pages from the global
`public/assets/sha256` store:

```sh
npm run export:process -- \
  --session .export-work/2.9.0-beta-3-direct/export-session.json \
  --work-dir .export-work/2.9.0-beta-3-direct \
  --layout tools/pack-builder/layouts/2.9.0.json \
  --reuse-packs .export-work/2.9.0-beta-2-direct/pack,public/data/2.9.0-beta-2-v7-r<revision>
```

Processing append-only extends the supplied published layout with the processed records and writes
`shared-layout.json` beside the pack. It uses that same resolved layout and reuse list for both deterministic builds. The source exporter remains format5; `--reuse-packs`
only affects format-7 record-page construction.

The canonical pack directory contains only `pack-manifest.json` and its local
`assets/sha256/` object source. Run provenance stays beside the pack in the
ignored work directory and is not part of the browser dataset. Publishing
accepts only format 7, copies only the manifest into the dataset directory, and
places immutable physical objects in the global SHA-256 store. Generated
dataset IDs include `v7`; the publisher rejects replacing a different manifest
at an existing immutable dataset URL.

Stage the immutable format-7 manifest and its physical objects first:

```sh
npm run export:publish -- \
  --pack .export-work/2.9.0-beta-2-direct/pack \
  --mode stage
```

Deploy the staged tree, verify the deployed origin before changing the index, and fetch every asset:

```sh
npm run smoke:deploy -- \
  https://dacurse.github.io/gtnh-recipe-browser/ \
  --manifest data/<dataset-id>/pack-manifest.json \
  --all-assets \
  --require-special
```

Only after that succeeds, activate the already staged bytes:

```sh
npm run export:publish -- \
  --pack .export-work/2.9.0-beta-2-direct/pack \
  --mode activate \
  --rollout-epoch <new-positive-epoch>
```

Use a rollout epoch greater than the current `versions-v7.json` epoch (RC1 uses 2; 2.9.0 final currently uses 4). It targets the
activated dataset once for returning users; subsequent deliberate version choices persist.
Run `npm run quality` before committing the index change. The 2.9.0 beta
releases and RC1 use the persistent shared layout; the 2.8.0 pack remains as a small
historical/benchmark dataset.

Staging and activation garbage-collect global SHA objects not referenced by
any published format-7 or frozen v6 bridge manifest, so replaced or abandoned builds do not remain
in the deployed object pool.

The former interactive/launcher-assisted export procedure is retired; its implementation history is preserved in
Git commits rather than duplicated in this runbook.

The publisher now generates and verifies the manifest-bound Recipe Finder chain
index before staging/activating a dataset. Existing matching, verified graph
assets are reused; changing a recipe manifest rebuilds its graph. Activation
prunes graph entries and files for retired datasets. `npm run build:chain-index`
can also rebuild/repair the indexes for every currently published version.
The quality suite checks that every published dataset has a matching graph.
