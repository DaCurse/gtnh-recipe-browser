# Recipe loading performance

Measured against commit `0da87e6` using the production build, Chromium, a 390 × 844 mobile viewport, and 4× CPU throttling. Assets were served from localhost without network throttling; each run started with a fresh browser context. These are controlled comparisons, not predictions for every phone or connection.

| Iron ingot view   | Before: first cards | After: first cards | Before: complete | After: complete |
| ----------------- | ------------------: | -----------------: | ---------------: | --------------: |
| Recipes           |              8.52 s |             2.03 s |           8.57 s |          4.94 s |
| Usages            |             15.64 s |             1.94 s |          15.64 s |          7.12 s |
| Return to recipes |              0.36 s |             0.23 s |           0.36 s |          0.23 s |

The first two views fetched exactly the same 50 and 56 physical pages before and after. Main-thread long-task time fell from 3.92 to 1.84 seconds for recipes and from 7.51 to 2.26 seconds for usages.

## Changes

- Render available recipe cards while remaining chunks load. Exports still require a complete result.
- Apply a shared goods/group partition once when concurrent lookups await the same load. Stop representative-item lookup at the first available member.
- Keep immutable recipe and special-record arrays out of deep reactive proxies.
- Verify SHA-256 with native asynchronous Web Crypto, retaining the synchronous fallback and byte-length checks. Aborting cached verification does not evict valid cached content.
- Record physical-page ownership in one atomic IndexedDB batch, skipping already-owned blob reads.
- Send only referenced ingredient metadata to the recipe worker. Build searchable documents only for nonempty queries; blank browsing uses the ordered records directly.

## Verification

The complete ordered recipe-ID vectors were identical for iron recipes (1,448), iron usages (285), water usages (5,624), and a repeated iron-usages visit. Separate repository-load measurements improved from 9.42 to 5.59 seconds, 14.22 to 6.85 seconds, and 4.62 to 2.37 seconds for the first three cases.

`npm run quality` covers native/fallback integrity verification, cancellation, shared partition hydration, atomic ownership accounting, worker search and stale-request behavior. `tools/test-recipe-streaming.mjs` holds later real-data pages and verifies visible mobile cards, disabled incomplete exports, complete JSON export, ingredient/metadata/ID filtering, and pagination. Existing browser checks cover item-loading feedback, cached/offline startup, and one-time rollout safeguards.

No immutable dataset assets, release identifiers, rollout epochs, or data schemas changed.
