# NEI special integration anchors

Use the mod's NEI handler and registration code as the source of truth when a
special tab needs an icon or a probability. The browser exports the semantic
record and resolves the resulting live stack through the normal catalog; it
does not hardcode atlas coordinates.

## World-generation loot

The NEI Custom Diagram `ForgeWorldgenLoot` generator declares its icon as
`ItemComponent.create(Item.getItemFromBlock(Blocks.chest), 0)`. The deterministic
browser anchor is therefore the vanilla `minecraft:chest` item at damage 0.
Forge entries are `WeightedRandomChestContent` values; their chance is
`entry.weight / sum(entry.weight)` and their min/max amounts are retained.
Roguelike Dungeons supplies weighted leaves, while Twilight Forest exposes
rarity-weighted items in its `TFTreasureTable` groups. Keep those groups as
bounded grids and normalize each group independently.

## Vending Machine

The VendingMachine NEI handler lays out `fromCurrency`/`fromItems` on the left,
an arrow in the middle, and `toItems` on the right, with requirements below.
Its machine icon is the live `VMItems.vendingMachine` stack initialized by
`VMItems.registerMultis()` (`MTEVendingMachine(...).getStackForm(1)`), not a
placeholder item or a guessed GregTech meta. Resolve that field during the
runtime export; the pack-builder repair for older sidecars matches the catalog
item by its GregTech vending-machine unlocalized name.

## Shared presentation

Ordinary recipes and special handlers use the same `.nei-panel` shell, Shadow
UI text palette, `SlotSurface` textures, frameless item sprites and quantity
placement. `SpecialGoods` retains ranges, weights, Fortune summaries,
ore-dictionary choices and bounded pagination; native handler coordinates can
be supplied through its `positions` prop. Active special tabs use the same
icon ruler treatment as machine tabs.

`recipeViewCount` combines ordinary counts with enabled special-category
counts for the Recipes/Usages direction. Machine usages remain independent.
Loading ordinary recipe shards must not overwrite the special contribution,
and opening a global special category must not replace the selected item's
counts with the global total.

### CropsNH 2.0.140 geometry

The pinned [cropstick breeding handler](https://github.com/GTNewHorizons/CropsNH/blob/2.0.140/src/main/java/com/gtnewhorizon/cropsnh/compatibility/NEI/NEICropsNHCropstickBreedingHandler.java)
places the seed sprite at (75,22), parents at x=44,106,23,127 / y=22,
soil at (75,43), and subsoil at (75,64). The
[crop output handler](https://github.com/GTNewHorizons/CropsNH/blob/2.0.140/src/main/java/com/gtnewhorizon/cropsnh/compatibility/NEI/NEICropsNHCropHandler.java)
uses seed/soil/subsoil x=33 with y=20,41,62, and a three-column output grid
starting at (104,16). The
[mutation pool handler](https://github.com/GTNewHorizons/CropsNH/blob/2.0.140/src/main/java/com/gtnewhorizon/cropsnh/compatibility/NEI/NEICropsNHMutationPoolHandler.java)
uses nine columns with 18px spacing.

`SpecialNeiStage` renders the cropped Shadow UI 5.47 `breeding2`, `breeding4`
and `cropList` backgrounds. Run
`npm run ui:special-backgrounds -- <Shadow.UI.v5.47.zip>` to reproduce them.
These three small PNGs inherit the resource pack attribution and license in
`assets/source/machine-ui`; their source crop is exactly the handler's
`drawBackground` rectangle, (5,11,166,87) or (5,11,166,85). Browser slot
coordinates subtract one from sprite coordinates to include the slot rim.
Unknown/oversized layouts retain all goods in the shared slot-grid fallback.
Additional machine catalysts and requirements remain visible below the native
diagram. Soil alternatives share one native slot and cycle as in NEI.

## Other reusable anchors

- CropsNH pages use `CropsNHItemList.cropSticks` for crop output, pool, and
  breeding tabs.
- Enhanced LootBags uses the registered `enhancedlootbags:lootbag` item at
  damage 0 for the default tab icon.
- Blood Magic meteor pages use `ModBlocks.blockMasterStone`.
- GT ore pages and dimension-display items follow the embedded
  [GTNEIOrePlugin integration map](gtneioreplugin-integration.md), including
  its four layer rows, `DimensionHelper` abbreviations, and per-dimension
  normalized vein probabilities.

When adding another category, first record the handler class, its icon field,
its slot order, and the denominator used for any displayed chance. Then add a
focused fixture and a source-level anchor test before publishing a dataset.
