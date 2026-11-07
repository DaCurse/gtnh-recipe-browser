# PageSpeed review — 2026-11-07

Reviewed both supplied reports, including scored audits, diagnostics and manual
checks across every category. These are Lighthouse lab results, not PageRank or
a guarantee of search placement.

- [Desktop report](https://pagespeed.web.dev/analysis/https-dacurse-github-io-gtnh-recipe-browser/74e65724di?form_factor=desktop)
- [Mobile report](https://pagespeed.web.dev/analysis/https-dacurse-github-io-gtnh-recipe-browser/x1rgogt6ok?form_factor=mobile)

| Category | Desktop | Mobile | Findings |
| --- | ---: | ---: | --- |
| Performance | 62 | 61 | Fast initial paint, followed by expensive catalogue work. |
| Accessibility | 95 | 100 | Desktop status contrast and visible/accessibility name mismatches. |
| Best practices | 100 | 100 | No failed reported checks. |
| SEO | 100 | 100 | Crawlability, metadata, canonical URL and crawlable links pass. |
| Agentic browsing | 100 | 100 | Reported accessibility-tree and layout-stability checks pass. |

## Changes made

- Header logo uses an 84×84 lossless WebP (~9 KB) rather than the 512×512 PNG
  (~145 KB) displayed at 42×42. This supports 2× density. The full-size source,
  social image and install icons remain available. The PWA still precaches its
  install icons; this change reduces the header's critical image request, not
  the total size of every offline asset.
- The dataset status text is brighter. Its previous foreground `#85898e` on
  `#212327` had contrast 4.47:1, just below 4.5:1. It now uses `#969ba1`.
- Header link/button accessible names come from their visible text. The dataset
  name now includes its changing cache/update status. A real space separates
  the brand's two visible text fragments. Home/dataset-manager hints use titles.
- Ingredient-group icon selection stops at the first available member instead
  of mapping and filtering every member into temporary arrays. This preserves
  the same representative and full relation calculations. Local profile runs
  did not show a material end-to-end improvement; this is allocation cleanup,
  not a claimed fix for the overall blocking time.

## Performance priorities

The reports show desktop/mobile LCP of 0.4/0.9 seconds, CLS of zero, but total
blocking time of 5.56/8.1 seconds. Script evaluation and garbage collection
dominate main-thread work; initial rendering is already quick. Network totals
are about 9.4 MB, reflecting catalogue/search data and the item showcase.

The substantial next improvement would move catalogue decoding/materialization
off the main thread or divide preparation into bounded tasks. Measure cold
startup, prepared-cache startup and immediate navigation separately. Preserve
search, grouping, tooltips and offline behaviour; a smaller benchmark payload
that makes normal use slower is not an improvement.

Lower priorities:

- GitHub Pages supplies the reported ten-minute HTTP cache lifetime. Adding a
  Netlify-style `_headers` file cannot change it. Existing content hashes,
  verified data caching and the service worker already support repeat visits.
- The unused-CSS and unused-JavaScript estimates are about 14 KB and 60 KB.
  Catalogue work is the larger issue; splitting styles or features should be
  driven by measured use rather than removing needed browser functionality.
- Keep full-resolution item atlases. The image-sizing warning in these reports
  identifies the header logo, not a reason to degrade item sprites.

## SEO, best practices and manual checks

No failed automatic SEO or best-practices audit needs a speculative change.
The HTML contains the primary title, description, canonical URL, social metadata,
WebApplication structured data and actual navigation links before JavaScript.
The sitemap is an XML document listing the landing URL. The structured-data
script parses as JSON; Lighthouse marks structured data as a manual check, so
its SEO score is not proof of eligibility for a particular Google rich result.

The report also leaves ten accessibility checks for manual review, including
focus order/management, keyboard access and offscreen content. Existing browser
checks cover navigation, focus-related carousel pausing, duplicate carousel
links excluded from the accessibility tree/tab order, reduced motion and
responsive layout. This is not a claim of complete screen-reader certification.

After the fixes, full axe scans of the rendered landing page at 1440px and 390px
reported no automatic violations. Contrast still has an incomplete/manual-review
entry for content over graphical backgrounds. Browser regression checks pass
for landing/catalogue/finder navigation, history, tooltips, carousel pause,
randomization, mobile layout, reduced motion, sitemap and offline reload.

No new PageSpeed score is claimed without a new run. Publication is initiated
without watching the Pages job, as requested.
