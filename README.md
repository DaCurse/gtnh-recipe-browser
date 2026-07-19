# GTNH Recipe Browser

A touch-friendly, offline-capable Svelte browser for GregTech: New Horizons items, recipes, and usages.

## Development

```sh
npm install
npm run dev
```

Build and test with `npm run build`, `npm run check`, and `npm test`.

The app currently includes a small demonstration catalog. Production datasets follow the contracts in
`src/lib/types.ts`; catalogs and immutable recipe/icon chunks will be published separately and indexed by
`public/versions.json`.

## Data pipeline

`gtnh@ShadowTheAge` is a read-only MIT-licensed upstream submodule. Its exporter must first create format-v5
`data.bin` and `atlas.webp` from an NESQL export. Build and verify a deterministic chunked pack with:

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

## Assets and attribution

- Upstream exporter/browser: ShadowTheAge, MIT; see `gtnh@ShadowTheAge/LICENSE`.
- The bundled [Minecraft font](https://www.fontspace.com/minecraft-font-f28180) archive declares the font Public
  Domain. The supplied inventory-slot artwork remains subject to its owner's terms and is not covered by this
  repository's source-code license.
