# Recipe finder

Open **Recipe finder** beside **Items** in the main navigation. Add any known input or output using
the item/fluid search, then add more clues to narrow the result. Every selected ingredient must be
present on its chosen side, while additional ingredients and any quantities are allowed. An item
accepted by an interchangeable recipe slot matches that slot. Exact variants are selected explicitly.

Results include ordinary recipes across all machines by default. The horizontal machine icon strip shows recipe counts and can narrow the
results further. Remove a chip to broaden the search, or use **Clear all** to start again. The current
inputs, outputs, and dataset are recorded in the URL, so searches can be bookmarked or shared.

The finder uses the existing per-item recipe relationships, streams results as chunks arrive, and
filters stricter searches in memory after a complete candidate set is available. It does not download
all recipes when opened. Special NEI views, such as ore distributions, remain accessible from the
existing item browser.

## Validation

`npm run quality` includes subset-direction, all-selected-ingredient, interchangeable-ingredient,
exact-identity, URL, anchor-selection, empty/missing-ingredient, and cancellation tests.

`npm run test:recipe-finder -- <app-url> <playwright-module> [screenshots]` checks actual 2.9.0 data:
1,448 iron output recipes; 48 with oxygen as an input; 633 oxygen usages; and a multi-input subset
with interchangeable ingredients, compared against a complete export from the existing browser.
It also checks the machine filter, pagination, cached refinement, shareable URLs, history, mobile
layout and picker keyboard controls, exact NBT variants, and clearing in-flight requests.
