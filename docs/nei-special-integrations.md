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
