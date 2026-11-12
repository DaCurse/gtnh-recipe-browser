# Original-resolution item icons

The NESQL export renders 64x64 PNGs. The upstream processed atlas downsizes them
to 32x32 with a box filter. This blends diagonal block edges before browser
scaling; CSS cannot recover that lost detail.

For the final GTNH 2.9.0 dataset, larger icons now use an optional companion made
from the original PNGs. The immutable recipe pack and its 32px sheets are
unchanged. Icons at 32 CSS pixels or smaller, unsupported releases, and failed or
offline HD loads retain the existing sheets. Original item-texture detail still
limits magnification beyond the 64px render.

## Identity and pixels

The recovery tool reads exact item/fluid identities and image paths from the
validated export database script. NBT identities use the original serialized
NBT's UTF-8 SHA-1, matching the export processor. Unreferenced raw goods are not
published. Five published fluid entries have no original PNG; the companion
explicitly excludes them and retains their existing fallback.

The builder matches 105,218 published goods to originals and deduplicates 80,134
64px sprites into 1,253 small 8x8 sheets. Encoding preserves every visible RGBA
pixel, including partial transparency. RGB underneath zero alpha is normalized
for WebP; no visible pixel is resized, sharpened or recoloured. Both encoding
and verification compare decoded pixels against the source.

Low-resolution deduplication can merge originals that differ at 64px. Lookup
tables keep exact owner-specific overrides for those cells. Group/family icons
use the representative owner or an unambiguous cell mapping; they never guess
between conflicting originals.

## Loading and caching

`highResolutionIcons.ts` reads a tiny release registry, then lazily loads a
verified root manifest, one lookup per existing 32px sheet, and just the small
HD sheets needed by visible icons. All assets are immutable SHA-256 objects in
the existing global store. Optional assets are cached in IndexedDB and recorded
under the owning dataset for size accounting and deletion. They are not added
to mandatory offline-install requirements or shell precaching. Cached HD works
offline; unavailable HD falls back to installed 32px assets.
Already-cached 32px images display immediately while a cold HD request loads,
then upgrade without blanking the slot. Cold views do not download both sizes.

The companion totals about 40.1 MB, including metadata, compared with 44.9 MB
for the existing 32px sheets. This is additional optional data, not a mandatory
replacement download. On a cold local load of the linked solar-panel recipe
page, icon traffic was 5,854,470 bytes using old sheets and 1,484,036 bytes using
the companion. Requests increased from 15 to 53, while transferred bytes fell
about 75%. Network latency and visible items affect the result.

## Reproduce and verify

Keep the validated source export private and preserve upstream submodules.
See `agent-data-export-runbook.md`. These steps read existing output and do not
start Minecraft or regenerate recipe records:

```sh
python3 tools/high-resolution-icons/source.py \
  --export .export-work/2.9.0-direct/client-instance/.minecraft/nesql/browser-export \
  --output .export-work/icons64-source
npm run build:icons64 -- public/data/2.9.0-v7-r9ec25114d4a7 .export-work/icons64-source
npm run verify:icons64 -- public/data/2.9.0-v7-r9ec25114d4a7 .export-work/icons64-source
npm run verify-pack -- --pack public/data/2.9.0-v7-r9ec25114d4a7 --asset-directory public/assets/sha256
npm run quality
```

Source archive/database digests, base manifest digest and every generated asset
are listed in `assets/source/high-resolution-icons/provenance.json`. The verifier
checks all assets and owner mappings plus original-pixel samples, including
machine controllers and NBT variants. Browser validation covers native-size
selection, the larger icon path, warm offline HD and cold offline fallback.
