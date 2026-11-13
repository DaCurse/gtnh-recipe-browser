# Item search

The catalogue and both Recipe Finder pickers use the same parsed query in the
worker and fallback. `searchSyntax.ts` owns tokenization, lossless highlighted
spans, and matching; `HighlightedSearchInput.svelte` paints those spans behind a
native input. Selection, caret movement, undo, mobile keyboards and accessibility
remain native. Composition input updates the colored overlay synchronously,
without swapping to plain text (mobile keyboards often compose ordinary words).
While focused, a frame callback follows native caret scrolling before paint;
scroll/resize events also synchronize the overlay, and teardown removes the
listeners and callback. Forced-color mode uses visible native text instead. The Search syntax dialog uses the same lexer
for its examples and restores focus when dismissed.

## Upstream provenance

Syntax and colors follow GTNH NotEnoughItems **extended mode, spaces = AND**,
at commit `0185cd64b10ed30af47d09e17d5e6062b09226f5`:

- [Provider registration and colors](https://github.com/GTNewHorizons/NotEnoughItems/blob/0185cd64b10ed30af47d09e17d5e6062b09226f5/src/main/java/codechicken/nei/api/ItemInfo.java#L162):
  `@` mod / LIGHT_PURPLE (§d), `$` ore dictionary / AQUA (§b),
  `#` tooltip / YELLOW (§e), `&` identifier / GOLD (§6).
- [SearchTextFormatter](https://github.com/GTNewHorizons/NotEnoughItems/blob/0185cd64b10ed30af47d09e17d5e6062b09226f5/src/main/java/codechicken/nei/SearchTextFormatter.java):
  `!` or `-` exclusion BLUE (§9), `|` OR GRAY (§7), quote delimiters GOLD (§6).
- [SearchTokenParser](https://github.com/GTNewHorizons/NotEnoughItems/blob/0185cd64b10ed30af47d09e17d5e6062b09226f5/src/main/java/codechicken/nei/SearchTokenParser.java)
  and [SearchField.getPattern](https://github.com/GTNewHorizons/NotEnoughItems/blob/0185cd64b10ed30af47d09e17d5e6062b09226f5/src/main/java/codechicken/nei/SearchField.java):
  quoted phrases, escaped quotes, case-insensitive matching, AND within OR
  branches, `?` for one character and `*` for **one or more** characters.

The renderer reuses the application's existing Minecraft `fmt-*` color classes.
No separate search color palette or copied upstream source is shipped.

## Dataset boundary and deliberate scope

The browser retains its existing punctuation/accent normalization and unprefixed
search across names, tooltips, variant labels and identifiers. Explicit prefixes
select individual fields; `#` omits a tooltip's repeated item-name line. Terms
must match one exact member of a family, rather than combining evidence from
different variants. `&` searches stable exported identifiers; runtime numeric
registry IDs are not portable between game instances.

`$` lazily loads the existing verified ingredient-group shards through
`DatasetRepository`, reverses named `o:` membership, then builds and persists an
enriched search projection. Anonymous ingredient groups are excluded. Requests
share promises and failed builds can be retried. The enriched index stays in use
for the remainder of that catalogue visit. Base and enriched projections have
separate versioned cache keys, so older search documents cannot be reused with
the new schema. Plain search does not acquire ore-name matches just because a
previous `$` search warmed the enriched index.

NEI `%subset` hierarchy, regex and Extended+ recipe-context/grouping syntax are
deferred. Recipe-card filters and quest text search retain their existing plain
text behavior; the guide is shown only where this syntax is supported.

## Numeric catalogue ordering

Browsing, worker search and fallback search use numeric registry ID followed by
metadata, matching NEI's ID/damage sort options. Search filtering preserves that
order rather than promoting exact name matches. Items precede fluids because
their registry numbers belong to different domains. Existing family grouping and
host-stone order remain intact; unknown registry IDs sort after known IDs.

The format-v5 export contains numeric IDs but immutable format-7 browse records
omit them. `buildPack` now emits a private `catalog-order.json` companion input;
`export:publish` writes its compressed, content-addressed object and registers it.
The companion binds to the dataset ID and source data checksum. Its provenance
participates in normal asset retention and retired-dataset cleanup. Bootstrap
loads the verified index before grouping. It participates in offline download,
cache size and dataset deletion through the repository's normal asset list.
The prepared cache key includes the index digest, so a previously alphabetical
projection cannot persist after an update.

An existing unchanged pack can acquire this companion reproducibly:

```sh
npm run build:catalog-order -- <matching-processed-data.bin> <published-pack>
```

The command checks that the input checksum matches the immutable manifest.
No recipe pack rewrite or game re-export is needed.
