# Exporting a GTNH dataset

There is one supported release path. It launches a fresh GTNH client directly from the reviewed archive, runs the
unattended exporter, processes the private NESQL output, builds the browser pack twice, and verifies every result.
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
npm run export:direct -- --version 2.9.0-beta-2
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
reference, the browser retention policy, deterministic pack bytes, hashes, shard limits, and sprite samples. The
sidecar digest participates in the format-4 revision. Verify a generated pack explicitly when diagnosing a run:

```sh
npm run verify-pack -- \
  --pack .export-work/2.9.0-beta-2-direct/pack \
  --atlas .export-work/2.9.0-beta-2-direct/processed/atlas.webp
```

Stage the immutable directory first:

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

Run `npm run quality` before committing the index change. The current automated release is
`2.9.0-beta-2-rc748daddaa3e`; the 2.8.0 pack remains as a small historical/benchmark dataset.

The former interactive/launcher-assisted export procedure is retired; its implementation history is preserved in
Git commits rather than duplicated in this runbook.
