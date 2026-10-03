# Format-7 incremental loading validation

Validated against the unchanged processed beta-2 and beta-3 direct exports on 2026-10-03.
The historical v6 baseline remains documented in `pack-reuse-beta-2-beta-3.md`.

## Real-data measurements

| Measurement | Beta-2 | Beta-3 |
| --- | ---: | ---: |
| Bootstrap physical bytes | 7,969,440 | 10,322,134 (9.84 MiB) |
| Bootstrap physical pages | 7 | 10 |
| Detail partition pages: median / p95 / max | 1 / 1 / 1 | 2 / 2 / 2 |
| Referenced asset bytes | 68,765,885 | 76,962,151 |
| Referenced asset objects | 424 | 711 |
| Manifest bytes | 1,016,576 | 1,440,148 |
| Incremental asset bytes after beta-2 | — | 9,485,090 |
| Incremental bytes including manifest | — | 10,925,238 |

Both versions together reference 712 unique physical objects, totaling 78,250,975 asset bytes.
Including both manifests, storage is 80,707,699 bytes: below the 82,370,877-byte v6 baseline.
Beta-3 incremental storage including its manifest is below the 12,509,650-byte baseline.
Every detail lookup hydrates one logical partition; the two-page beta-3 physical fan-out is below the four-page p95 limit.
No physical page exceeds 4 MiB decoded, and neither pack has oversized singleton pages.

Recipe selection is a separate workload from item-detail hydration. Nonempty recipe lookup physical-page fan-out
is median 4 / p95 10 for beta-2 and median 5 / p95 12 for beta-3; usages are median 5 / p95 16 and median 6 / p95 18.
These pages, and referenced ingredient groups, load only after selection.

Reproduce the measurements with `npm run analyze:storage -- <beta-2-pack> <beta-3-pack>`.
The report accounts for physical assets by SHA, compact selectors, effective ore-group fallbacks, and manifests.
Bootstrap figures exclude manifests and sprite sheets; sprites are fetched as visible items require them.

## Browser verification

Chromium, mobile-sized viewport 390 × 844, against the local production build and final beta-3 pack:

| Measurement | Cold | Warm |
| --- | ---: | ---: |
| Catalog-ready time (including 500 ms settling interval) | 3,015 ms | 2,859 ms |
| Dataset-asset network requests | 23 | 0 |
| Record-page network requests | 10 | 0 |
| Bootstrap IndexedDB reads | 10 | 10 |

Cold startup requested only bootstrap record pages plus visible icon sheets: no details, groups, recipes, or special pages.
Selection fetched two detail pages, then four recipe pages and the recipe batch's referenced group partitions.
An item deep link restored successfully; no page errors or application alerts were observed.
These are local browser timings, not physical-phone performance claims. The browser's coarse heap estimate
was approximately 435 MB, so memory and rendering remain opportunities for subsequent optimization.

Run `npm run profile:incremental -- <shell-url> <pack-directory> <absolute-playwright-module>` to repeat the
optional browser check without adding browser automation to application dependencies.

## Determinism and compatibility

Two independent builds of each final pack produced identical manifest and physical-asset bytes.
Directory digests (SHA-256 over sorted relative filenames and file bytes):

- Beta-2: `eb8ed73d7b2bfc97819892349d168afa766d48261eda88e1e692e5135e844fa4`
- Beta-3: `f3362b2e6ae94ebee0cb97ec490e9d8c9d1f355466240fb4dc654a862e1bc1b3`

Pack verification checks reconstructed logical SHA identities, isolated physical families, recipe/group/detail coverage,
special record integrity, immutable layout provenance, and sampled source sprite parity (100 samples per version).
Synthetic tests exercise insertion, deletion, modification, reordering, cross-family reuse isolation, and oversized singletons.
Runtime tests cover bootstrap-only startup, cancellable memoized hydration, recipe groups, machine capabilities,
special views, decoded version reuse, offline installation, ownership/reference counting, and same-version v6 bookkeeping migration.

The new shell uses `versions-v7.json`. The existing `versions.json`, three v6 manifests, and their referenced assets
remain the frozen returning-client bridge. Local staging/HTTP smoke validation does not deploy a production release.
The bridge index and manifests were SHA-checked before and after publication and remained unchanged; no objects were pruned.
All three staged packs passed HTTP smoke verification of every referenced physical asset, and the production build's
default version index passed the same check for all 711 beta-3 assets. `npm run quality` passed all gates (35 test files,
215 tests), including the production build and precache verification.

The immutable asset stage was deployed to `https://gtnh-recipes.netlify.app/` in commit `65ee9b3` on 2026-10-03.
Before activating the v7 index and shell, production-origin smoke checks verified every physical asset in all three
packs (339 / 424 / 711 references). The live v6 index and all three bridge manifests matched their frozen local bytes.
