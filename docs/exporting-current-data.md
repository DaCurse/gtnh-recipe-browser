# Exporting a GTNH dataset

There is one supported release path. It launches a fresh GTNH client directly from the reviewed archive, runs the
unchanged format-v5 source exporter, processes the private NESQL output, builds the format-6 browser pack twice, and
verifies every result.
Both `gtnh@ShadowTheAge/` and `nesql-exporter@ShadowTheAge/` remain pinned, read-only submodules.

## Requirements

Use native WSL tools: Node.js/npm, `bash`, `patch`, `unzip`, JDK 8, JDK 17, JDK 21, and the .NET 8 SDK. Initialize
the submodules before an export:

```sh
git submodule update --init --recursive
```

Raw NESQL output and all intermediate work stay under ignored `.export-work/`. Never point the command at an existing
player installation.

## Run

```sh
npm run export:direct -- \
  --version 2.9.0-beta-2 \
  --shared-layout tools/pack-builder/layouts/2.9.0.json
```

The profile pins the official archive URL, byte size, and SHA-256. A local archive can be supplied with
`--archive <file>`; it is still verified before use. The orchestrator resolves the archive's component metadata,
libraries, natives, assets, and launch arguments, starts the client under Xvfb, creates the deterministic creative
world, waits for NEI, grants static Thaumcraft state, runs the exporter, and waits for the controller's explicit
`complete` state. It then invokes processing automatically.

The client writes separate launcher, controller, and orchestrator status files under
`.export-work/direct-export-cache/status/`. A zero JVM exit is not sufficient: the controller must report completion
and processing must write `process-result.json`.

## Verify and release

Processing validates the combined tooltip schema, all ten special-data categories, every goods/ore-dictionary/icon
reference, the browser retention policy, deterministic format-6 pack bytes, hashes, shard limits, and sprite samples. The
sidecar digest participates in the generated revision, but the raw sidecar is not copied into the browser pack: its
records are already present in the shared special shards. Verify a generated pack explicitly when diagnosing a run:

```sh
npm run verify-pack -- \
  --pack .export-work/2.9.0-beta-2-direct/pack \
  --atlas .export-work/2.9.0-beta-2-direct/processed/atlas.webp
```

Format-6 logical catalog, recipe, and special descriptors reconstruct from record-page segments; only record pages
and icon sheets are physical assets. A local build's physical objects are verified from its `assets/sha256/` directory. Add
`--special-data <browser-nei-special.json>` when you also want the verifier to check the recorded input digest.
For a staged global object store, pass `--asset-directory public/assets/sha256`.

To reuse frozen record pages from previous releases, pass a comma-separated list to processing. Build directories use
their local `assets/sha256` store; published dataset directories use the manifest and resolve pages from the global
`public/assets/sha256` store:

```sh
npm run export:process -- \
  --session .export-work/2.9.0-beta-3-direct/export-session.json \
  --work-dir .export-work/2.9.0-beta-3-direct \
  --layout tools/pack-builder/layouts/2.9.0.json \
  --reuse-packs .export-work/2.9.0-beta-2-direct/pack,public/data/2.9.0-beta-2-r<revision>
```

The reuse list is applied identically to both deterministic builds. The source exporter remains format5; `--reuse-packs`
only affects format-6 record-page construction.

The canonical pack directory contains only `pack-manifest.json` and its local
`assets/sha256/` object source. Run provenance stays beside the pack in the
ignored work directory and is not part of the browser dataset. Publishing
accepts only format 6, copies only the manifest into the dataset directory, and
places immutable physical objects in the global SHA-256 store.

Stage the immutable format-6 manifest and its physical objects first:

```sh
npm run export:publish -- \
  --pack .export-work/2.9.0-beta-2-direct/pack \
  --mode stage
```

Deploy the staged tree, verify the deployed origin before changing the index, and fetch every asset:

```sh
npm run smoke:deploy -- \
  https://<site>.netlify.app/ \
  --manifest data/<dataset-id>/pack-manifest.json \
  --all-assets \
  --require-special
```

Only after that succeeds, activate the already staged bytes:

```sh
npm run export:publish -- \
  --pack .export-work/2.9.0-beta-2-direct/pack \
  --mode activate
```

Run `npm run quality` before committing the index change. The 2.9.0 beta
releases use the persistent shared layout; the 2.8.0 pack remains as a small
historical/benchmark dataset.

Staging and activation garbage-collect global SHA objects not referenced by
any published format-6 manifest, so replaced or abandoned builds do not remain
in the deployed object pool.

The former interactive/launcher-assisted export procedure is retired; its implementation history is preserved in
Git commits rather than duplicated in this runbook.
