# PostHog analytics

The production site uses PostHog US Cloud with the public browser project token configured in
`src/lib/analytics.ts`. No personal/admin API key is used. Local development and deploy previews do
not send events. The slim SDK loads asynchronously during idle time and never gates dataset startup.
Blocked SDK or ingestion requests cannot prevent browsing or exports.

## Reports to use

Open [PostHog US](https://us.posthog.com/) and select the project associated with the installed token.
The public ingestion token cannot create dashboards through the management API; these are the
event/property combinations for creating saved insights in the project's UI.

| Question | Event / metric | Breakdown |
| --- | --- | --- |
| How many visits and visitors? | Web Analytics using `$pageview` | Date, referrer, device; `screen` for app section |
| What gets searched? | `catalog_search` total events | `query`; filter `search_context` to `catalog`, `finder_input`, or `finder_output` |
| Which items get inspected? | `item_viewed` | `item_name`, optionally `item_id`, `view`, `dataset_version` |
| Which finder ingredients are popular? | `finder_ingredient_added` | `ingredient_name`, `side`, `mode` |
| What finder queries are completed? | `recipe_search_completed` | `input_names`, `output_names`, `result_count`, `cached` |
| What chains are searched? | `chain_search_completed` | `input_names`, `output_names`, `route_count`, `limited`, `expanded` |
| Which features are used most? | `$pageview` and the explicit feature events | `screen`: `catalog`, `item`, `finder`, `chain` |
| Do people explore alternatives? | `chain_more_requested`, `chain_more_stopped`, `chain_route_viewed` | Requested count, route number, cached status |
| Are exports used? | `data_export_clicked`, `data_export_completed`, `data_export_failed` | `target`, `kind`, `choice`, `record_count` |
| Is loading slow or failing? | `dataset_loaded`, `dataset_load_failed` | `duration_ms`, dataset version where available |

For average daily traffic, select a date range and daily intervals in Web Analytics. For popular
queries/features, use total events and a property breakdown; use unique users when measuring how
many different visitors used a feature rather than how often it was used.

The initial pageview is recorded on arrival, even if dataset loading later fails. Pageviews follow application navigation, including item changes and browser back/forward. They do
not fire for every text edit. A session can have many pageviews; a browser's persistent anonymous ID
supports approximate unique-visitor counts, not identification of a real person across devices.

## Search and export semantics

Catalog terms are lowercased, whitespace-normalized, limited to 120 characters, and recorded after
1.2 seconds of settled results. Consecutive equivalent terms are deduplicated within the search view.
Finder selections and completed searches record public game ingredient names. Shared URL searches
also have named input/output properties in their completion events. Unknown URL ingredient IDs do
not get copied as ingredient-name fallbacks. Counts describe usage from installation onward.

Export clicks are recorded when an export action is requested, including when a filtered/all choice
dialog follows. Completion means JSON was generated and handed to the browser download action;
it does not confirm that the user saved the file to disk. Failures are recorded separately. Export
contents, filenames, raw error strings, and individual exported records are not sent.

## Collection controls

Automatic click/input capture, session replay, automatic exception capture, surveys, and feature-flag
requests are disabled. No logged-in identity or person profile is created. PostHog's anonymous browser
ID is stored in localStorage. DNT and Global Privacy Control are respected before initialization.
Default PostHog bot filtering remains enabled.

URLs retain only safe navigation categories; search text, selected IDs, dataset URL parameters and
fragments are removed from all SDK URL properties, including session-entry URLs. Referrers are
reduced to origins. Search terms and selected public game item names are intentional event properties
for the popularity reports above. Project-side retention, IP handling and account permissions remain
PostHog project settings.

## Verification

`npm run quality` includes analytics configuration, deferred event delivery, URL normalization,
development/preview/DNT/GPC exclusion and SDK-failure containment tests.

`npm run test:analytics -- <app-url> <playwright-module>` tests the real production SDK against
intercepted ingestion: pageviews, normalized searches, item/finder/chain interactions, export
success/failure, sanitized URL properties, blocked-network behavior and DNT. It enables bot capture
only in the test's intercepted script response because production intentionally excludes Playwright.
The test does not send its synthetic usage to PostHog.
