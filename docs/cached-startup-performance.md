# Cached startup performance

Returning users previously reread, hash-checked, decompressed, and decoded all 13 RC1 bootstrap pages, then reconstructed 135,703 catalog entries and normalized the search corpus on every refresh. Download caching saved bandwidth but left substantial CPU work on slower devices.

The client now restores a prepared catalog, variant grouping, and sprite-sheet references from IndexedDB. Normalized search documents are persisted separately and loaded only after a query; blank browsing skips worker indexing and sorting. Decoded detail, recipe, group, and special shards are retained after use. Recipe matching loads only the relevant ingredient groups, then hydrates display alternatives only for matched recipes. The initial grid renders 60 tiles, with further batches loaded on scroll.

Prepared data uses UTF-8 JSON buffers in chunks of 2,000 records. Catalog entries, browse rows, and group metadata are independently chunked; a small header commits the snapshot last. Sprite descriptors are resolved once per sheet and stored once in the prepared cache. This avoids repeated URL construction, large structured-clone writes, and unnecessary memory copies. Static catalog arrays use shallow Svelte state. The runtime cache is scoped to each dataset, and explicit dataset deletion removes its prepared data as well as its source references.

Metadata and shell-update checks yield to cached startup after 150 ms. New shells announce readiness before catalog work so an installing worker can distinguish a busy current client from a legacy window. Frozen compatibility assets and immutable dataset URLs remain unchanged. RC1 remains the default, with rollout epoch 2 and subsequent explicit version choices preserved.

## Measurements

Local production builds, RC1 real data, Chromium, 390×844 mobile viewport, 4× CPU throttling. Times measure navigation to the first usable item tile; warm runs follow completed cache preparation. They are controlled CPU measurements, not a guarantee for every physical phone or network.

| Measurement | Previous client | Updated client |
| --- | ---: | ---: |
| Cold browsing | 9,826 ms | 6,348 ms |
| Warm browsing | 8,973 ms | 2,341 ms |
| Warm bootstrap-page reads | 13 | 0 |
| Settled warm dataset requests | 0 | 0 |
| Initial DOM nodes | 5,167 | 971 |
| Reported JS heap | 435 MB | 269 MB |
| Ingredient-group pages for the EnderIO food selection | 16 | 0 |

A separate run with the production service worker measured warm refresh at 2,400 ms, stalled version-index refresh at 2,206 ms, and offline refresh at 1,725 ms. First search took 2,880 ms and prepared its reusable search cache. Saved searches, repeated searches and clearing, and item bookmarks survived refresh. Cached item hydration performed zero compressed record-page reads.

## Verification

- `npm run quality`: lint, dead-code analysis, Svelte/TypeScript diagnostics, 228 unit tests, production build, and precache verification.
- `npm run profile:incremental -- <preview-url> <RC1-pack-dir> <playwright-module> 4`: cold/warm timing, lazy-family boundaries, detail fanout, and item bookmarks. The profile blocks service workers so fixture routes and network counters remain deterministic.
- `npm run test:cached-startup -- <preview-url> <playwright-module>`: actual service-worker startup, stalled metadata, offline startup, deferred/cached search, search clearing, and decoded item-cache reuse.
- Actual previous shell and worker with a stalled legacy catalog, two tabs, and app-side controller-change handling disabled: worker takeover navigated each tab exactly once, preserved URL parameters, avoided reload loops, and supported offline warm reload. Explicit legacy beta-3 links continue to select published v7 beta-3.
- RC1 rollout browser test: beta-3 startup state migrated once to RC1; matching items survived, and later explicit links and dataset-manager switching remained selected.

Browser reports are retained locally under `.export-work/performance-review/`. The new prepared cache is created once after the first successful startup; interrupted or quota-limited preparation falls back to verified source pages. Subsequent refreshes use the completed cache. Immutable source manifests, pages, and sprites were not regenerated for this change.

## Live deployment

The Netlify release was verified after publishing. With the production worker and 4× CPU throttling,
warm startup took 2,158 ms, a stalled version-index refresh took 2,612 ms, and offline startup took
2,440 ms. Saved searches and cached item bookmarks passed; cached item hydration reread zero
compressed pages. Browser checks wait until requested assets appear in the verified cache index
before measuring a settled warm refresh, including slower CDN sprite downloads.
