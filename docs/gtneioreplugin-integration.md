# GTNEIOrePlugin integration notes

GT5-Unofficial embeds the maintained GTNEIOrePlugin source under
`src/main/java/gtneioreplugin`. For GTNH integrations, inspect that embedded
copy first (at the pinned commit used by the export profile), rather than
starting with an archived standalone plugin. The relevant upstream source is
also available at the [GT5-Unofficial `gtneioreplugin` tree](https://github.com/GTNewHorizons/GT5-Unofficial/tree/529b5f42291b3bf6eceb020453f59eab12aee594/src/main/java/gtneioreplugin).

## What the embedded plugin provides

The plugin is the NEI presentation and lookup layer for GregTech worldgen. Its
main GT5 pages are:

- `PluginGT5VeinStat`: all ore-mix vein records, four fixed layers (Primary,
  Secondary, Between, Sporadic), height range, weighted chance, and generated
  dimensions;
- `PluginGT5SmallOreStat`: small-ore block variants, height, amount per chunk,
  potential drops, and generated dimensions;
- `PluginGT5OreBase`: shared dimension-display item layout and stone/ore
  variant resolution;
- `GT5OreLayerHelper`: vein wrappers, dimension-specific height overrides, and
  per-dimension normalized probabilities;
- `GT5OreSmallHelper`: small-ore wrappers, material/drop lookup, and enabled
  dimensions; and
- `DimensionHelper` plus `ItemDimensionDisplay`: the canonical dimension name,
  abbreviation, tier, and `gtneioreplugin:blockDimensionDisplay_<abbr>` item
  mapping.

The same embedded package also contains handlers for underground fluids and
the renderer for dimension-display blocks. It is therefore the preferred
reference for any future request involving GregTech ore veins, small ores,
underground-fluid statistics, dimension-display icons, ore-material variants,
or GT worldgen tooltip semantics. It does not replace the separate mod
handlers used for CropsNH, Blood Magic meteor rituals, Enhanced LootBags,
Vending Machine, or world-generation loot.

## Data contract captured by the browser

The browser keeps the semantic records rather than NEI screenshots:

- A vein always has four layer slots, even if a legacy sidecar omitted one.
  Each slot points at the representative ore block and carries its role and
  material. Vein-level height and random weight are shown below the layers.
- Vein dimension entries use the plugin's display block. For each dimension,
  a vein chance is the vein's `randomWeight / sum(randomWeight for all veins
  enabled in that dimension)`, not the raw weight rendered as a percentage.
  Dimension-specific height overrides remain attached to that entry.
- A small ore shows the small-ore block (with its ore-dictionary group when
  one exists), height, amount per chunk, then potential drops, then generated
  dimensions. Small-ore dimension entries do not display a vein probability.
- Dimension names in runtime exports can be full names, internal Galacticraft
  names, abbreviations, or older numeric IDs. Resolve them through the
  `DimensionHelper` mapping before constructing a display goods ID; do not
  guess an unrelated block icon.

When adding a new GTNEIOrePlugin-backed page, first locate its `PluginGT5*`
handler and its helper/wrapper types, then mirror the handler's item lookup,
tooltip calculation, and ordering in the exporter and a focused browser
renderer. Keep the raw registry fields in the sidecar so a later page can be
added without another runtime export.

