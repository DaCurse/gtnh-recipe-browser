# PostHog analytics

The production site at [GTNH Recipe Browser](https://dacurse.github.io/gtnh-recipe-browser/) uses PostHog US Cloud with the public browser project token configured in
`src/lib/analytics.ts`. No personal/admin API key is used. Local development and deploy previews do
not send events. The slim SDK loads asynchronously during idle time and never gates dataset startup.
Blocked SDK or ingestion requests cannot prevent browsing or exports.

## Reports to use

Project [701696 on PostHog US](https://us.posthog.com/project/701696) has three
pinned dashboards, each defaulting to the last 30 days:

- [GTNH Feature Usage](https://us.posthog.com/project/701696/dashboard/2345627):
  daily visitors, device/section adoption, finder and chain users, weekly retention,
  and touch previews/opens/holds. Traffic and retention reuse the existing insights.
- [GTNH Content Discovery](https://us.posthog.com/project/701696/dashboard/2345628):
  named items, quests and chapters, popular catalogue searches, zero-result searches,
  and special-tab usage.
- [GTNH Loading Health](https://us.posthog.com/project/701696/dashboard/2345629):
  median/p95 successful catalogue, questbook and search durations, plus recorded
  catalogue-load failures. Duration properties are milliseconds. Cached and cold
  loads are currently combined; these charts do not measure time spent reading.

These native insights can be edited in PostHog. The starter dashboard is retained.
Reports use captured anonymous-browser activity, not player progress or quest
completion. Zero-result searches count settled search events, not unique people
or necessarily failed intent. Explicit failures count only events delivered to
analytics; they do not establish a full failure rate. Empty latency buckets do
not mean real requests completed instantly. These event reports have not been
approved as governed Data Catalog metrics.

The frontend has only a public ingestion token. Dashboard management uses the
connected PostHog integration; never add a management credential to client code.

The following event/property combinations support further saved insights:

| Question | Event / metric | Breakdown |
| --- | --- | --- |
| How many visits and visitors? | Web Analytics using `$pageview` | Date, referrer, device; `screen` for app section |
| What gets searched? | `catalog_search` total events | `query`; filter `search_context` to `catalog`, `finder_input`, or `finder_output` |
| Which items get inspected? | `item_viewed` | `item_name`, optionally `item_id`, `view`, `dataset_version` |
| Which finder ingredients are popular? | `finder_ingredient_added` | `ingredient_name`, `side`, `mode` |
| What finder queries are completed? | `recipe_search_completed` | `input_names`, `output_names`, `result_count`, `cached` |
| What chains are searched? | `chain_search_completed` | `input_names`, `output_names`, `route_count`, `limited`, `expanded` |
| Which features are used most? | `$pageview` and the explicit feature events | `screen`: `landing`, `catalog`, `item`, `finder`, `chain`, `quests` |
| Do people explore alternatives? | `chain_more_requested`, `chain_more_stopped`, `chain_route_viewed` | Requested count, route number, cached status |
| Are exports used? | `data_export_clicked`, `data_export_completed`, `data_export_failed` | `target`, `kind`, `choice`, `record_count` |
| Are quests being explored? | `quest_chapter_viewed`, `quest_viewed`, `quest_search` | Public chapter/quest IDs and names, `quest_version`, settled query and result count |
| Do item and vending links help discovery? | `quest_link_opened` | `source`: `item_recipes`, `item_usages`, `vending` |
| Which special tabs get used? | `special_viewed` | `special_type`, `scope`, direction, item name and record count |
| Are touch previews and holds used? | `item_touch_interaction`, `item_action_selected`, `quest_touch_preview` | Preview/activate/hold action, public item name/kind, selected direction |
| Does questbook loading work? | `questbook_loaded`, `questbook_load_failed`, `quest_version_changed` | Duration, version and quest/chapter counts |
| Is loading slow or failing? | `dataset_loaded`, `dataset_load_failed` | `duration_ms`, dataset version where available |

The contextual **Export data** action uses `target: pane` for Recipes, Usages,
Machine Usages and special views, including the current category and filter.
The category-wide action uses `target: category`. The old additional machine
download repeated the same records in Machine Usages and has been removed;
historical `target: machine` events may remain in older reports.

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

Automatic click/input capture, dead/rage clicks, heatmaps, performance recording, session replay, automatic exception capture, surveys, and feature-flag
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

Quest opens, touch previews and item/vending quest links share
`questAnalyticsProperties`: plain `quest_name`, stable `quest_id`, `quest_version`,
`chapter_name`/`chapter_id` when membership exists, `secret`, and `task_count`.
Minecraft codes and quest formatting tags are stripped from names. The quest
view uses its selected chapter when a quest appears in several chapters; lazy
links and previews use the first known chapter. Existing ID-only preview events
remain unchanged historically; new captures receive the readable context.

Quest searches use the same 1.2-second settled-query and 120-character
normalization policy as catalogue searches. Quest/chapter views are deduplicated
while the same entry stays open; browser history and deep links are covered.
Mouse hovers, tooltip movement, panning/zooming, cancelled touch gestures and
pagination do not emit events. First touch previews and successful holds/second
taps do, and action dialogs record only the direction actually selected.
Special views emit once per loaded item/direction/category/scope visit, including
quest reward/requirement tabs. Quest-link clicks emit after touch preview gates,
so the first tap does not count as opening a quest. No NBT payloads, quest text,
export contents or raw error messages are recorded. Quest URLs keep only
`page=quests`, removing quest/chapter IDs, versions and search terms.

The client settings were checked against the [PostHog JavaScript configuration
reference](https://posthog.com/docs/libraries/js/config). The installed SDK's
`2026-08-30` defaults remain current; privacy and capture settings are explicit
rather than relying on changing defaults. Server-side project retention and
account settings are managed in PostHog and are not changed by this release.
