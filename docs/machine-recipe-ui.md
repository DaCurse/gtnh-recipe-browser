# Native recipe UI

`SlotSurface.svelte` paints original ModularUI 18x18 item/fluid cells as one tiled
grid, or as one SVG layer of positioned cells and overlays. Ingredient icons are
frameless inside it. Standalone `ItemIcon` instances use the same thin native
frame; bare landing icons keep their outline/shadow treatment.

## Runtime geometry

The GTNH 2.9.0 snapshot uses its GT5-Unofficial 5.09.54.265 frontend registry.
An opt-in adapter in a disposable client reads `RecipeMap.ALL_RECIPE_MAPS`, slot
position getters, overlays, and actual `createNEITemplate` widgets, including
custom progress paths. It captures 172 maps across 55 frontend classes. The
registry matches 166 of the 178 exported recipe categories; most others are
non-GregTech crafting/aspect views.

Source anchors, pinned to the release:

- [RecipeMapFrontend](https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/gregtech/api/recipe/RecipeMapFrontend.java)
- [UIHelper](https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/gregtech/common/gui/modularui/UIHelper.java)
- [GTNEIDefaultHandler](https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/gregtech/nei/GTNEIDefaultHandler.java)
- [DistillationTowerFrontend](https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/gregtech/api/recipe/maps/DistillationTowerFrontend.java)
- [AssemblyLineFrontend](https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/gregtech/api/recipe/maps/AssemblyLineFrontend.java)

`machineUiFor` requires the release, source mod, category name, dimensions and
ingredient slot indices to agree. Identical layouts can share a display name;
distinct ambiguous layouts are rejected. Overlapping slots are rejected because
some frontends replace them with recipe-specific rotating stack lists. Eye of
Harmony also has exported fluid requirements outside its native input slots.
These cases, other releases and non-GT categories retain their exported grid.
No recipe is squeezed into an incompatible native layout.

The snapshot captures static textured widgets. Arbitrary OpenGL callbacks and
recipe-dependent overlays are not translated. Existing recipe metadata remains
in text badges; progress paths are static, not a simulation of machine state.
Ingredients, amounts, chances, groups and exports are unchanged. Both renderers
share `RecipeGrid` for cycling, chooser dialogs, tooltips and navigation. Native
layouts use a shared 48px slot scale and scroll inside the card on narrow screens.

## Stack and tier labels

Item amounts sit bottom-right; fluid amounts are smaller at bottom-left, matching
`FixedPositionedStack.drawFluidAmount`. Both use Minecraft text with a contrasting
outline. Zero-amount inputs display NC at top-left. Output chance badges also sit
top-left, with up to two decimal places. NC/chance use NEI's default `#FDD835`,
verified in `Badge` and `ColorUtils` from NotEnoughItems 2.8.155-GTNH. Alternative
counts are a compact top-right hint with complete accessible labels/tooltips.

Voltage badges use the colours from `GTValues.TIER_COLORS` without text decorations:
MV is gold (`fmt-6`), UV is dark green (`fmt-2`). Dark colours get
a lighter badge surface for legibility. Power calculations are unchanged.
Duration uses a clock badge in the same stats row. Badge hover text explains
tier names, processing time, current, total energy, per-tick power and known
machine-specific requirements. Unrestricted machine voltage ceilings accept
both missing values and MessagePack's `null`, preserving multiblock machine usages.

Small recipes stay in cards up to 550px wide. Larger layouts can span the recipe
row. Fallback grids use a compact arrow column, avoiding a few pixels of needless
horizontal overflow when a large recipe fits a chain card. Decorative source
logos are identified by the template's actual `ui.logo` object and contained
within its background; functional slot/widget coordinates are unchanged.

## Custom quantities

Eye of Harmony stores its real long item counts in `mSpecialItems`, while the
normal GT recipe contains stacks of one. Its frontend reads
`getItemStackToTrueStackSizeMap` for overlays and tooltips. The opt-in adapter also
captures all 43 `EyeOfHarmonyRecipe` records, including true output counts,
solid-mass percentages, fluid quantities, gas requirements and base duration.
Processing rejects duplicate triggers, unexpected NBT and quantities outside
JavaScript's exact integer range.

`recipeFrontendPresentation.ts` lazily loads this release-specific supplement
only when materializing Eye of Harmony recipes, including chain steps. Every
output identity and the complete output sets must agree before it is applied.
It creates new domain recipes without modifying immutable packed assets.
Raw star matter is labelled as an optional boost rather than a zero-amount NC
ingredient. The supplement is shell-cached for offline use. All recipe ingredient
tooltips show exact counts/litres and output chances; custom notes add solid mass
and total-item information where NEI supplies it.

Source: [EyeOfHarmonyFrontend](https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/tectech/recipe/EyeOfHarmonyFrontend.java),
[EyeOfHarmonyRecipeStorage](https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/tectech/recipe/EyeOfHarmonyRecipeStorage.java).

## Reproduce

Read `agent-data-export-runbook.md` first. Use a completed, validated disposable
2.9.0 export as input. Setup requires a fresh destination under `.export-work`;
it builds an independent exporter copy and copies only the client resources
needed for startup. Player saves and upstream submodules are not modified.

```sh
python tools/machine-ui-export/setup.py \
  --prepared-export .export-work/2.9.0-direct \
  --output .export-work/ui-snapshot-new
npm run ui:extract -- \
  --instance .export-work/ui-snapshot-new/client-instance \
  --output .export-work/ui-snapshot-new/frontend-layouts.json \
  --java /usr/lib/jvm/java-21-openjdk/bin/java
python tools/machine-ui-export/process.py \
  --snapshot .export-work/ui-snapshot-new/frontend-layouts.json \
  --mods .export-work/ui-snapshot-new/client-instance/.minecraft/mods
npm run ui:atlas
npm run quality
```

The launcher reuses validated cached assets by default; `--download true` permits
missing official hashed launcher assets to be fetched. The adapter runs at the
main menu, writes the snapshot, and exits without loading a world or running the
NESQL recipe export. Runtime logs/snapshots stay private. Run processing before
atlas packing: processing restores originals; packing interns shared UV crops.

Only three public images are needed: the 35 KB atlas and two native slot PNGs.
They are shell-cached for offline use. Original pixels, licences and provenance
are preserved in `assets/source/machine-ui`. No immutable dataset is rebuilt.

## Verification

`tests/machine-ui.test.ts` checks tower ordering, the three-part assembly path,
capacity/release/overlap guards, duplicate-name handling, atlas bounds and tier
formats. Browser checks exercise real machine data, amount/NC/voltage labels,
fallback grids, navigation, responsive containment and the three-image budget:

```sh
npm run test:machine-ui -- <base-url> <playwright-module> [screenshots]
```

Existing catalogue-based browser checks should start at `?page=items`, since the
root URL now opens the landing page.
