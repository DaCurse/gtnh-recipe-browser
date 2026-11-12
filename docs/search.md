# Item search

The catalogue and both Recipe Finder pickers use the same parsed query in the
worker and fallback. `searchSyntax.ts` owns tokenization, lossless highlighted
spans, and matching; `HighlightedSearchInput.svelte` paints those spans behind a
native input. Selection, caret movement, undo, mobile keyboards and accessibility
remain native. During IME composition and in forced-color mode the native text
is visible instead of the overlay. The Search syntax dialog uses the same lexer
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

No export, pack schema or bootstrap download changes are needed. Per user scope,
NEI `%subset` hierarchy, regex and Extended+ recipe-context/grouping syntax are
deferred. Recipe-card filters and quest text search retain their existing plain
text behavior; the guide is shown only where this syntax is supported.
