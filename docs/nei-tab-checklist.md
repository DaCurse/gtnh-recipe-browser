# NEI tab checklist

Target the pinned GTNH 2.9.0 client. Finish the runtime collectors, goods retention,
and validation before launching a single disposable NESQL export. Capture handler
icons, geometry, and metadata in that same run. Compare representative pages
against NEI before activating the generated pack.

| Tab                          | Export checklist                                                                                                           | Browser checklist                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Mob Info                     | NESQL mob tables, portraits, drops, and catalyst implemented                                                               | Local preview verified. Activate with the combined pack.                                                          |
| Infernal Drops               | Configured pools and tier odds implemented. Capture NEI's exact Ender IO mob-container matches.                            | Local preview verified for drop items and sword catalyst. Check Mob Info shortcut and eligible container usages.  |
| Tinkers' Casting Table       | Read live casting recipes. Retain casts, outputs, fluid amounts, cast consumption and cooling time.                        | Match table icon, cast slot, fluid region and output. Check item and fluid lookups.                               |
| Tinkers' Smeltery Melting    | Read live melting recipes, output fluid volumes, input alternatives and temperatures.                                      | Match melting handler icon, ingredient slot, tank and temperature. Check molten-fluid Recipes.                    |
| Alchemic Chemistry Set       | Read the Blood Magic alchemy handler. Capture reagent slots, orb tier and LP.                                              | Match handler icon and reagent geometry. Check orb and ingredient Usages.                                         |
| Calcinator                   | Capture item and Demon Will inputs or requirements as exposed by the pinned handler, with outputs and processing metadata. | Match handler icon and actual ingredient/output locations.                                                        |
| Blood Altar Crafting         | Capture altar inputs, outputs, minimum tier, LP and consumption rates.                                                     | Match altar icon and handler layout. Check tier metadata and exact output identity.                               |
| Shaped Orb Crafting          | Extract the native shaped recipe, including empty slots, alternatives and orb requirements.                                | Match the shaped grid and catalyst. Check recipes with multiple valid orbs.                                       |
| GT Material Tools            | Capture the native NEI Custom Diagram scenes and exact directional matcher. Retain tool NBT variants and icons.            | Render through the shared diagram renderer. Check variant matching and native labels.                             |
| GT Material Parts            | Capture native scenes, grouped parts and exact directional matcher. Retain every referenced item/fluid.                    | Render through the shared diagram renderer. Check categories and related materials.                               |
| Botania Mana Pool            | Capture conversion inputs, outputs and mana costs or restrictions.                                                         | Match the pool handler's icon, slots and mana indicator.                                                          |
| Botania Petal Apothecary     | Capture petal recipes, water/seed requirements and ingredient alternatives.                                                | Match the apothecary layout and tooltip requirements.                                                             |
| Botania Runic Altar          | Capture ordered display slots, mana cost, catalysts and outputs.                                                           | Match altar layout and distinguish catalysts from consumed items.                                                 |
| Botania Pure Daisy           | Capture block/metadata conversions and duration.                                                                           | Match Pure Daisy icon and input/output placement.                                                                 |
| Botania Elven Trade          | Capture multiset inputs and all outputs.                                                                                   | Match portal layout and check multi-output trades.                                                                |
| Botania Brewery              | Capture recipe inputs, vessel variants, mana and resulting brew NBT.                                                       | Match brewery icon and vessel placement.                                                                          |
| Other Botania handlers       | Inventory the live registrations, including Floating Flowers and Lexica. Determine which pages carry recipe data.          | Add the applicable recipe pages and check navigation for informational pages.                                     |
| Thaumcraft Crucible Crafting | Audit existing NESQL crucible recipes against the native handler. Preserve catalyst alternatives, aspects and amounts.     | Use the native Crucible icon and show required aspects in handler order. Avoid duplicating the ordinary category. |

Use the actual in-game labels and explanation text. For each new handler, verify
Recipes and Usages independently, including native catalyst behavior. Check
desktop and mobile layouts and run the full pack verification before activation.
