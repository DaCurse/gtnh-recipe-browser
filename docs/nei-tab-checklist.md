# NEI tab checklist

Target the pinned GTNH 2.9.0-RC-2, 2.9.0, and 2.9.1 clients. Finish the runtime collectors, goods retention,
and validation before launching a single disposable NESQL export. Capture handler
icons, geometry, and metadata in that same run. Compare representative pages
against NEI before activating the generated pack.

| Tab                          | Export checklist                                                                                                       | Browser checklist                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Mob Info                     | Exporter uses NEI's finalized tables, including conditional drops and tooltip text.                                    | Shipped in the activated 2.9.0 pack.                                                                              |
| Infernal Drops               | Configured pools and tier odds implemented. Capture NEI's exact Ender IO mob-container matches.                        | Shipped in the activated 2.9.0 pack. Check Mob Info shortcut and eligible container usages.                       |
| Tinkers' Casting Table       | Read live casting recipes. Retain casts, outputs, fluid amounts, cast consumption and cooling time.                    | Match table icon, cast slot, fluid region and output. Check item and fluid lookups.                               |
| Tinkers' Smeltery Melting    | Read live melting recipes, output fluid volumes, input alternatives and temperatures.                                  | Match melting handler icon, ingredient slot, tank and temperature. Check molten-fluid Recipes.                    |
| Alchemic Chemistry Set       | Read the Blood Magic alchemy handler. Capture reagent slots, orb tier and LP.                                          | Match handler icon and reagent geometry. Check orb and ingredient Usages.                                         |
| Calcinator                   | Read ReagentRegistry.itemToReagentMap and preserve the reagent stack, amount and matching container NBT.               | Match handler icon and actual ingredient/output locations.                                                        |
| Blood Altar Crafting         | Capture altar inputs, outputs, minimum tier, LP and consumption rates.                                                 | Match altar icon and handler layout. Check tier metadata and exact output identity.                               |
| Shaped Orb Crafting          | Extract the native shaped recipe, including empty slots, alternatives and orb requirements.                            | Match the shaped grid and catalyst. Check recipes with multiple valid orbs.                                       |
| GT Material Tools            | Capture the native NEI Custom Diagram scenes and exact directional matcher. Retain tool NBT variants and icons.        | Render through the shared diagram renderer. Check variant matching and native labels.                             |
| GT Material Parts            | Capture native scenes, grouped parts and exact directional matcher. Retain every referenced item/fluid.                | Render through the shared diagram renderer. Check categories and related materials.                               |
| Botania Mana Pool            | Capture conversion inputs, outputs and mana costs or restrictions.                                                     | Match the pool handler's icon, slots and mana indicator.                                                          |
| Botania Petal Apothecary     | Capture petal recipes, water/seed requirements and ingredient alternatives.                                            | Match the apothecary layout and tooltip requirements.                                                             |
| Botania Runic Altar          | Capture ordered display slots, mana cost, catalysts and outputs.                                                       | Match altar layout and distinguish catalysts from consumed items.                                                 |
| Botania Pure Daisy           | Import all six native conversions and retain exact input alternatives, including placed Water.                         | Shipped in the activated 2.9.0 pack.                                                                              |
| Botania Elven Trade          | Capture multiset inputs and the output exposed by the pinned handlers.                                                 | Match portal layout and check each trade direction.                                                               |
| Botania Brewery              | Capture recipe inputs, vessel variants, mana and resulting brew NBT.                                                   | Match brewery icon and vessel placement.                                                                          |
| Botania Floating Flowers     | Query the native handler per floating special flower. It builds the recipe from the flower NBT on demand.              | Check both directions and preserve the flower's NBT through the conversion.                                       |
| Lexica Botania               | Export item-to-entry mappings and displayed recipe references from the lexicon handler.                                | Show the lexicon entry and its recipe links.                                                                      |
| Thaumcraft Crucible Crafting | Audit existing NESQL crucible recipes against the native handler. Preserve catalyst alternatives, aspects and amounts. | Use the native Crucible icon and show required aspects in handler order. Avoid duplicating the ordinary category. |

Use the actual in-game labels and explanation text. For each new handler, verify
Recipes and Usages independently, including native catalyst behavior. Check
desktop and mobile layouts and run the full pack verification before activation.

The optional `--nei-handlers true` UI snapshot captures the registered NEI tab
icons, labels, dimensions, textures, slot coordinates and exact NBT alternatives
for six Botania handlers. This mode joins a disposable local world and waits
for the NEI item list before capturing slots. NEI uses that list to expand
wildcard metadata into its real variants. The GTNH 2.9.0 client produced 165 Mana
Infusion, 44 Petal Apothecary, 48 Runic Altar, 6 Pure Daisy, 11 Elven Trade and
21 Botanical Brewery pages. Mana costs come from the cached Mana Infusion,
Runic Altar and Brewery pages.

The Petal Apothecary and Runic Altar append a finishing ingredient in the center
slot. The snapshot records that slot separately so canonical goods conversion
can treat the renamed “Any Seed” display stack as a requirement. Mana Infusion
exposes alchemy and conjuration catalyst blocks through NEI's other slots and
includes them in its native Usages matcher. The existing NESQL catalogue lacks
some exact Botania stack alternatives, including Forestry bees with specific
genomes. Retain these stacks through the live exporter before building the
combined pack.

For the Pure Daisy preview, pass `--nei-snapshot <snapshot.json>` to
`export:process` with the GTNH 2.9.0 export session. This adds the captured
pages before processor retention so catalogue lookup can resolve the placed
Water input. The panel uses `pureDaisyOverlay.png` from Botania 1.13.42-GTNH.
When Forge links an input block to a registered fluid, the fluid also opens
the same Usages record. The recipe slot preserves the block and its tooltip
states that it needs to be placed.

Pass `--capture-nei-handlers` to the direct export to collect and retain exact
items and fluids from the native Botania, Blood Magic and Tinkers' recipe
handlers and both GT material diagram generators. The orchestrator passes the
capture to the processor automatically. Legacy UI captures import Pure Daisy
only. Validate each game's live capture and compare the browser layouts against
NEI, including the seed and Livingrock finishers, the casting fluid region and
material diagrams with NBT-bearing tools.

TConstruct 1.14.118 (RC2) and 1.14.123 expose casting and melting tanks through
cached recipe draw elements. TConstruct 1.14.124 exposes them as NEI positioned
stacks. The collector normalizes both APIs to the same fluid identity, amount
and bounds.

Regenerate the recipe backgrounds with
`python tools/machine-ui-export/native-overlays.py --mods <pinned-client-mods>`.
The extractor uses each handler's draw rectangle. The palette's flat panel
colour is transparent so the browser's existing Shadow UI panel shows underneath.
The source pixels match across the three pinned clients. The Elven Trade portal uses the first frame of Botania's animated block texture at the bounds drawn by NEI.
