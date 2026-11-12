# GTNH 2.9.0 questbook export shopping list

All 27020 native stack references (8402 distinct item/fluid/ore/NBT identities) are export inputs, including requirements, rewards, choices, chapter icons and quest icons.

- quest-icon: 3815 references
- chapter-icon: 46 references
- requirement: 9925 references
- reward: 9420 references
- decoration: 3814 references

Every valid stack goes through the existing game item/fluid/ore factories. Wildcards expand to registered subitems. Invalid game references must be recorded explicitly; never substitute unrelated metadata or draw replacement assets.

## Missing before this export (300 distinct references)

| Registry ID | Damage | NBT | Reason | Uses | Locations |
| --- | ---: | --- | --- | ---: | --- |
| minecraft:potion | 8199 | No | missing-metadata-variant | 1 | requirement: Stable Division Sigil |
| minecraft:potion | 8203 | No | missing-metadata-variant | 1 | requirement: Stable Division Sigil |
| Thaumcraft:blockLootCrate | 1 | No | missing-registry-item | 1 | quest-icon: The Dark Realm |
| Thaumcraft:blockLootCrate | 2 | No | missing-registry-item | 2 | reward: The Power of Creation; reward: A Reward |
| Natura:BerryBush | 1 | No | missing-registry-item | 2 | reward: §9§lBerry Medley; requirement: §9§lCollecting Some Berries |
| Natura:BerryBush | 0 | No | missing-registry-item | 2 | reward: §9§lBerry Medley; requirement: §9§lCollecting Some Berries |
| Natura:BerryBush | 2 | No | missing-registry-item | 2 | reward: §9§lBerry Medley; reward: §9§lCollecting Some Berries |
| Natura:BerryBush | 3 | No | missing-registry-item | 2 | reward: §9§lBerry Medley; reward: §9§lCollecting Some Berries |
| Natura:BerryBush | 12 | No | missing-registry-item | 1 | quest-icon: §9§lCollecting Some Berries |
| appliedenergistics2:item.ItemMultiPart | 301 | No | missing-metadata-variant | 1 | requirement: Alpha and Omega |
| appliedenergistics2:item.ItemMultiMaterial | 65 | No | missing-metadata-variant | 1 | requirement: Cards for AE2 Nerds! |
| appliedenergistics2:item.ToolAdvancedNetworkTool | 0 | No | missing-registry-item | 2 | quest-icon: Need More Information?; requirement: Need More Information? |
| appliedenergistics2:item.ItemMultiMaterial | 48 | Yes | missing-metadata-variant | 1 | requirement: Quantum Bridging Your Outposts |
| appliedenergistics2:item.ItemMultiMaterial | 48 | No | missing-metadata-variant | 2 | quest-icon: Quantum Entangled Singularities; requirement: Quantum Entangled Singularities |
| minecraft:flowing_water | 0 | No | missing-registry-item | 1 | quest-icon: Electrolyzing Water |
| MagicBees:miscResources | 1 | No | missing-metadata-variant | 2 | quest-icon: Aromatic Lump; requirement: Aromatic Lump |
| IC2:fluidSuperheatedSteam | 0 | No | missing-registry-item | 2 | quest-icon: CBD Into Steam; quest-icon: IC2 Nuke Variations |
| dreamcraft:Charcoal | 0 | No | missing-registry-item | 1 | requirement: Coal Or Charcoal |
| IC2:fluidDistilledWater | 0 | No | missing-registry-item | 1 | quest-icon: Mass Distilled Water |
| Ztones:tile.zythBlock | 32767 | No | missing-metadata-variant | 1 | quest-icon: §a§lBuilding with Style |
| BinnieCore:storage | 0 | No | missing-registry-item | 2 | quest-icon: §c§lChests Had Quite the Glow-up!; requirement: §c§lChests Had Quite the Glow-up! |
| BinnieCore:storage | 1 | No | missing-registry-item | 1 | requirement: §c§lChests Had Quite the Glow-up! |
| BinnieCore:storage | 2 | No | missing-registry-item | 1 | requirement: §c§lChests Had Quite the Glow-up! |
| BinnieCore:storage | 3 | No | missing-registry-item | 1 | requirement: §c§lChests Had Quite the Glow-up! |
| BinnieCore:storage | 4 | No | missing-registry-item | 2 | reward: §c§lChests Had Quite the Glow-up!; requirement: §c§lChests Had Quite the Glow-up! |
| BinnieCore:storage | 5 | No | missing-registry-item | 1 | requirement: §c§lChests Had Quite the Glow-up! |
| ForgeMicroblock:microblock | 513 | Yes | missing-metadata-variant | 1 | requirement: §c§lEven small Glowstone shines bright |
| chisel:technical3 | 0 | No | missing-registry-item | 1 | requirement: §a§lFun Party Blocks |
| ExtraUtilities:greenscreen | 32767 | No | missing-metadata-variant | 1 | quest-icon: §a§lLet it Glow! |
| modernmarkings:tile.wall_marking_warning_danger | 0 | No | missing-registry-item | 1 | requirement: Marking Your Base |
| Botany:ceramicBrick | 16387 | Yes | missing-registry-item | 1 | quest-icon: §a§lMortar and Tiles |
| Botany:ceramicBrick | 15163 | No | missing-registry-item | 1 | requirement: §a§lMortar and Tiles |
| Botany:ceramicBrick | 257 | No | missing-registry-item | 1 | reward: §a§lMortar and Tiles |
| Botany:ceramicBrick | 16387 | Yes | missing-registry-item | 1 | quest-icon: §a§lTile Patterns |
| Botany:ceramicBrick | 0 | Yes | missing-registry-item | 1 | requirement: §a§lTile Patterns |
| Botany:ceramicBrick | 0 | Yes | missing-registry-item | 1 | requirement: §a§lTile Patterns |
| Botany:ceramicBrick | 2827 | Yes | missing-registry-item | 1 | reward: §a§lTile Patterns |
| Botany:ceramicBrick | 16387 | Yes | missing-registry-item | 1 | reward: §a§lTile Patterns |
| Botany:itemFlower | 0 | Yes | missing-registry-item | 1 | reward: §2§lTileworker |
| Botany:itemFlower | 0 | Yes | missing-registry-item | 1 | reward: §2§lTileworker |
| Botany:itemFlower | 0 | Yes | missing-registry-item | 1 | reward: §2§lTileworker |
| dreamcraft:MedalDerp | 0 | No | missing-registry-item | 1 | quest-icon: §4§l§nAn Offering To The Gods |
| dreamcraft:Nothing | 0 | No | missing-registry-item | 1 | reward: §6§l§nSee You Next Time! |
| dreamcraft:MedalBuilder | 0 | No | missing-registry-item | 2 | quest-icon: §4§l§nSimulating a Solar System; quest-icon: Optional Tier 1 Fusion |
| gregtech:gt.blockmachines | 1145 | No | missing-metadata-variant | 1 | quest-icon: §6§l§nThe Factory Must Grow! |
| tectech:Eye of Harmony Renderer | 0 | Yes | missing-registry-item | 1 | reward: §6§l§nThe Factory Must Grow! |
| lootgames:ms_activator | 0 | No | missing-registry-item | 1 | reward: §6§l§nThe Factory Must Grow! |
| harvestcraft:market | 0 | No | missing-registry-item | 1 | quest-icon: Chef Training |
| TwilightForest:item.magicMap | 0 | No | missing-registry-item | 1 | quest-icon: Pollination Buddies |
| Botania:flower | 32767 | No | missing-metadata-variant | 1 | requirement: The Roots of Magic |
| Thaumcraft:ItemSpawnerEgg | 9 | No | missing-registry-item | 1 | reward: An Appropriate Weapon |
| EMT:ElectricHoeGrowth | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Electric Hoe-ing |
| EMT:ElectricScribingTools | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Rechargeable Scribing Tools |
| EMT:electricCloud | 0 | No | missing-registry-item | 2 | quest-icon: Sparking Nitor...?; requirement: Sparking Nitor...? |
| gendustry:IndustrialGrafter | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Industrial Grafter |
| Forestry:phosphoricIodineCapsule | 0 | No | missing-registry-item | 1 | requirement: THE RAINMAKER |
| EMT:QuantumWing | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Angel Wings - Ultra Force! |
| EMT:QuantumWing | 32767 | No | missing-metadata-variant | 1 | requirement: Angel Wings - Ultra Force! |
| EMT:ElectricBootsTraveller | 1 | Yes | missing-metadata-variant | 2 | quest-icon: Better Boots with a little pizzazz; quest-icon: Trigger: Boots of the Traveller Skip |
| EMT:ElectricBootsTraveller | 32767 | No | missing-metadata-variant | 2 | requirement: Better Boots with a little pizzazz; requirement: Trigger: Boots of the Traveller Skip |
| thaumicboots:item.ItemElectricVoid | 32767 | No | missing-metadata-variant | 2 | requirement: Better Boots with a little pizzazz; requirement: Trigger: Boots of the Traveller Skip |
| ProjRed\|Expansion:projectred.expansion.jetpack | 0 | No | missing-metadata-variant | 2 | quest-icon: Electrotine Jetpack; requirement: Refill Your Jetpack |
| minecraft:spawn_egg | 55 | No | missing-metadata-variant | 1 | reward: Jetpack v.0.1 Alpha |
| Automagy:blockThaumostaticSpire | 0 | No | missing-registry-item | 1 | quest-icon: Long Distance Power Delivery |
| GraviSuite:relocator | 1 | Yes | missing-metadata-variant | 2 | quest-icon: Relocator; requirement: Relocator |
| EMT:NanosuitWing | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Secret-Angel-Assassin |
| EMT:NanosuitWing | 32767 | No | missing-metadata-variant | 1 | requirement: Secret-Angel-Assassin |
| EMT:NanoBootsTraveller | 1 | Yes | missing-metadata-variant | 2 | quest-icon: Walk all over you; quest-icon: Trigger: Electric Boots of the Traveller Skip |
| EMT:NanoBootsTraveller | 32767 | No | missing-metadata-variant | 2 | requirement: Walk all over you; requirement: Trigger: Electric Boots of the Traveller Skip |
| thaumicboots:item.ItemNanoVoid | 32767 | No | missing-metadata-variant | 2 | requirement: Walk all over you; requirement: Trigger: Electric Boots of the Traveller Skip |
| EMT:QuantumBootsTraveller | 1 | Yes | missing-metadata-variant | 2 | quest-icon: Walking across the stars; quest-icon: Trigger: Nano Boots of the Traveller Skip |
| EMT:QuantumBootsTraveller | 32767 | No | missing-metadata-variant | 2 | requirement: Walking across the stars; requirement: Trigger: Nano Boots of the Traveller Skip |
| thaumicboots:item.ItemQuantumVoid | 32767 | No | missing-metadata-variant | 2 | requirement: Walking across the stars; requirement: Trigger: Nano Boots of the Traveller Skip |
| LogisticsPipes:item.brokenItem | 0 | No | missing-registry-item | 1 | quest-icon: Troubleshooting... |
| HardcoreEnderExpansion:charm | 2 | No | missing-registry-item | 3 | quest-icon: Charm Master; requirement: Charm Master; reward: Charms |
| HardcoreEnderExpansion:charm | 5 | No | missing-registry-item | 2 | requirement: Charm Master; reward: Charms |
| HardcoreEnderExpansion:charm | 8 | No | missing-registry-item | 2 | requirement: Charm Master; reward: Charms |
| HardcoreEnderExpansion:charm | 11 | No | missing-registry-item | 2 | requirement: Charm Master; reward: Charms |
| HardcoreEnderExpansion:charm | 14 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 18 | No | missing-registry-item | 2 | requirement: Charm Master; reward: Charms |
| HardcoreEnderExpansion:charm | 21 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 24 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 73 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 27 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 30 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 36 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 43 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 76 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 50 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 53 | No | missing-registry-item | 2 | requirement: Charm Master; quest-icon: Master Grinder |
| HardcoreEnderExpansion:charm | 56 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 64 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 70 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 79 | No | missing-registry-item | 1 | requirement: Charm Master |
| HardcoreEnderExpansion:charm | 55 | No | missing-registry-item | 1 | reward: Charm Master |
| HardcoreEnderExpansion:curse_amulet | 0 | No | missing-registry-item | 2 | quest-icon: Curse Amulet; requirement: Curse Amulet |
| HardcoreEnderExpansion:essence_altar | 1 | No | missing-metadata-variant | 2 | quest-icon: Dragon Essence Altar; requirement: Dragon Essence Altar |
| HardcoreEnderExpansion:enhanced_ender_pearl | 0 | Yes | missing-registry-item | 1 | quest-icon: Enderpearl Enchantments |
| HardcoreEnderExpansion:dungeon_puzzle | 13 | No | missing-registry-item | 1 | quest-icon: Hot Puzzle |
| HardcoreEnderExpansion:infestation_remedy | 0 | No | missing-registry-item | 1 | quest-icon: Infestation Remedy |
| HardcoreEnderExpansion:infestation_remedy | 0 | Yes | missing-registry-item | 1 | requirement: Infestation Remedy |
| minecraft:end_portal_frame | 0 | No | missing-registry-item | 1 | quest-icon: Is This the End? No, it's the END Dimension |
| HardcoreEnderExpansion:potion_of_instability | 0 | No | missing-registry-item | 2 | quest-icon: Potion of Instability; requirement: Potion of Instability |
| HardcoreEnderExpansion:potion_of_purity | 0 | Yes | missing-registry-item | 1 | quest-icon: Potion of Purity |
| HardcoreEnderExpansion:potion_of_purity | 0 | No | missing-registry-item | 1 | requirement: Potion of Purity |
| HardcoreEnderExpansion:enhanced_tnt | 0 | Yes | missing-registry-item | 1 | quest-icon: TNT Enchantments |
| HardcoreEnderExpansion:cinder | 0 | No | missing-registry-item | 1 | requirement: Visit the Fiery Island |
| Forestry:crate | 0 | No | missing-registry-item | 1 | requirement: A Chest for Bees |
| BinnieCore:fieldKit | 0 | No | missing-metadata-variant | 1 | quest-icon: Analyze Them All |
| gendustry:Waste | 0 | No | missing-registry-item | 1 | reward: Bee Slurry, the Breakfast of, Well, Weirdos |
| gadomancy:ItemCreativeNode | 5 | No | missing-registry-item | 1 | quest-icon: Ghetto Biome Changing |
| Forestry:habitatLocator | 0 | No | missing-registry-item | 2 | quest-icon: Humid and Warm?; requirement: Humid and Warm? |
| Genetics:masterRegistry | 0 | No | missing-registry-item | 2 | quest-icon: Master Registry; reward: Master Registry |
| Genetics:registry | 0 | No | missing-registry-item | 2 | quest-icon: Registry; requirement: Registry |
| Genetics:analyst | 0 | No | missing-registry-item | 2 | quest-icon: Top-Tier Analyzer; requirement: Top-Tier Analyzer |
| minecraft:bedrock | 0 | No | missing-registry-item | 1 | quest-icon: Journey to the Center of the Earth |
| witchery:babashat | 0 | No | missing-registry-item | 2 | quest-icon: Kill Baba Yaga; requirement: Be a Vampire; Dress Like a Fancy Person |
| witchery:ingredient | 141 | No | missing-metadata-variant | 4 | quest-icon: Kill Lord of Tormentum; requirement: Flame Imp; quest-icon: Lord of Torment; requirement: Lord of Torment |
| witchery:quiverofmog | 0 | No | missing-registry-item | 2 | quest-icon: Kill Mog and Gulg; requirement: Be a Vampire; Dress Like a Fancy Person |
| JABBA:upgradeCore | 10 | No | missing-metadata-variant | 1 | quest-icon: Killing: Evolved |
| miscutils:GTPP.bauble.fireprotection.0.name | 0 | No | missing-registry-item | 3 | reward: Killing: Evolved; quest-icon: §6§lHot Hot Hot!; reward: §6§lHot Hot Hot! |
| witchery:ingredient | 45 | No | missing-metadata-variant | 1 | requirement: The Power of Infinity |
| HardcoreEnderExpansion:spawn_eggs | 5 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Fire Golem) |
| minecraft:spawn_egg | 502 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Husk) |
| minecraft:flowing_lava | 0 | No | missing-registry-item | 2 | quest-icon: Time to Kill (Lava Monster); quest-icon: §2§lTime to Dry Out the Nether |
| HardcoreEnderExpansion:spawn_eggs | 11 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Louse) |
| TwilightForest:item.tfspawnegg | 191 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Penguin) |
| etfuturum:rabbit_foot | 0 | No | missing-registry-item | 1 | reward: Time to Kill (Rabbit) |
| HardcoreEnderExpansion:spawn_eggs | 6 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Scorching Lens) |
| TwilightForest:item.tfspawnegg | 195 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Squirrel) |
| minecraft:spawn_egg | 503 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Stray) |
| TwilightForest:item.tfspawnegg | 186 | No | missing-metadata-variant | 1 | quest-icon: Time to Kill (Wraith) |
| HardcoreEnderExpansion:spawn_eggs | 12 | No | missing-metadata-variant | 1 | quest-icon: Time to kill (Haunted Miners) |
| BloodArsenal:vampire_cape | 0 | No | missing-registry-item | 2 | quest-icon: A Dark Path to Travel Down...; reward: A Dark Path to Travel Down... |
| witchery:gurdleofgulg | 0 | No | missing-registry-item | 1 | requirement: Be a Vampire; Dress Like a Fancy Person |
| witchery:brew.fuel | 0 | No | missing-registry-item | 2 | quest-icon: Don't Shake it Too Much; requirement: Don't Shake it Too Much |
| OpenBlocks:grave | 0 | No | missing-registry-item | 1 | quest-icon: Early Bird Gets the...Nightmare? |
| minecraft:spawn_egg | 6413 | No | missing-metadata-variant | 1 | quest-icon: Flame Imp |
| witchery:ingredient | 41 | No | missing-metadata-variant | 2 | quest-icon: Flying OINKment; requirement: Flying OINKment |
| witchery:ingredient | 93 | No | missing-metadata-variant | 3 | quest-icon: Happenstance Oil; requirement: Happenstance Oil; requirement: Seer Stone or Summon the Witches |
| minecraft:spawn_egg | 6412 | No | missing-metadata-variant | 1 | reward: Lord of Torment |
| witchery:crittersnare | 3 | No | missing-metadata-variant | 1 | requirement: Mad Science is the Best Science |
| witchery:ingredient | 9 | No | missing-metadata-variant | 3 | chapter-icon: Look to the Edges; quest-icon: Nimbus 1999; requirement: Nimbus 1999 |
| witchery:crittersnare | 0 | No | missing-metadata-variant | 2 | quest-icon: PETA Approved*; requirement: PETA Approved* |
| witchery:ingredient | 94 | No | missing-metadata-variant | 2 | quest-icon: Seer Stone or Summon the Witches; requirement: Seer Stone or Summon the Witches |
| witchery:brewbottle | 0 | Yes | missing-registry-item | 1 | quest-icon: The Easy Way to Change Biomes |
| witchery:biomenote | 32767 | No | missing-metadata-variant | 1 | requirement: The Easy Way to Change Biomes |
| minecraft:end_portal | 0 | No | missing-registry-item | 2 | quest-icon: The Spirit World - Dream; quest-icon: The Spirit World - Nightmare |
| gtnhlanth:particle | 3 | No | missing-registry-item | 1 | reward: §6§lA Beginner's Guide to Particle Physics |
| IC2:itemArmorNanoChestplate | 32767 | No | missing-metadata-variant | 2 | requirement: Advanced Nano Chestplate; requirement: Carbon Skin |
| minecraft:command_block | 0 | No | missing-registry-item | 1 | quest-icon: §9§lAll Alone in the Night |
| EMT:itemArmorQuantumChestplate | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Angel Wings - Combine! |
| kubatech:kubaitems | 0 | No | missing-metadata-variant | 1 | reward: §4§l§nDraconic Evolution |
| TConstruct:woodPattern | 23 | No | missing-metadata-variant | 2 | requirement: §2§lFiery Bowstring; requirement: §c§lWooden Crossbow |
| GraviSuite:graviChestPlate | 1 | Yes | missing-metadata-variant | 2 | chapter-icon: ...Without Dying; quest-icon: Gravi Suit |
| IC2:itemArmorQuantumChestplate | 32767 | Yes | missing-metadata-variant | 1 | requirement: Gravi Suit |
| GraviSuite:ultimateLappack | 32767 | Yes | missing-metadata-variant | 1 | requirement: Gravi Suit |
| GraviSuite:graviChestPlate | 32767 | Yes | missing-metadata-variant | 1 | requirement: Gravi Suit |
| BuildCraft\|Energy:blockOil | 0 | No | missing-registry-item | 1 | quest-icon: §2§lHello Baron, How's Your Black Gold Today? |
| TConstruct:woodPattern | 24 | No | missing-metadata-variant | 2 | requirement: §2§lMagnalium Crossbow Bolts; requirement: §c§lWooden Bolts |
| TConstruct:woodPattern | 10 | No | missing-metadata-variant | 1 | requirement: §6§lObtaining Ender Pearls |
| miscutils:itemHatTinFoil | 0 | No | missing-registry-item | 1 | reward: §c§lSafety First |
| TConstruct:woodPattern | 1 | No | missing-metadata-variant | 1 | requirement: §c§lWooden Bolts |
| TConstruct:Pattern | 1 | No | missing-metadata-variant | 1 | requirement: §c§lWooden Crossbow |
| TConstruct:woodPattern | 15 | No | missing-metadata-variant | 1 | requirement: §c§lWooden Crossbow |
| TConstruct:CrossbowLimbPart | 0 | No | missing-metadata-variant | 1 | requirement: §c§lWooden Crossbow |
| TConstruct:CrossbowBodyPart | 0 | No | missing-metadata-variant | 1 | requirement: §c§lWooden Crossbow |
| TConstruct:arrowhead | 3 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Bow |
| TConstruct:BowLimbPart | 0 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Bow |
| TConstruct:knifeBlade | 3 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Flint Throwing Knife |
| thaumicboots:item.ItemElectricMeteor | 32767 | No | missing-metadata-variant | 1 | requirement: Trigger: Boots of the Traveller Skip |
| thaumicboots:item.ItemElectricComet | 32767 | No | missing-metadata-variant | 1 | requirement: Trigger: Boots of the Traveller Skip |
| thaumicboots:item.ItemNanoMeteor | 32767 | No | missing-metadata-variant | 1 | requirement: Trigger: Electric Boots of the Traveller Skip |
| thaumicboots:item.ItemNanoComet | 32767 | No | missing-metadata-variant | 1 | requirement: Trigger: Electric Boots of the Traveller Skip |
| lootgames:LootGamesDungeonWall | 32767 | No | missing-registry-item | 1 | requirement: Trigger: Loot Game |
| lootgames:LootGamesDungeonLight | 32767 | No | missing-registry-item | 1 | requirement: Trigger: Loot Game |
| thaumicboots:item.ItemQuantumMeteor | 32767 | No | missing-metadata-variant | 1 | requirement: Trigger: Nano Boots of the Traveller Skip |
| thaumicboots:item.ItemQuantumComet | 32767 | No | missing-metadata-variant | 1 | requirement: Trigger: Nano Boots of the Traveller Skip |
| IC2:itemNightvisionGoggles | 32767 | No | missing-metadata-variant | 2 | quest-icon: Trigger: Nightvision Goggle Skip; requirement: Seeing Things Brighter |
| IC2:itemArmorQuantumChestplate | 27 | No | missing-metadata-variant | 2 | quest-icon: Trigger: Quantum Armor Skip; requirement: Trigger: Quantum Armor Skip |
| IC2:itemArmorQuantumLegs | 27 | No | missing-metadata-variant | 1 | requirement: Trigger: Quantum Armor Skip |
| GalacticraftAmunRa:item.itemShuttle | 32767 | No | missing-metadata-variant | 2 | requirement: Trigger: Rocket Shuttle Skip; requirement: A T0 Rocket? What? |
| ExtraUtilities:cursedearthside | 0 | No | missing-registry-item | 2 | quest-icon: Cursed Earth; requirement: Cursed Earth |
| TwilightForest:item.emptyMagicMap | 0 | No | missing-registry-item | 2 | quest-icon: Magic Map; reward: Magic Map |
| TwilightForest:tile.TFPlant | 13 | No | missing-metadata-variant | 1 | quest-icon: Magical Plants |
| TwilightForest:tile.TFPortal | 0 | No | missing-registry-item | 1 | quest-icon: Searching for Answers |
| Thaumcraft:blockAiry | 0 | No | missing-registry-item | 1 | quest-icon: The Choice... |
| TwilightForest:tile.TFMagicLogSpecial | 0 | No | missing-registry-item | 2 | quest-icon: Timewood Tree; requirement: Timewood Tree |
| dreamcraft:BloodyThaumium | 0 | No | missing-registry-item | 2 | quest-icon: Blood Altar Tier 3; requirement: Blood Altar Tier 3 |
| dreamcraft:BloodyVoid | 0 | No | missing-registry-item | 2 | quest-icon: Blood Altar Tier 4; requirement: Blood Altar Tier 4 |
| AWWayofTime:boundHelmet | 0 | No | missing-registry-item | 1 | quest-icon: Bound Armor |
| AWWayofTime:boundHelmet | 0 | Yes | missing-registry-item | 1 | requirement: Bound Armor |
| AWWayofTime:boundPlate | 0 | Yes | missing-registry-item | 1 | requirement: Bound Armor |
| AWWayofTime:boundLeggings | 0 | Yes | missing-registry-item | 1 | requirement: Bound Armor |
| AWWayofTime:boundBoots | 0 | Yes | missing-registry-item | 1 | requirement: Bound Armor |
| AWWayofTime:itemComplexSpellCrystal | 0 | No | missing-registry-item | 1 | requirement: Complex Spell System |
| AWWayofTime:daggerOfSacrifice | 0 | No | missing-registry-item | 2 | quest-icon: Dagger of Sacrifice; requirement: Dagger of Sacrifice |
| BloodArsenal:glass_sacrificial_dagger | 0 | Yes | missing-registry-item | 2 | quest-icon: Glass Sacrificial Dagger; requirement: Glass Sacrificial Dagger |
| AWWayofTime:bloodMagicIncenseItem | 1 | No | missing-metadata-variant | 1 | requirement: Incense Crucible |
| AWWayofTime:bloodMagicIncenseItem | 4 | No | missing-metadata-variant | 2 | quest-icon: Jeremy Fragrance; requirement: Jeremy Fragrance |
| AWWayofTime:bloodMagicIncenseItem | 3 | No | missing-metadata-variant | 2 | reward: Jeremy Fragrance; requirement: Smelling Even Better |
| AWWayofTime:weakBindingAgent | 0 | No | missing-registry-item | 2 | requirement: Potion Catalysts; requirement: Potion: Flight Mode |
| AWWayofTime:weakFillingAgent | 0 | No | missing-registry-item | 2 | quest-icon: Refilling Your Potions; requirement: Refilling Your Potions |
| AWWayofTime:bloodMagicIncenseItem | 2 | No | missing-metadata-variant | 3 | quest-icon: Smelling Even Better; reward: Smelling Even Better; requirement: Smelling Even Better |
| AWWayofTime:blankSpell | 0 | No | missing-registry-item | 3 | quest-icon: Some Examples; requirement: Some Examples; reward: Spell Foci |
| AWWayofTime:activationCrystal | 0 | No | missing-metadata-variant | 2 | quest-icon: Starter Key; requirement: Starter Key |
| gregtech:gt.metaitem.01 | 32032 | No | missing-metadata-variant | 1 | quest-icon: Fuel Input Automation |
| dreamcraft:MedalWarp | 0 | No | missing-registry-item | 2 | quest-icon: Optional Tier 2 Fusion; quest-icon: §c§l§nStars, So Many Stars |
| dreamcraft:MedalGTExplosion | 0 | No | missing-registry-item | 2 | quest-icon: Optional Tier 3 Fusion; quest-icon: §4§l§nA Blast to the Past |
| IC2:reactorUraniumSimple | 1 | No | missing-registry-item | 1 | quest-icon: Uranium Basic Nukes |
| OpenComputers:cable | 32767 | No | missing-metadata-variant | 4 | requirement: Computer Case; requirement: Intelligence is the Ability to Adapt to Change; requirement: Mounting Your HDD; quest-icon: Purchase Cables |
| universalsingularities:universal.bigReactors.singularity | 1 | No | missing-registry-item | 1 | quest-icon: Your First Computer |
| GalacticraftCore:tile.treasureChest | 0 | No | missing-registry-item | 1 | quest-icon: A Reward |
| GalacticraftMars:tile.sludge | 0 | No | missing-registry-item | 1 | quest-icon: Bacterial Sludge |
| GalacticraftCore:item.oxygenTankMedFull | 0 | No | missing-metadata-variant | 1 | quest-icon: Bigger Oxygen Tanks |
| GalacticraftMars:tile.cavernVines | 0 | No | missing-registry-item | 1 | quest-icon: Cavernous Vine |
| GalaxySpace:item.Tier4Key | 0 | No | missing-registry-item | 1 | requirement: Ceres Dungeon |
| GalaxySpace:item.Tier6Key | 0 | No | missing-registry-item | 1 | requirement: Enceladus Dungeon |
| miscutils:HydrogenPeroxide | 32767 | No | missing-metadata-variant | 1 | requirement: §9§lHydrazine |
| GalaxySpace:item.Tier5Key | 0 | No | missing-registry-item | 1 | requirement: Io Dungeon |
| GalacticraftCore:item.oxygenTankHeavyFull | 0 | No | missing-metadata-variant | 1 | quest-icon: Large Oxygen Tanks |
| GalacticraftCore:item.oxygenTankHeavyFull | 3000 | No | missing-metadata-variant | 1 | requirement: Large Oxygen Tanks |
| GalacticraftMars:item.key | 0 | No | missing-registry-item | 1 | requirement: Mars Dungeon |
| witchery:mooncharm | 0 | No | missing-registry-item | 1 | quest-icon: Moon Arrival |
| GalacticraftCore:item.key | 0 | No | missing-registry-item | 1 | requirement: Moon Dungeon |
| GalaxySpace:item.Tier8Key | 0 | No | missing-registry-item | 1 | requirement: Pluto Dungeon |
| GalaxySpace:item.Tier7Key | 0 | No | missing-registry-item | 1 | requirement: Proteus Dungeon |
| GalacticraftMars:tile.slimelingEgg | 2 | No | missing-registry-item | 2 | quest-icon: Slimeling; requirement: Slimeling |
| GalacticraftMars:tile.slimelingEgg | 0 | No | missing-registry-item | 1 | requirement: Slimeling |
| GalacticraftMars:tile.slimelingEgg | 1 | No | missing-registry-item | 1 | requirement: Slimeling |
| GalaxySpace:item.Icon | 37 | No | missing-registry-item | 1 | quest-icon: Space Station |
| GalacticraftCore:item.oxygenTankSuperHeavyFull | 0 | No | missing-metadata-variant | 1 | quest-icon: Super Large Oxygen Tanks |
| GalacticraftCore:item.oxygenTankSuperHeavyFull | 4000 | No | missing-metadata-variant | 1 | requirement: Super Large Oxygen Tanks |
| GalacticraftCore:item.oxygenTankUltraHeavyFull | 0 | No | missing-metadata-variant | 1 | quest-icon: Ultra Large Oxygen Tanks |
| GalacticraftCore:item.oxygenTankUltraHeavyFull | 5000 | No | missing-metadata-variant | 1 | requirement: Ultra Large Oxygen Tanks |
| thaumicbases:genericSlab | 7 | No | missing-metadata-variant | 1 | quest-icon: L.E.S.U. Upgrade - EV Tier |
| ThaumicHorizons:focusIllumination | 12 | No | missing-metadata-variant | 1 | reward: L.E.S.U. Upgrade - EV Tier |
| VillageNames:templebook | 0 | No | missing-registry-item | 1 | quest-icon: A Summary of Crossbreeding |
| BiblioCraft:item.RecipeBook | 0 | No | missing-registry-item | 1 | quest-icon: Crop Nutrients |
| IC2:itemArmorRubBoots | 32767 | No | missing-metadata-variant | 1 | requirement: Tools of the Trade 4 - Minimizing Crop-Related Injuries |
| chisel:chisel | 32767 | No | missing-metadata-variant | 1 | requirement: §c§lA Clear View |
| TConstruct:woodPattern | 16 | No | missing-metadata-variant | 1 | requirement: §c§lReinforced X? Unbreakable |
| IC2:itemArmorHazmatChestplate | 64 | No | missing-metadata-variant | 1 | quest-icon: §c§lRepairing Your Hazmat Suit |
| gregtech:gt.GregTech_FluidDisplay | 89 | Yes | missing-registry-item | 1 | quest-icon: §c§lSteam Alternatives |
| minecraft:portal | 0 | No | missing-registry-item | 1 | quest-icon: §c§lTHE NETHER |
| minecraft:spawn_egg | 99 | No | missing-metadata-variant | 1 | reward: §c§lTHE NETHER |
| minecraft:spawn_egg | 97 | No | missing-metadata-variant | 1 | reward: §c§lTHE NETHER |
| TConstruct:ToolForgeBlock | 32767 | No | missing-metadata-variant | 1 | requirement: §c§lTool Forge |
| TConstruct:binding | 31 | No | missing-metadata-variant | 1 | reward: §c§lUpgrade of the Upgrade of the... |
| TConstruct:binding | 8 | No | missing-metadata-variant | 1 | reward: §c§lUpgrade of the Upgrade of the... |
| minecraft:spawn_egg | 54 | No | missing-metadata-variant | 3 | reward: §a§lAll the Finest Cuts of Meat; reward: §9§lBest Crossbow?; reward: §2§lIron Shields |
| minecraft:spawn_egg | 50 | No | missing-metadata-variant | 3 | reward: §a§lAll the Finest Cuts of Meat; reward: §8§lOne Dragon Egg is Not Enough Mr Bond; reward: §2§lStone spear |
| ifu:ifu_buildingKit | 32767 | No | missing-metadata-variant | 1 | requirement: §a§lDivine Rod of the Gods? |
| lootgames:LootGamesMasterBlock | 0 | No | missing-registry-item | 1 | quest-icon: §a§lLoot Games |
| openglasses:openglasses | 7734 | No | missing-metadata-variant | 1 | quest-icon: §a§lWhen All You Have is a Hammer... |
| TConstruct:swordBlade | 3 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Flint Sword |
| TConstruct:wideGuard | 5 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Flint Sword |
| TConstruct:woodPattern | 2 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Tool |
| TConstruct:woodPattern | 4 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Tool |
| TConstruct:woodPattern | 9 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Tool |
| TConstruct:pickaxeHead | 3 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Tool |
| TConstruct:shovelHead | 3 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Tool |
| TConstruct:hatchetHead | 3 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Tool |
| TConstruct:binding | 0 | No | missing-metadata-variant | 1 | requirement: §a§lYour First Tool |
| dreamcraft:MedalEngineer | 0 | No | missing-registry-item | 1 | quest-icon: §5§l§nDreams of Rainbow... Stargates? |
| TwilightForest:item.tfspawnegg | 191 | Yes | missing-metadata-variant | 1 | reward: §5§l§nIntroducing the NAC§r§5§n™§r§5§n§l |
| minecraft:spawn_egg | 506 | Yes | missing-metadata-variant | 1 | reward: §5§l§nNAC§r§5§n™§r§5§n§l: Assembling Package |
| tectech:ForgeOfGodsRenderBlock | 0 | No | missing-registry-item | 1 | quest-icon: §9§l§nA Fork in The Road |
| tectech:Eye of Harmony Renderer | 0 | No | missing-registry-item | 1 | quest-icon: §c§l§nAre you Ready? |
| IC2:itemToolHoe | 26 | No | missing-metadata-variant | 1 | requirement: §2§lAutomated Farmer |
| IC2:itemTreetapElectric | 32767 | No | missing-metadata-variant | 1 | requirement: §2§lAutomated Sticky Resin Farmer |
| personalspace:personalPortal | 0 | No | missing-registry-item | 2 | quest-icon: §5§lPersonal Dimension; reward: §5§lPersonal Dimension |
| bartworks:item.GT_Rockcutter_Item_LV | 37 | No | missing-metadata-variant | 2 | quest-icon: §5§lRock Cutter LV; requirement: §5§lRock Cutter LV |
| ExtraUtilities:magnumTorch | 0 | No | missing-registry-item | 2 | quest-icon: §8§lAdvanced Mob Protection; requirement: §8§lAdvanced Mob Protection |
| minecraft:spawn_egg | 301 | No | missing-metadata-variant | 1 | reward: §8§lDraconium Egg |
| minecraft:spawn_egg | 25 | No | missing-metadata-variant | 1 | reward: §8§lDraconium Egg |
| HardcoreEnderExpansion:spawn_eggs | 1 | No | missing-metadata-variant | 1 | reward: §8§lEnder Egg |
| minecraft:spawn_egg | 51 | No | missing-metadata-variant | 3 | reward: §8§lOne Dragon Egg is Not Enough Mr Bond; reward: §9§lBest Crossbow?; reward: §2§lStone spear |
| ExtraUtilities:enderQuarry | 0 | No | missing-registry-item | 2 | quest-icon: §d§lAutomated Mining; requirement: §d§lAutomated Mining |
| bartworks:gt.bwMetaGeneratedItem0 | 0 | No | missing-metadata-variant | 1 | quest-icon: §d§lImprints, They're Important |
| minecraft:spawn_egg | 52 | No | missing-metadata-variant | 2 | reward: §9§lBest Crossbow?; reward: §2§lIron Shields |
| IC2:itemArmorNanoHelmet | 32767 | No | missing-metadata-variant | 2 | requirement: Carbon Skin; requirement: Don't Try to Dive With It |
| IC2:itemArmorNanoLegs | 32767 | No | missing-metadata-variant | 2 | requirement: Carbon Skin; requirement: Plated Leggings - Better Not Try to Wear It |
| IC2:itemArmorNanoBoots | 32767 | No | missing-metadata-variant | 2 | requirement: Carbon Skin; requirement: Don't Try to Walk With It |
| EMT:ElectricGogglesRevealing | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Electrogoggles |
| EMT:ElectricGogglesRevealing | 32767 | No | missing-metadata-variant | 1 | requirement: Electrogoggles |
| EMT:SolarHelmetRevealing | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Goggles > 9000 |
| EMT:SolarHelmetRevealing | 32767 | No | missing-metadata-variant | 1 | requirement: Goggles > 9000 |
| HardcoreEnderExpansion:music_disk | 4 | No | missing-registry-item | 1 | reward: Here There be Dragons |
| EMT:NanosuitGogglesRevealing | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Nano Goggles |
| EMT:NanosuitGogglesRevealing | 32767 | No | missing-metadata-variant | 1 | requirement: Nano Goggles |
| IC2:itemArmorQuantumHelmet | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Quantum Armor |
| IC2:itemArmorQuantumHelmet | 32767 | Yes | missing-metadata-variant | 1 | requirement: Quantum Armor |
| IC2:itemArmorQuantumLegs | 32767 | Yes | missing-metadata-variant | 1 | requirement: Quantum Armor |
| IC2:itemArmorQuantumBoots | 32767 | Yes | missing-metadata-variant | 1 | requirement: Quantum Armor |
| IC2:itemArmorQuantumChestplate | 32767 | Yes | missing-metadata-variant | 1 | requirement: Quantum Chestplate |
| EMT:QuantumGogglesRevealing | 1 | Yes | missing-metadata-variant | 1 | quest-icon: Quantum Goggles |
| EMT:QuantumGogglesRevealing | 32767 | No | missing-metadata-variant | 1 | requirement: Quantum Goggles |
| witchery:brewgas | 0 | No | missing-registry-item | 1 | quest-icon: Breaking the Mold |
| GalaxySpace:item.Tier6Rocket | 4 | No | missing-metadata-variant | 1 | chapter-icon: Space Race |

The machine-readable inventory includes full typed NBT, source JSON paths, and every use. Generate it with:

```sh
npx tsx tools/questbook/export-list.ts <DefaultQuests> .export-work/questbook-2.9.0-shopping-list.json
```

## Native Windows export result

The official 2.9.0 client completed the automated export with its render window
hidden and pause-on-focus-loss disabled. The replacement recipe release is
`2.9.0-v7-r9ec25114d4a7`; it replaces the previous 2.9.0 picker entry.

- All 27,020 requested references were checked against the native export report.
- The 300 previously missing variants resolve to 397 exact goods after wildcard
  expansion. Every one has its original rendered PNG, including spawn eggs and
  quest reward variants.
- `dreamcraft:Nothing` intentionally renders fully transparent: its original mod
  texture is also blank. No substitute artwork is introduced.
- One source reference uses an empty dictionary, `orePhosphorite`, in “Finding
  Apatite.” It retains its configured base-item icon and an explicit unavailable
  dictionary note rather than offering an empty ingredient chooser.
- The original 64px companion maps 106,547 goods to 81,181 distinct sprites.
  All 1,405 companion assets passed hash verification, with 240 original-pixel
  comparisons. Five pre-existing unavailable originals retain their 32px icons;
  none belong to the 397 formerly missing quest goods.
- All 331 native ore diagrams were rebuilt against the replacement item data.
- The rebuilt questbook contains 3,814 quests, 46 chapters and 10,425 referenced
  goods. All 23,205 rendered stack references resolve to icons, with zero
  unresolved variants. Ingredient-group previews use their actual exported
  members and the shared catalogue presentation helper.

The source inventory remains the export input for future runs. Retention and
validation cover quest icons, chapter icons, tasks, rewards, choice rewards,
fluids, ore dictionaries, NBT stacks and wildcard alternatives through the same
item factories used by the recipe export.

## Navigation between equivalent stacks

Quest presentation retains the exact exported stack. Recipe navigation uses
`itemNavigationResolver`, which compares registry ID, metadata and typed semantic
NBT, ignoring compound key order. Only documented defaults for a specific item
family may be omitted from this comparison. GT5-Unofficial 5.09.54.265's
`MetaGeneratedTool.getToolMode` reads missing mode as zero, while
`getToolWithStats` writes `GT.ToolStats.Mode:0b`; that is the initial registered
default. All other fields remain part of identity, including materials,
enchantments, charge, durability and nonzero modes.

Existing recipe destinations are retained. Otherwise, an equivalent exported
stack with recipe connections can supply the destination; no item names, image
similarity or per-material aliases are involved. Unsupported NBT stays unresolved
rather than being guessed. The generated quest navigation map is separate from
the exact-item icon and tooltip data. The recipe dataset itself is unchanged.


Item links and navigation are generated by the same `build:quests` command.
The 2.9.0 companion covers 23,241 item/group scopes in 16 lazy buckets, with
334,647 bytes of shared quest preview metadata. Rewards include choice rewards;
requirements preserve native ignored/partial/exact NBT matching. Relation buckets
also retain matched item stacks and their quantities, including choice-reward
annotations, for the item browser quest cards. Exact stack
navigation only normalizes source-proven defaults such as GregTech's absent
tool Mode byte being zero; other material, charge and enchantment data remain
significant. See `src/lib/itemNavigation.ts` and `tools/questbook/links.ts`.

Quest and chapter query IDs use `q` followed by the base-36 unsigned value of
the complete 128-bit UUID. All exported IDs are checked for round-trip
correctness. Retrieval OR separators follow BetterQuesting's
`PanelTaskRetrieval.itemExtraInfo` alignment and `PresetColor.TEXT_HIGHLIGHT`;
the shared color source is documented in `src/lib/questbook/theme.ts`.
