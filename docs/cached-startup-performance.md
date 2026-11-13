# Startup performance and regression checks

Prepared catalogues, family grouping and sprite references are persisted in
IndexedDB. Search documents load on the first nonempty query; decoded lazy
shards are retained after use. Chunked UTF-8 buffers avoid large structured
clones, and the snapshot header commits last. Interrupted or quota-limited
preparation falls back to verified source pages. Deleting a dataset removes
its prepared caches as well as its source-object references.

Metadata and shell-update checks yield to cached startup after 150 ms. A shell
announces readiness before catalogue work so worker takeover can distinguish a
busy client from a legacy window. Preserve takeover and semantic cache migration
when retiring old datasets, and keep remaining immutable asset URLs unchanged.

Measure cold startup, prepared-cache startup and immediate navigation separately.
Prepared startup should read no compressed bootstrap pages; cached item details
should not reread compressed pages. Offline and stalled-metadata startup need
real service-worker checks in addition to synthetic routed tests. Keep item
panes mounted during detail loading and render available recipe cards while
remaining chunks load. Exports still require complete results.

Useful commands (supply the preview URL and absolute Playwright module):

- `npm run profile:incremental -- <url> <pack-dir> <playwright-module> 4`
- `npm run test:cached-startup -- <url> <playwright-module>`
- `npm run test:item-loading -- <url> <playwright-module>`
- `npm run test:startup-responsiveness -- <url> <playwright-module>`

Use a production build and report viewport, CPU throttling, cache state and
network conditions. Controlled browser timings are not physical-phone claims.
Track main-thread evaluation and garbage collection as well as transfer bytes.
A smaller payload that slows normal browsing is not an improvement. Keep full
resolution item atlases; optimize the small header image independently. GitHub
Pages HTTP cache policy cannot be changed by adding a Netlify `_headers` file.
Report Lighthouse scores only after a fresh run; automated accessibility checks
do not replace keyboard, focus and graphical-background contrast review.
