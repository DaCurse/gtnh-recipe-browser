# Real-data roadmap

The browser consumes unchanged ShadowTheAge format-v5 exports through the canonical shared format-6 pack contract. The upstream
submodules are read-only; all browser-specific retention, special-data, and release behavior lives in this repository.

## Completed

- Format-v5 decoding preserves items, fluids, ore dictionaries, containers, tooltips, recipe grids, GT metadata,
  crafters, search masks, and remaps.
- Deterministic packs split catalogs, recipes, special records, and icon owners into verified content-hashed
  MessagePack/WebP assets. Format 6 uses a persistent union layout and a global full-SHA object store. The builder
  performs two identical builds and rejects missing references, oversized shards, bad hashes, and missing sprites.
- The browser loads versions, catalogs, recipes, usages, sprites, and offline datasets with verified caching,
  cancellation, paging, dataset switching, and explicit deletion.
- The special contract covers crop outputs, mutation pools, crop breeding, GT veins, GT small ores, Meteor
  Rituals, Enhanced LootBags, Vending Machine trades, worldgen loot, and GT ore processing. Special records are
  searchable through Recipes/Usages lookups and are rendered from semantic payloads.
- The `nei-special-v1` fixture covers every category, canonical goods and ore-dictionary references, service icons,
  grouped/limited loot, conditional vending, Meteor reagent effects, and branched chemical-bath/sifter graphs.
- The direct exporter launches a disposable GTNH client from a pinned archive, runs the maintained runtime adapter,
  exits the client automatically, processes the NESQL output, and stages a deterministic pack without player action.

## Current release

The active 2.9.0 beta datasets are `2.9.0-beta-3-rcb4153c995d9` and
`2.9.0-beta-2-r2e44dca28916`, built with canonical format 6 and the shared
layout. Beta 2 has 285,691 recipes, 104,729 goods, 1,948 special records, and
914 manifest assets; beta 3 has 286,455 recipes, 105,099 goods, 1,949 special
records, and 916 manifest assets. The 2.8.0 benchmark is also migrated to
format 6 with 190,080 recipes, 42,640 goods, and 868 manifest assets.

## Future profiles

For a newer GTNH release, add a reviewed archive profile, compile the overlay against that release's exact mod jars,
run the direct command in a new workspace, and compare representative live records from every special category. Keep
the source sidecar and run provenance private; commit only verified immutable browser assets and any new
network-independent fixture needed for a changed shape.

Before activation, require two identical pack builds, complete asset/hash/sprite verification, and a deployed-origin
smoke test. The version index contains one revision per GTNH version so a replacement cannot leave an obsolete
same-version dataset selectable.

## Remaining browser checks

Run interrupted install/reload/resume and network-disabled complete-dataset acceptance runs in current desktop and
mobile-sized Chromium, Firefox, and WebKit. Continue profiling high-cardinality catalog startup and special-table
paging on representative phones. These are acceptance and performance checks, not reasons to fork the pack format.

The former interactive export workflow is retired; its detailed history belongs in Git commits rather than in this
roadmap.
