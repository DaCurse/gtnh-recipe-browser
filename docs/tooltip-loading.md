# Tooltip readiness

Catalogue bootstrap entries have names, icons and searchable text, but their
tooltip formatting is incomplete. The presence of `rawTooltip` or tooltip text
does not prove that the detail partition and its colour annotations have loaded.
Entries with legitimately plain tooltips also must not wait for a colour code
that will never exist. Readiness means that `DatasetRepository.entryFor` has
finished, including formatting restoration.

`catalogEntryLoad.svelte.ts` supplies the active repository through Svelte
context and owns the shared loading/cancellation state. It is used by both the
selected-item view in `App.svelte` and `FloatingCatalogTooltip.svelte`, so the
landing page, catalogue picker, recipe ingredients, machines, special views and
interchangeable members all use the same policy without resolver prop chains.
Repository identity and entry ID both participate in readiness; stale responses
cannot paint a different item or a different dataset. Pointer coordinates and
new object instances for the same entry do not restart hydration.

Floating tooltips wait 100ms before requesting details, then stay absent until
the complete entry is ready. Failed loads remain hidden instead of painting an
uncoloured fallback. Leaving a hover cancels its subscription without cancelling
another consumer's shared repository request. Re-hovering can retry; cached
offline entries still render normally. Generated `special:` context entries
have no detail partition and retain their complete local text.

Item details request immediately. The item icon and recipe view remain mounted,
while `ItemOverview.svelte` shows a static text skeleton until the same complete
entry is ready. A failed request displays a retry action rather than incomplete
tooltip text. `CatalogTooltip.svelte` remains a synchronous presentation-only
component. It never owns a second fetch or colour-update pass.

`CatalogTooltipHover` shares pointer/focus bookkeeping for the landing page,
selected finder chips and interchangeable item members. Finder chips clear the
hover on removal or constraint changes. Floating placement remains shared and
flips/clamps to the viewport edges.

`test:tooltip-hydration` stalls real detail-partition requests in fresh browser
contexts. It checks cancelled hovers, stable pointer movement, viewport edges,
picker entries, cold recipe-result ingredients, selected chips and item-detail
skeletons. Mutation observers verify that the coloured fixtures never mount an
uncoloured intermediate tooltip. `test:item-loading` covers slow-CPU item
selection, switching directions and selecting subsequent items on both mobile
and desktop.
