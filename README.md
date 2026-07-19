# GTNH Recipe Browser

A touch-friendly, offline-capable Svelte browser for GregTech: New Horizons items, recipes, and usages.

## Development

```sh
npm install
npm run dev
```

Build and test with `npm run build`, `npm run check`, and `npm test`.

The application loads the real GTNH dataset indexed by `public/versions.json`. Catalog, recipe, and icon assets
are immutable and content-hashed. The client verifies them before caching catalogs and on-demand recipe shards in
IndexedDB. The dataset manager can install every immutable chunk with resumable progress, switch retained versions,
and explicitly delete local copies. Dataset loading failures are shown instead of substituting placeholder entries.

## Deployment

Netlify deployment settings are committed in `netlify.toml`: the production branch is `master`, the repository root
is the base directory, `npm run build` is the build command, and `dist` is the publish directory. Node.js 22 is
pinned in the configuration and the application requires no secrets or runtime environment variables.

After a production deploy, verify the live version index and representative catalog, recipe, and icon assets by byte
size and SHA-256:

```sh
npm run smoke:deploy -- https://<site>.netlify.app/
```

## Data pipeline

`gtnh@ShadowTheAge` and `nesql-exporter@ShadowTheAge` are read-only MIT-licensed upstream submodules. The
reproducible release workflow prepares a disposable Prism instance, processes its private NESQL output twice,
verifies deterministic format-v5 assets, and publishes them without removing historical datasets. See
[`docs/exporting-current-data.md`](docs/exporting-current-data.md).

Build and verify an already processed deterministic chunked pack with:

```sh
npm run pack -- \
  --data tests/fixtures/shadowtheage-v5-2.8.0/data.bin \
  --atlas tests/fixtures/shadowtheage-v5-2.8.0/atlas.webp \
  --gtnh-version 2.8.0 \
  --revision 6d351536 \
  --output .pack-output/2.8.0-r6d351536

npm run verify-pack -- \
  --pack .pack-output/2.8.0-r6d351536 \
  --atlas tests/fixtures/shadowtheage-v5-2.8.0/atlas.webp
```

The source NESQL export remains private. Processed compatibility fixtures are immutable and versioned separately;
add a sibling fixture when supporting a new upstream shape.

`tests/fixtures/shadowtheage-v5-2.8.0/` is the pinned, network-independent compatibility source for decoder and
recipe-parity tests. `public/data/2.9.0-beta-2-r0ba2f2c5584c/` is the current default generated pack; the immutable
2.8.0 pack remains available for version switching.

## Assets and attribution

- Upstream exporter/browser: ShadowTheAge, MIT; see `gtnh@ShadowTheAge/LICENSE`.
- The bundled [Minecraft font](https://www.fontspace.com/minecraft-font-f28180) archive declares the font Public
  Domain. The supplied inventory-slot artwork remains subject to its owner's terms and is not covered by this
  repository's source-code license.

However, the project contains some assets from Minecraft (Mojang trademark and copyright), the GTNH development
team, and respective mod authors. These assets are used under fair use.
