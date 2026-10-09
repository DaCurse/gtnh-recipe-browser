# GTNH Recipe Browser

A touch-friendly, offline-capable Svelte browser for GregTech: New Horizons items, recipes, and usages.

## Development

```sh
npm install
npm run dev
```

Run the complete lint, dead-code, type, test, and production-build suite with:

```sh
npm run quality
```

The runtime module boundaries and maintenance rules are documented in
[`docs/architecture.md`](docs/architecture.md).

The application loads the real GTNH dataset indexed by `public/versions-v7.json`. Catalog, recipe, and icon assets
are immutable and content-hashed. First startup loads browse/search bootstrap pages; refreshes restore a prepared catalog from IndexedDB.
Search indexes are loaded or built only after entering a query, and validated decoded shards are retained for later refreshes; item details, ingredient groups,
recipes, and special data are hydrated on demand. The client verifies every physical page before caching it in
IndexedDB. The dataset manager can install every immutable chunk with resumable progress, switch retained versions,
and explicitly delete local copies. Dataset loading failures are shown instead of substituting placeholder entries.

Optional browser checks use an externally installed Playwright module:

```sh
npm run profile:incremental -- http://localhost:4173 <pack-dir> <playwright-module> 4
npm run test:cached-startup -- http://localhost:4173 <playwright-module>
```

The profile compares cold and warm mobile browsing under an optional CPU throttle. The cache check covers
stalled metadata requests, offline refreshes, saved searches, repeated queries, and cached item bookmarks with
the production service worker. See [`docs/cached-startup-performance.md`](docs/cached-startup-performance.md).

## Deployment

Netlify deployment settings are committed in `netlify.toml`: the production branch is `master`, the repository root
is the base directory, `npm run build` is the build command, and `dist` is the publish directory. Node.js 22 is
pinned in the configuration and the application requires no secrets or runtime environment variables.

After a production deploy, verify the live version index and representative catalog, recipe, and icon assets by byte
size and SHA-256:

```sh
npm run smoke:deploy -- https://<site>.netlify.app/
```

The default-origin smoke requires the active special-data release; pass an explicit historical manifest when checking
the 2.8.0 benchmark.

## Data pipeline

`gtnh@ShadowTheAge` and `nesql-exporter@ShadowTheAge` are read-only MIT-licensed upstream submodules. The
reproducible release workflow directly launches a disposable client from the official archive, processes its private NESQL output twice,
verifies the unchanged format-v5 source and deterministic format-7 shared browser pack, and publishes one revision per GTNH version. The disposable processor applies the documented
[`browser catalog retention policy`](docs/browser-catalog-policy.md) so valid tools and configurable variants
filtered from the upstream production calculator remain browseable.

Run the pinned unattended client export and processing pipeline against a fresh client workspace:

```sh
npm run export:direct -- \
  --version 2.9.0-beta-2 \
  --shared-layout tools/pack-builder/layouts/2.9.0.json
```

See [`docs/exporting-current-data.md`](docs/exporting-current-data.md) for
toolchain, status, verification, staging, and activation details.

Build and verify an already processed deterministic chunked pack with:

```sh
npm run pack -- \
  --data tests/fixtures/shadowtheage-v5-2.8.0/data.bin \
  --atlas tests/fixtures/shadowtheage-v5-2.8.0/atlas.webp \
  --gtnh-version 2.8.0 \
  --revision 6d351536 \
  --output .pack-output/2.8.0-v7-r6d351536 \
  --layout tools/pack-builder/layouts/2.9.0.json

npm run verify-pack -- \
  --pack .pack-output/2.8.0-v7-r6d351536 \
  --atlas tests/fixtures/shadowtheage-v5-2.8.0/atlas.webp
```

The source NESQL export remains private. Processed compatibility fixtures are immutable and versioned separately;
add a sibling fixture when supporting a new upstream shape.

Browser packs use format 7: complete manifests select immutable shared record
pages and sprite sheets. For a nearby version, pass `--reuse-packs <pack-a>,<pack-b>`
to `pack` so unchanged records retain their existing physical pages. This is
build-time reuse, not a runtime dependency on another version. Storage accounting
can be reproduced with `npm run analyze:storage -- <pack-a> <pack-b>`.

`tests/fixtures/shadowtheage-v5-2.8.0/` is the pinned, network-independent compatibility source for decoder and
recipe-parity tests. The current format-7 release is indexed by
`public/versions-v7.json`: `public/data/2.9.0-beta-2-v7-r7fdce46a5a5a/` and
`public/data/2.9.0-beta-3-v7-r131dafd54f93/`; the immutable 2.8.0 pack remains
available as a benchmark and historical version.

Dataset URLs include the pack format, and the publisher never replaces an immutable dataset URL with bytes from
another pack format. `public/versions.json` and its v6 manifests are frozen as a returning-PWA bridge.
Old shells continue using v6 until the service worker updates them. New shells read only `versions-v7.json`
and migrate same-version cache rows after v7 bootstrap loads successfully.

## Assets and attribution

- Upstream exporter/browser: ShadowTheAge, MIT; see `gtnh@ShadowTheAge/LICENSE`.
- The bundled [Minecraft font](https://www.fontspace.com/minecraft-font-f28180) archive declares the font Public
  Domain. The supplied inventory-slot artwork remains subject to its owner's terms and is not covered by this
  repository's source-code license.

However, the project contains some assets from Minecraft (Mojang trademark and copyright), the GTNH development
team, and respective mod authors. These assets are used under fair use.
