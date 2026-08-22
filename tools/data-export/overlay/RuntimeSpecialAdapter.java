package com.github.dcysteine.nesql.exporter.special;

import net.minecraft.item.ItemStack;
import net.minecraft.item.Item;
import net.minecraft.nbt.NBTBase;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.nbt.NBTTagList;
import net.minecraft.util.WeightedRandomChestContent;
import cpw.mods.fml.common.registry.GameRegistry;
import net.minecraftforge.common.ChestGenHooks;
import net.minecraftforge.fluids.FluidStack;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Runtime provider for the ten semantic NEI pages used by the browser.
 *
 * <p>The provider is copied into the disposable exporter and loaded through
 * {@code nesql.special.adapters}.  The optional mods are intentionally kept
 * behind a small reflection boundary.  GTNH distributes production jars (and
 * not stable API/dev jars), while the exporter is compiled in a deobfuscated
 * Forge environment; resolving these classes only after the game has loaded
 * the exact pinned jars keeps the source usable with both launchers.  Every
 * reflective boundary is checked and failures include the category and live
 * class/method that could not be read.</p>
 *
 * <p>This class does not invent records when a registry is unavailable.  A
 * missing pin, registry, or required field aborts the export before the
 * sidecar is written.  This is important because an empty special page is
 * indistinguishable from a valid page after processing.</p>
 */
public final class RuntimeSpecialAdapter implements NeiSpecialOverlay.Adapter {
    private static final String CROPS = "com.gtnewhorizon.cropsnh";

    private static final Map<String, String> PINNED_MODS = pinnedMods();
    private static final Map<String, List<String>> ORE_SEMANTIC_CACHE = new TreeMap<>();
    private static final Map<Item, String> ITEM_UNIQUE_NAMES = new IdentityHashMap<>();
    private static final Map<Item, String> ITEM_REGISTRATION_PROBLEMS = new IdentityHashMap<>();
    private static final Set<String> SKIPPED_ITEM_DIAGNOSTICS = new TreeSet<>();

    private static final String[] PROCESS_MAPS = {
            "maceratorRecipes", "oreWasherRecipes", "thermalCentrifugeRecipes",
            "centrifugeRecipes", "electroMagneticSeparatorRecipes", "chemicalBathRecipes",
            "sifterRecipes", "furnaceRecipes", "blastFurnaceRecipes", "chemicalReactorRecipes",
            "mixerRecipes", "autoclaveRecipes", "extractorRecipes", "fluidExtractionRecipes"
    };

    // Keep a malformed/shared-input closure from multiplying the same recipe
    // into every material graph until the sidecar encoder exhausts the heap.
    // These are deliberately checked before retaining the next recipe's
    // stacks, and the failure includes the material and deterministic counts.
    private static final int MAX_ORE_GRAPH_RECIPES = 4096;
    private static final int MAX_ORE_GRAPH_NODES = 8192;
    private static final int MAX_ORE_GRAPH_EDGES = 32768;
    private static final int MAX_ORE_GRAPH_COUNT = 2048;
    private static final int MAX_ORE_TOTAL_RECIPES = 200000;
    private static final int MAX_ORE_TOTAL_EDGES = 1000000;

    @Override
    public void export(NeiSpecialOverlay.Sink sink) throws Exception {
        resetItemValidation();
        requirePinnedRuntime();
        registerViewTypes(sink);

        category(sink, "crop-output", new CategoryExport() {
            @Override
            public void run() throws Exception { exportCropOutputs(sink); }
        });
        category(sink, "mutation-pool", new CategoryExport() {
            @Override
            public void run() throws Exception { exportMutationPools(sink); }
        });
        category(sink, "crop-breeding", new CategoryExport() {
            @Override
            public void run() throws Exception { exportCropBreeding(sink); }
        });
        category(sink, "gt-ore-vein", new CategoryExport() {
            @Override
            public void run() throws Exception { exportOreVeins(sink); }
        });
        category(sink, "gt-small-ore", new CategoryExport() {
            @Override
            public void run() throws Exception { exportSmallOres(sink); }
        });
        category(sink, "meteor-ritual", new CategoryExport() {
            @Override
            public void run() throws Exception { exportMeteors(sink); }
        });
        category(sink, "loot-bag", new CategoryExport() {
            @Override
            public void run() throws Exception { exportLootBags(sink); }
        });
        category(sink, "vending-trade", new CategoryExport() {
            @Override
            public void run() throws Exception { exportVendingTrades(sink); }
        });
        category(sink, "worldgen-loot", new CategoryExport() {
            @Override
            public void run() throws Exception { exportWorldgenLoot(sink); }
        });
        category(sink, "gt-ore-processing", new CategoryExport() {
            @Override
            public void run() throws Exception { exportOreProcessing(sink); }
        });
    }

    private interface CategoryExport { void run() throws Exception; }

    private static void category(NeiSpecialOverlay.Sink sink, String category, CategoryExport export)
            throws Exception {
        try {
            export.run();
        } catch (Throwable error) {
            Throwable cause = error instanceof InvocationTargetException
                    ? ((InvocationTargetException) error).getCause() : error;
            throw new IllegalStateException("NEI special category " + category + " failed: " + cause, cause);
        }
    }

    /**
     * The GT recipe registries contain a small number of synthetic stacks.  A
     * stack whose Item is not in Forge's live registry cannot be represented by
     * the base exporter: ItemFactory ultimately calls
     * {@code GameRegistry.findUniqueIdentifierFor}, which throws from the
     * UniqueIdentifier parser when the registry name is null.  Validate the
     * exact same identity before handing a stack to the sink, and keep the
     * result by Item identity because the recipe tables contain many repeated
     * metaitem instances.
     */
    private static void resetItemValidation() {
        ORE_SEMANTIC_CACHE.clear();
        ITEM_UNIQUE_NAMES.clear();
        ITEM_REGISTRATION_PROBLEMS.clear();
        SKIPPED_ITEM_DIAGNOSTICS.clear();
    }

    private static String itemRegistrationProblem(ItemStack stack) {
        if (stack == null) return "null ItemStack";
        Item item = stack.getItem();
        if (item == null) return "ItemStack has a null Item";
        String cachedProblem = ITEM_REGISTRATION_PROBLEMS.get(item);
        if (cachedProblem != null) return cachedProblem;
        if (ITEM_UNIQUE_NAMES.containsKey(item)) return null;

        try {
            GameRegistry.UniqueIdentifier unique = GameRegistry.findUniqueIdentifierFor(item);
            if (unique == null) return rememberItemProblem(item, "Forge returned no UniqueIdentifier");
            if (blank(unique.modId) || blank(unique.name)) {
                return rememberItemProblem(item, "Forge returned an incomplete UniqueIdentifier");
            }
            ITEM_UNIQUE_NAMES.put(item, unique.modId + ":" + unique.name);
            return null;
        } catch (NullPointerException error) {
            String registryName = vanillaRegistryName(item);
            return rememberItemProblem(item,
                    "GameRegistry.findUniqueIdentifierFor failed for registry name "
                            + (registryName == null ? "<null>" : registryName) + ": " + error.getMessage());
        }
    }

    private static String rememberItemProblem(Item item, String problem) {
        ITEM_REGISTRATION_PROBLEMS.put(item, problem);
        return problem;
    }

    private static boolean blank(String value) {
        return value == null || value.trim().length() == 0;
    }

    private static String retainItemOrNull(NeiSpecialOverlay.Sink sink, ItemStack stack, String context) {
        String problem = itemRegistrationProblem(stack);
        if (problem != null) {
            noteSkippedItem(context, stack, problem);
            return null;
        }
        try {
            String goodsId = sink.retainItem(stack);
            if (blank(goodsId)) throw new IllegalStateException("sink returned an empty goods ID");
            return goodsId;
        } catch (RuntimeException error) {
            if (!isUnregisteredItemFailure(error)) throw error;
            Item item = stack.getItem();
            String reason = "sink rejected the registered Item while resolving its Forge identity: "
                    + error.getMessage();
            if (item != null) rememberItemProblem(item, reason);
            noteSkippedItem(context, stack, reason);
            return null;
        }
    }

    private static boolean isUnregisteredItemFailure(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            String message = current.getMessage();
            if (message != null && message.contains("String.split")
                    && message.contains("string") && message.contains("null")) return true;
            for (StackTraceElement frame : current.getStackTrace()) {
                if (frame.getClassName().contains("GameRegistry")
                        && frame.getMethodName().contains("findUniqueIdentifierFor")) return true;
            }
        }
        return false;
    }

    private static void noteSkippedItem(String context, ItemStack stack, String problem) {
        String diagnostic = "[RuntimeSpecialAdapter] Skipping unresolvable ItemStack in " + context
                + ": " + describeStack(stack) + " (" + problem + ")";
        if (SKIPPED_ITEM_DIAGNOSTICS.add(diagnostic)) System.err.println(diagnostic);
    }

    private static String describeStack(ItemStack stack) {
        if (stack == null) return "<null>";
        Item item = stack.getItem();
        if (item == null) return "<null-item> damage=" + stack.getItemDamage();
        String registryName = vanillaRegistryName(item);
        String unlocalized;
        try {
            unlocalized = item.getUnlocalizedName();
        } catch (Throwable error) {
            unlocalized = "<unavailable:" + error.getClass().getSimpleName() + ">";
        }
        return (registryName == null ? item.getClass().getName() : registryName)
                + " (" + unlocalized + ") damage=" + stack.getItemDamage();
    }

    private static String vanillaRegistryName(Item item) {
        try {
            return Item.itemRegistry == null ? null : Item.itemRegistry.getNameForObject(item);
        } catch (RuntimeException ignored) {
            // The diagnostic must remain safe even for malformed Item classes.
            return null;
        }
    }

    private static void registerViewTypes(NeiSpecialOverlay.Sink sink) {
        sink.addServiceIcon("service:crop", "CropsNH");
        sink.addServiceIcon("service:crop-breeding", "Crop Breeding");
        sink.addServiceIcon("service:gt-ore", "GregTech Ore");
        sink.addServiceIcon("service:meteor", "Meteor Ritual");
        sink.addServiceIcon("service:lootbag", "Enhanced LootBags");
        sink.addServiceIcon("service:vending", "Vending Machine");
        sink.addServiceIcon("service:worldgen", "World Generation");
        sink.addServiceIcon("service:ore-processing", "GT Ore Processing");

        sink.addViewType("crop-output", "Crop Outputs", "service:crop");
        sink.addViewType("mutation-pool", "Mutation Pools", "service:crop");
        sink.addViewType("crop-breeding", "Crop Breeding", "service:crop-breeding");
        sink.addViewType("gt-ore-vein", "GT Ore Veins", "service:gt-ore");
        sink.addViewType("gt-small-ore", "GT Small Ores", "service:gt-ore");
        sink.addViewType("meteor-ritual", "Meteor Rituals", "service:meteor");
        sink.addViewType("loot-bag", "Enhanced LootBags", "service:lootbag");
        sink.addViewType("vending-trade", "Vending Machine", "service:vending");
        sink.addViewType("worldgen-loot", "World-Generation Loot", "service:worldgen");
        sink.addViewType("gt-ore-processing", "GT Ore Processing", "service:ore-processing");
    }

    /** Validate both Forge's active mod metadata and the live API classes. */
    private static void requirePinnedRuntime() {
        Map<?, ?> indexed;
        try {
            Object loader = staticCall("cpw.mods.fml.common.Loader", "instance");
            indexed = castMap(call(loader, "getIndexedModList"));
        } catch (Throwable error) {
            throw new IllegalStateException("Cannot inspect Forge Loader for pinned NEI special mods", error);
        }

        for (Map.Entry<String, String> pin : PINNED_MODS.entrySet()) {
            Object container = indexed.get(pin.getKey());
            if (container == null) {
                throw new IllegalStateException("Pinned NEI special mod is missing: " + pin.getKey()
                        + " expected " + pin.getValue());
            }
            String version = string(call(container, "getVersion"));
            String display = stringOrNull(callOrNull(container, "getDisplayVersion"));
            if (!pin.getValue().equals(version) && !pin.getValue().equals(display)) {
                throw new IllegalStateException("Pinned NEI special mod " + pin.getKey()
                        + " expected " + pin.getValue() + " but Forge reported " + version
                        + (display == null ? "" : " (display " + display + ")"));
            }
        }

        // These are the exact live registry boundaries used below.  Keeping
        // this list explicit makes a renamed package fail loudly at startup.
        String[] requiredClasses = {
                CROPS + ".farming.registries.CropRegistry",
                CROPS + ".farming.registries.MutationRegistry",
                CROPS + ".api.ICropCard",
                CROPS + ".api.ICropMutation",
                CROPS + ".api.IMutationPool",
                "gregtech.common.WorldgenGTOreLayer",
                "gregtech.common.WorldgenGTOreSmallPieces",
                "gregtech.api.recipe.RecipeMaps",
                "gregtech.api.recipe.RecipeMap",
                "gregtech.api.util.GTRecipe",
                "gregtech.api.interfaces.IOreMaterial",
                "gregtech.api.enums.OrePrefixes",
                "gregtech.common.ores.SmallOreDrops",
                "WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorRegistry",
                "WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorComponent",
                "WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorReagentRegistry",
                "WayofTime.alchemicalWizardry.api.rituals.Rituals",
                "WayofTime.alchemicalWizardry.ModItems",
                "eu.usrv.enhancedlootbags.EnhancedLootBags",
                "eu.usrv.enhancedlootbags.core.serializer.LootGroups",
                "eu.usrv.enhancedlootbags.core.serializer.LootGroups$LootGroup",
                "eu.usrv.enhancedlootbags.core.serializer.LootGroups$LootGroup$Drop",
                "com.cubefury.vendingmachine.trade.TradeDatabase",
                "com.cubefury.vendingmachine.trade.TradeGroup",
                "com.cubefury.vendingmachine.trade.Trade",
                "com.cubefury.vendingmachine.trade.CurrencyItem",
                "com.cubefury.vendingmachine.util.BigItemStack",
                "com.cubefury.vendingmachine.api.trade.ICondition",
                "net.minecraftforge.common.ChestGenHooks",
                "greymerk.roguelike.dungeon.settings.SettingsResolver",
                "greymerk.roguelike.dungeon.settings.DungeonSettings",
                "greymerk.roguelike.treasure.loot.LootRuleManager",
                "greymerk.roguelike.treasure.loot.LootRule",
                "greymerk.roguelike.util.WeightedRandomizer",
                "greymerk.roguelike.treasure.loot.WeightedRandomLoot",
                "twilightforest.TFTreasure",
                "twilightforest.TFTreasureTable",
                "twilightforest.TFTreasureItem",
                "com.github.dcysteine.neicustomdiagram.generators.forge.worldgenloot.ForgeWorldgenLoot"
        };
        for (String className : requiredClasses) {
            try {
                Class.forName(className);
            } catch (Throwable error) {
                throw new IllegalStateException("Pinned NEI special API class is unavailable: " + className, error);
            }
        }
    }

    private static Map<String, String> pinnedMods() {
        Map<String, String> pins = new LinkedHashMap<>();
        pins.put("cropsnh", "2.0.91");
        pins.put("gregtech", "5.09.54.20");
        pins.put("AWWayofTime", "1.9.4");
        pins.put("enhancedlootbags", "1.3.4");
        pins.put("vendingmachine", "0.4.95");
        pins.put("neicustomdiagram", "1.8.30");
        pins.put("Roguelike", "1.6.6-GTNH");
        pins.put("TwilightForest", "2.7.36");
        return Collections.unmodifiableMap(pins);
    }

    private static void exportCropOutputs(NeiSpecialOverlay.Sink sink) throws Exception {
        Object registry = staticField(CROPS + ".farming.registries.CropRegistry", "instance");
        List<Object> crops = sortedObjects(call(registry, "getAllInRegistrationOrder"), "crop id");
        int count = 0;
        for (Object crop : crops) {
            if (bool(call(crop, "hideFromNEI"))) continue;
            String cropId = string(call(crop, "getId"));
            List<String> goods = cropGoods(sink, crop);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("cropId", cropId);
            payload.put("tier", number(call(crop, "getTier")));
            payload.put("durationTicks", number(call(crop, "getGrowthDuration")));
            payload.put("machineBreedingTier", number(call(crop, "getMachineBreedingRecipeTier")));
            payload.put("minSeedBedTier", number(call(crop, "getMinSeedBedTier")));
            payload.put("dropChance", number(call(crop, "getDropChance")));
            payload.put("creator", stringOrEmpty(callOrNull(crop, "getCreator")));
            payload.put("flavour", stringOrEmpty(callOrNull(crop, "getFlavourText")));
            payload.put("likedBiomeTags", stringCollection(callOrNull(crop, "getLikedBiomeTags")));
            payload.put("soils", itemPayloads(sink, callOrNull(crop, "getSoilsForNEI", false)));
            payload.put("underBlocks", itemPayloads(sink, callOrNull(crop, "getBlocksUnderForNEI", false)));
            payload.put("requirements", requirementDescriptions(callOrNull(crop, "getGrowthRequirements")));
            payload.put("drops", cropDrops(sink, crop));
            String slug = slug(cropId);
            String title = cropTitle(crop, cropId);
            sink.addRecord("crop:" + slug, "crop-output", title,
                    searchText("cropsnh", "crop-output", cropId, title), goods,
                    "special:crop:" + slug + ":recipes", "special:crop:" + slug + ":usages",
                    "service:crop", payload);
            count++;
        }
        requireRecords("crop-output", count);
    }

    private static void exportMutationPools(NeiSpecialOverlay.Sink sink) throws Exception {
        Object registry = staticField(CROPS + ".farming.registries.MutationRegistry", "instance");
        List<Object> pools = sortedObjects(call(registry, "getMutationPools"), "pool name");
        int count = 0;
        for (Object pool : pools) {
            String poolName = string(call(pool, "getUnlocalisedName"));
            String slug = slug(poolName);
            List<Object> members = sortedObjects(call(pool, "getMembers"), "member crop id");
            List<String> goods = new ArrayList<>();
            List<Object> memberIds = new ArrayList<>();
            for (Object crop : members) {
                String cropId = string(call(crop, "getId"));
                memberIds.add(cropId);
                addAllUnique(goods, cropGoods(sink, crop));
            }
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("poolName", poolName);
            payload.put("members", memberIds);
            sink.addRecord("pool:" + slug, "mutation-pool", "Mutation Pool: " + poolName,
                    searchText("cropsnh", "mutation-pool", poolName, join(memberIds, " ")), goods,
                    "special:pool:" + slug + ":recipes", "special:pool:" + slug + ":usages",
                    "service:crop", payload);
            count++;
        }
        requireRecords("mutation-pool", count);
    }

    private static void exportCropBreeding(NeiSpecialOverlay.Sink sink) throws Exception {
        Object registry = staticField(CROPS + ".farming.registries.MutationRegistry", "instance");
        List<Object> mutations = list(call(registry, "getDeterministicMutations"));
        Collections.sort(mutations, new Comparator<Object>() {
            @Override
            public int compare(Object left, Object right) {
                return mutationKey(left).compareTo(mutationKey(right));
            }
        });
        int count = 0;
        for (Object mutation : mutations) {
            Object output = call(mutation, "getOutput");
            String outputId = string(call(output, "getId"));
            List<Object> parents = sortedObjects(call(mutation, "getParents"), "parent crop id");
            List<Object> parentIds = new ArrayList<>();
            List<String> goods = new ArrayList<>(cropGoods(sink, output));
            for (Object parent : parents) {
                parentIds.add(string(call(parent, "getId")));
                addAllUnique(goods, cropGoods(sink, parent));
            }
            List<Object> catalysts = itemPayloads(sink, callOrNull(mutation, "getBlocksUnderForNEI", false));
            addAllGoodsFromPayload(catalysts, goods);
            List<Object> machineCatalysts = itemPayloadsNested(sink,
                    callOrNull(mutation, "getBreedingMachineCatalystsForNEI", false));
            addAllGoodsFromPayload(machineCatalysts, goods);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("outputCrop", outputId);
            payload.put("parentCount", number(call(mutation, "getParentCount")));
            payload.put("parents", parentIds);
            payload.put("blocksUnder", catalysts);
            payload.put("machineCatalysts", machineCatalysts);
            payload.put("requirements", requirementDescriptions(callOrNull(mutation, "getRequirements")));
            payload.put("machineDurationTicks", number(callOrNull(mutation, "getBreedingMachineRecipeDuration")));
            payload.put("machineEUt", number(callOrNull(mutation, "getBreedingMachineRecipeEUt")));
            String key = outputId + ":" + join(parentIds, ",");
            String suffix = digest(key).substring(0, 10);
            String slug = slug(outputId);
            sink.addRecord("breeding:" + slug + ":" + suffix, "crop-breeding",
                    "Direct Breeding: " + outputId,
                    searchText("cropsnh", "crop-breeding", outputId, join(parentIds, " ")), goods,
                    "special:breeding:" + slug + ":" + suffix + ":recipes",
                    "special:breeding:" + slug + ":" + suffix + ":usages",
                    "service:crop-breeding", payload);
            count++;
        }
        requireRecords("crop-breeding", count);
    }

    private static void exportOreVeins(NeiSpecialOverlay.Sink sink) throws Exception {
        Object layers = staticField("gregtech.common.WorldgenGTOreLayer", "sList");
        List<Object> sorted = sortedObjects(layers, "vein name");
        int count = 0;
        for (Object layer : sorted) {
            String name = string(call(layer, "getName"));
            List<String> goods = new ArrayList<>();
            List<Object> layerPayload = new ArrayList<>();
            for (String fieldName : new String[] {"mPrimary", "mSecondary", "mBetween", "mSporadic"}) {
                Object material = fieldOrNull(layer, fieldName);
                if (material == null) continue;
                List<String> materialGoods = materialGoods(sink, material, "oreNormal", "ore");
                addAllUnique(goods, materialGoods);
                Map<String, Object> part = new LinkedHashMap<>();
                part.put("role", fieldName.substring(1).toLowerCase(Locale.ROOT));
                part.put("material", materialName(material));
                part.put("goodsIds", materialGoods);
                if (!materialGoods.isEmpty()) part.put("oreGoodsId", materialGoods.get(0));
                part.put("chance", oreLayerChance(fieldName));
                part.put("weight", oreLayerWeight(fieldName));
                layerPayload.add(part);
            }
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("layers", layerPayload);
            payload.put("minY", number(call(layer, "getMinY", "")));
            payload.put("maxY", number(call(layer, "getMaxY", "")));
            payload.put("weight", number(call(layer, "getWeight")));
            payload.put("density", number(call(layer, "getDensity")));
            payload.put("size", number(fieldOrNull(layer, "mSize")));
            payload.put("restrictBiome", stringOrEmpty(fieldOrNull(layer, "mRestrictBiome")));
            List<String> dimensions = sortedStrings(callOrNull(layer, "getAllowedDimensions"));
            payload.put("dimensions", dimensions);
            payload.put("dimensionHeights", dimensionHeights(layer, dimensions));
            payload.put("overrides", dimensionOverrides(layer));
            payload.put("dimensionChance", dimensionChance(layer, dimensions));
            String slug = slug(name);
            sink.addRecord("vein:" + slug, "gt-ore-vein", "GT Ore Vein: " + name,
                    searchText("gregtech", "gt-ore-vein", name,
                            join(dimensions, " ")), goods,
                    "special:vein:" + slug + ":recipes", "special:vein:" + slug + ":usages",
                    "service:gt-ore", payload);
            count++;
        }
        requireRecords("gt-ore-vein", count);
    }

    private static void exportSmallOres(NeiSpecialOverlay.Sink sink) throws Exception {
        Object ores = staticField("gregtech.common.WorldgenGTOreSmallPieces", "sList");
        List<Object> sorted = sortedObjects(ores, "small ore name");
        int count = 0;
        for (Object ore : sorted) {
            String name = string(call(ore, "getName"));
            Object material = call(ore, "getMaterial");
            List<String> representativeOres = materialGoods(sink, material, "oreSmall", "ore");
            List<String> representativeDusts = materialGoods(sink, material, "dust", "dustImpure", "crushed",
                    "gem", "gemChipped", "gemFlawed", "gemFlawless", "gemExquisite");
            List<String> goods = new ArrayList<>();
            addAllUnique(goods, representativeOres);
            addAllUnique(goods, representativeDusts);
            List<Object> potentialDrops = smallOrePotentialDrops(sink, material, goods);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("material", materialName(material));
            payload.put("minY", number(fieldOrNull(ore, "mMinY")));
            payload.put("maxY", number(fieldOrNull(ore, "mMaxY")));
            payload.put("amount", number(fieldOrNull(ore, "mAmount")));
            payload.put("biome", stringOrEmpty(fieldOrNull(ore, "mBiome")));
            List<String> dimensions = sortedStrings(callOrNull(ore, "getAllowedDimensions"));
            payload.put("dimensions", dimensions);
            payload.put("dimensionHeights", dimensionHeights(ore, dimensions));
            payload.put("dimensionChance", binaryDimensionChance(dimensions));
            payload.put("representativeOres", representativeOres);
            payload.put("representativeDusts", representativeDusts);
            payload.put("potentialDrops", potentialDrops);
            payload.put("goodsIds", goods);
            String slug = slug(name);
            sink.addRecord("small-ore:" + slug, "gt-small-ore", "GT Small Ore: " + name,
                    searchText("gregtech", "gt-small-ore", name,
                            stringOrEmpty(fieldOrNull(ore, "mBiome"))), goods,
                    "special:small-ore:" + slug + ":recipes", "special:small-ore:" + slug + ":usages",
                    "service:gt-ore", payload);
            count++;
        }
        requireRecords("gt-small-ore", count);
    }

    private static void exportMeteors(NeiSpecialOverlay.Sink sink) throws Exception {
        Object meteors = staticField(
                "WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorRegistry", "meteorList");
        List<Object> sorted = list(meteors);
        Collections.sort(sorted, new Comparator<Object>() {
            @Override
            public int compare(Object left, Object right) {
                return stableStackName(asItemStack(fieldOrNull(left, "focusItem"), "meteor focus"))
                        .compareTo(stableStackName(asItemStack(fieldOrNull(right, "focusItem"), "meteor focus")));
            }
        });
        int count = 0;
        final String ritualId = "AW019FallingTower";
        Object ritual = ritualDefinition(ritualId);
        int ritualCost = intValue(call(Class.forName(
                "WayofTime.alchemicalWizardry.api.rituals.Rituals"), "getCostForActivation", ritualId));
        int crystalLevel = intValue(fieldOrNull(ritual, "crystalLevel"));
        Object activationCrystal = staticField("WayofTime.alchemicalWizardry.ModItems", "activationCrystal");
        if (activationCrystal != null && !(activationCrystal instanceof Item)) {
            throw new IllegalStateException("Blood Magic activationCrystal is not an Item: " + activationCrystal);
        }
        ItemStack crystal = activationCrystal == null ? null
                : new ItemStack((Item) activationCrystal, 1, crystalLevel == 1 ? 0 : 1);
        for (Object meteor : sorted) {
            ItemStack focus = asItemStack(fieldOrNull(meteor, "focusItem"), "meteor focus");
            String focusId = retainItemOrNull(sink, focus, "meteor focus");
            if (focusId == null) continue;
            List<String> goods = new ArrayList<>();
            addAllUnique(goods, Collections.singletonList(focusId));
            String crystalGoodsId = crystal == null ? null : retainItemOrNull(sink, crystal, "meteor activation crystal");
            if (crystalGoodsId != null) addAllUnique(goods, Collections.singletonList(crystalGoodsId));
            List<Object> ores = meteorComponents(sink, fieldOrNull(meteor, "ores"), goods,
                    intValue(number(fieldOrNull(meteor, "radius"))),
                    number(fieldOrNull(meteor, "fillerChance")).doubleValue(), false);
            List<Object> filler = meteorComponents(sink, fieldOrNull(meteor, "filler"), goods,
                    intValue(number(fieldOrNull(meteor, "radius"))),
                    number(fieldOrNull(meteor, "fillerChance")).doubleValue(), true);
            List<Object> outputs = new ArrayList<>();
            outputs.addAll(ores);
            outputs.addAll(filler);
            sortMaps(outputs, "goodsId");
            Map<String, Object> estimatedAmounts = estimatedMeteorAmounts(outputs);
            List<String> requirements = meteorRequirements(outputs);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("focusGoodsId", focusId);
            payload.put("ritual", ritualId);
            payload.put("ritualName", stringOrEmpty(callOrNull(ritual, "getRitualLocalizedName")));
            payload.put("lpCost", ritualCost);
            payload.put("cost", number(fieldOrNull(meteor, "cost")));
            payload.put("radius", number(fieldOrNull(meteor, "radius")));
            Number fillerChance = number(fieldOrNull(meteor, "fillerChance"));
            payload.put("fillerChance", fillerChance);
            payload.put("fillerRatio", fillerChance.doubleValue() / 100.0);
            payload.put("crystalLevel", crystalLevel);
            payload.put("crystal", crystalLevel == 1 ? "weak-activation-crystal" : "activation-crystal-level-" + crystalLevel);
            if (crystalGoodsId != null) payload.put("crystalGoodsId", crystalGoodsId);
            payload.put("oreTotalWeight", meteorTotalWeight(fieldOrNull(meteor, "ores")));
            payload.put("fillerTotalWeight", meteorTotalWeight(fieldOrNull(meteor, "filler")));
            payload.put("ores", ores);
            payload.put("filler", filler);
            payload.put("outputs", outputs);
            payload.put("estimatedAmounts", estimatedAmounts);
            payload.put("requirements", requirements);
            payload.put("reagents", meteorReagents());
            String slug = slug(focusId);
            sink.addRecord("meteor:" + slug, "meteor-ritual", "Meteor Ritual: " + focusId,
                    searchText("bloodmagic", "meteor-ritual", focusId, ritualId,
                            String.valueOf(crystalLevel)), goods,
                    "special:meteor:" + slug + ":recipes", "special:meteor:" + slug + ":usages",
                    "service:meteor", payload);
            count++;
        }
        requireRecords("meteor-ritual", count);
    }

    private static void exportLootBags(NeiSpecialOverlay.Sink sink) throws Exception {
        Object handler = staticField("eu.usrv.enhancedlootbags.EnhancedLootBags", "LootGroupHandler");
        Object groups = call(handler, "getLootGroups");
        List<Object> table = sortedObjects(call(groups, "getLootTable"), "loot group id");
        int count = 0;
        for (Object group : table) {
            int groupId = intValue(call(group, "getGroupID"));
            List<String> goods = new ArrayList<>();
            ItemStack bag = asItemStack(callOrNull(group, "createLootBagItemStack"), "loot bag");
            if (bag != null) {
                String bagId = retainItemOrNull(sink, bag, "loot bag");
                if (bagId != null) addAllUnique(goods, Collections.singletonList(bagId));
            }
            List<Object> drops = new ArrayList<>();
            for (Object drop : list(call(group, "getDrops"))) {
                Map<String, Object> dropPayload = new LinkedHashMap<>();
                dropPayload.put("identifier", stringOrEmpty(callOrNull(drop, "getIdentifier")));
                dropPayload.put("group", stringOrEmpty(callOrNull(drop, "getItemDropGroup")));
                dropPayload.put("itemName", stringOrEmpty(callOrNull(drop, "getItemName")));
                dropPayload.put("amount", number(call(drop, "getAmount")));
                dropPayload.put("chance", number(call(drop, "getChance")));
                dropPayload.put("limitedDropCount", number(call(drop, "getLimitedDropCount")));
                dropPayload.put("randomAmount", bool(call(drop, "getIsRandomAmount")));
                dropPayload.put("nbt", stringOrEmpty(callOrNull(drop, "getNBTTag")));
                ItemStack stack = asItemStack(callOrNull(drop, "getItemStack"), "loot drop");
                if (stack != null) {
                    String goodsId = retainItemOrNull(sink, stack, "loot drop");
                    if (goodsId != null) {
                        dropPayload.put("goodsId", goodsId);
                        addAllUnique(goods, Collections.singletonList(goodsId));
                    }
                }
                drops.add(dropPayload);
            }
            sortMaps(drops, "identifier");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("groupId", groupId);
            payload.put("groupName", stringOrEmpty(callOrNull(group, "getGroupName")));
            payload.put("rarity", String.valueOf(callOrNull(group, "getGroupRarity")));
            payload.put("minItems", number(call(group, "getMinItems")));
            payload.put("maxItems", number(call(group, "getMaxItems")));
            payload.put("maxWeight", number(call(group, "getMaxWeight")));
            payload.put("combineWithTrash", bool(call(group, "getCombineWithTrash")));
            payload.put("trashGroup", number(call(group, "getTrashGroup")));
            payload.put("drops", drops);
            payload.put("fortuneChances", fortuneChances(handler, group, drops));
            String slug = slug(String.valueOf(groupId));
            String groupName = stringOrEmpty(callOrNull(group, "getGroupName"));
            sink.addRecord("lootbag:" + slug, "loot-bag", "LootBag Group " + groupId,
                    searchText("enhancedlootbags", "loot-bag", String.valueOf(groupId), groupName), goods,
                    "special:lootbag:" + slug + ":recipes", "special:lootbag:" + slug + ":usages",
                    "service:lootbag", payload);
            count++;
        }
        requireRecords("loot-bag", count);
    }

    private static void exportVendingTrades(NeiSpecialOverlay.Sink sink) throws Exception {
        Object database = staticField("com.cubefury.vendingmachine.trade.TradeDatabase", "INSTANCE");
        Map<?, ?> groups = castMap(call(database, "getTradeGroups"));
        List<Object> sortedGroups = new ArrayList<>(groups.values());
        Collections.sort(sortedGroups, Comparator.comparing(RuntimeSpecialAdapter::stableObjectName));
        int count = 0;
        for (Object group : sortedGroups) {
            String groupId = String.valueOf(call(group, "getId"));
            List<Object> requirements = new ArrayList<>();
            for (Object condition : list(callOrNull(group, "getRequirements"))) {
                Map<String, Object> conditionPayload = new LinkedHashMap<>();
                conditionPayload.put("type", condition.getClass().getName());
                NBTTagCompound nbt = new NBTTagCompound();
                Object encoded = callOrNull(condition, "writeToNBT", nbt);
                conditionPayload.put("nbt", String.valueOf(encoded == null ? nbt : encoded));
                requirements.add(conditionPayload);
            }
            sortMaps(requirements, "type");
            List<Object> trades = list(call(group, "getTrades"));
            int tradeIndex = 0;
            for (Object trade : trades) {
                List<String> goods = new ArrayList<>();
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("groupId", groupId);
                payload.put("tradeIndex", tradeIndex);
                payload.put("cooldown", number(fieldOrNull(group, "cooldown")));
                payload.put("maxTrades", number(fieldOrNull(group, "maxTrades")));
                payload.put("category", String.valueOf(callOrNull(group, "getCategory")));
                payload.put("requirements", requirements);
                payload.put("fromCurrency", currencyPayload(sink, fieldOrNull(trade, "fromCurrency"), goods));
                payload.put("fromItems", bigStacks(sink, fieldOrNull(trade, "fromItems"), goods));
                payload.put("nonConsumedItems", bigStacks(sink, fieldOrNull(trade, "nonConsumedItems"), goods));
                payload.put("toItems", bigStacks(sink, fieldOrNull(trade, "toItems"), goods));
                Object display = fieldOrNull(trade, "displayItem");
                payload.put("displayItem", bigStack(sink, display, goods));
                String slug = slug(groupId + ":" + tradeIndex);
                sink.addRecord("vending:" + slug, "vending-trade", "Vending Trade " + (tradeIndex + 1),
                        searchText("vendingmachine", "vending-trade", groupId,
                                String.valueOf(callOrNull(group, "getCategory"))), goods,
                        "special:vending:" + slug + ":recipes", "special:vending:" + slug + ":usages",
                        "service:vending", payload);
                tradeIndex++;
                count++;
            }
        }
        requireRecords("vending-trade", count);
    }

    private static void exportWorldgenLoot(NeiSpecialOverlay.Sink sink) throws Exception {
        int count = 0;
        String[][] forge = {
                {"MINESHAFT_CORRIDOR", "mineshaft"}, {"PYRAMID_DESERT_CHEST", "desert pyramid"},
                {"PYRAMID_JUNGLE_CHEST", "jungle pyramid"}, {"PYRAMID_JUNGLE_DISPENSER", "jungle dispenser"},
                {"STRONGHOLD_CORRIDOR", "stronghold corridor"}, {"STRONGHOLD_LIBRARY", "stronghold library"},
                {"STRONGHOLD_CROSSING", "stronghold crossing"}, {"VILLAGE_BLACKSMITH", "village blacksmith"},
                {"BONUS_CHEST", "bonus chest"}, {"DUNGEON_CHEST", "dungeon"}
        };
        for (String[] source : forge) {
            String category = string(staticField("net.minecraftforge.common.ChestGenHooks", source[0]));
            WeightedRandomChestContent[] entries = ChestGenHooks.getItems(category, new Random(0x4e495f4c));
            List<String> goods = new ArrayList<>();
            List<Object> itemPayload = new ArrayList<>();
            for (WeightedRandomChestContent entry : entries) {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("min", entry.theMinimumChanceToGenerateItem);
                payload.put("max", entry.theMaximumChanceToGenerateItem);
                payload.put("weight", entry.itemWeight);
                ItemStack stack = entry.theItemId;
                if (stack != null) {
                    String goodsId = retainItemOrNull(sink, stack, "Forge chest loot " + category);
                    if (goodsId != null) {
                        addAllUnique(goods, Collections.singletonList(goodsId));
                        payload.put("goodsId", goodsId);
                    }
                }
                itemPayload.add(payload);
            }
            sortMaps(itemPayload, "goodsId");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("source", "forge");
            payload.put("name", source[1]);
            payload.put("tableId", category);
            payload.put("entries", itemPayload);
            String slug = slug(category);
            sink.addRecord("worldgen:forge:" + slug, "worldgen-loot", "Forge Loot: " + source[1],
                    searchText("neicustomdiagram", "forge", "worldgen-loot", source[1], category), goods,
                    "special:worldgen:forge:" + slug + ":recipes",
                    "special:worldgen:forge:" + slug + ":usages", "service:worldgen", payload);
            count++;
        }
        exportRoguelikeLoot(sink);
        count++;
        exportTwilightLoot(sink);
        count++;
        requireRecords("worldgen-loot", count);
    }

    private static void exportRoguelikeLoot(NeiSpecialOverlay.Sink sink) throws Exception {
        Object resolver = construct("greymerk.roguelike.dungeon.settings.SettingsResolver");
        Object settings = call(resolver, "getDefaultSettings");
        Object rulesManager = callOrNull(settings, "getLootRules");
        List<Object> rules = rulesManager == null ? Collections.emptyList()
                : list(fieldOrNull(rulesManager, "rules"));
        List<String> goods = new ArrayList<>();
        List<Object> entries = new ArrayList<>();
        for (Object rule : rules) {
            Object weighted = fieldOrNull(rule, "item");
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("type", String.valueOf(fieldOrNull(rule, "type")));
            entry.put("level", number(fieldOrNull(rule, "level")));
            entry.put("amount", number(fieldOrNull(rule, "amount")));
            entry.put("toEach", bool(fieldOrNull(rule, "toEach")));
            entry.put("weight", number(callOrNull(weighted, "getWeight")));
            ItemStack sample = sampleWeighted(weighted, 0x524f475545L);
            if (sample != null) {
                String goodsId = retainItemOrNull(sink, sample, "Roguelike weighted loot");
                if (goodsId != null) {
                    addAllUnique(goods, Collections.singletonList(goodsId));
                    entry.put("goodsId", goodsId);
                }
            }
            entries.add(entry);
        }
        sortMaps(entries, "goodsId");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("source", "roguelike");
        payload.put("settings", String.valueOf(settings));
        payload.put("entries", entries);
        sink.addRecord("worldgen:roguelike:default", "worldgen-loot", "Roguelike Dungeons",
                searchText("roguelike", "worldgen-loot", "default"), goods,
                "special:worldgen:roguelike:recipes", "special:worldgen:roguelike:usages",
                "service:worldgen", payload);
    }

    private static void exportTwilightLoot(NeiSpecialOverlay.Sink sink) throws Exception {
        Class<?> treasureClass = Class.forName("twilightforest.TFTreasure");
        List<Field> fields = new ArrayList<>();
        for (Field field : treasureClass.getFields()) {
            if (Modifier.isStatic(field.getModifiers()) && treasureClass.isAssignableFrom(field.getType())) {
                fields.add(field);
            }
        }
        Collections.sort(fields, Comparator.comparing(Field::getName));
        for (Field field : fields) {
            Object treasure = field.get(null);
            if (treasure == null) continue;
            List<String> goods = new ArrayList<>();
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("source", "twilight");
            payload.put("tableId", field.getName());
            List<Object> tables = new ArrayList<>();
            for (String tableName : new String[] {"useless", "common", "uncommon", "rare", "ultrarare"}) {
                Object table = fieldOrNull(treasure, tableName);
                if (table == null) continue;
                List<Object> items = new ArrayList<>();
                for (Object item : list(fieldOrNull(table, "list"))) {
                    ItemStack sample = asItemStack(callOrNull(item, "getItemStack", new Random(0x545746)),
                            "Twilight treasure item");
                    if (sample == null) continue;
                    String goodsId = retainItemOrNull(sink, sample, "Twilight treasure item");
                    if (goodsId == null) continue;
                    addAllUnique(goods, Collections.singletonList(goodsId));
                    Map<String, Object> itemPayload = new LinkedHashMap<>();
                    itemPayload.put("goodsId", goodsId);
                    itemPayload.put("rarity", number(callOrNull(item, "getRarity")));
                    itemPayload.put("randomEnchantmentLevel", number(callOrNull(item, "getRandomEnchantmentLevel")));
                    items.add(itemPayload);
                }
                sortMaps(items, "goodsId");
                Map<String, Object> tablePayload = new LinkedHashMap<>();
                tablePayload.put("name", tableName);
                tablePayload.put("items", items);
                tables.add(tablePayload);
            }
            payload.put("tables", tables);
            String slug = slug(field.getName());
            sink.addRecord("worldgen:twilight:" + slug, "worldgen-loot",
                    "Twilight Loot: " + field.getName(),
                    searchText("twilightforest", "worldgen-loot", field.getName()), goods,
                    "special:worldgen:twilight:" + slug + ":recipes",
                    "special:worldgen:twilight:" + slug + ":usages", "service:worldgen", payload);
        }
    }

    private static void exportOreProcessing(NeiSpecialOverlay.Sink sink) throws Exception {
        List<RecipeInfo> recipes = new ArrayList<>();
        for (String mapName : PROCESS_MAPS) {
            Object recipeMap = staticField("gregtech.api.recipe.RecipeMaps", mapName);
            if (recipeMap == null) continue;
            for (Object recipe : list(call(recipeMap, "getAllRecipes"))) {
                RecipeInfo info = new RecipeInfo(mapName, recipe,
                        recipeStacks(fieldOrNull(recipe, "mInputs"), mapName + " inputs"),
                        recipeStacks(fieldOrNull(recipe, "mOutputs"), mapName + " outputs"),
                        recipeFluids(fieldOrNull(recipe, "mFluidInputs")),
                        recipeFluids(fieldOrNull(recipe, "mFluidOutputs")));
                if (!info.hasResolvableItemStacks()) continue;
                if (!info.hasInputsOrOutputs()) continue;
                recipes.add(info);
            }
        }
        Collections.sort(recipes, new Comparator<RecipeInfo>() {
            @Override
            public int compare(RecipeInfo left, RecipeInfo right) {
                return left.sortKey().compareTo(right.sortKey());
            }
        });

        // Build a directional provenance closure.  Roots originate only from
        // material-carrying inputs.  A recipe's auxiliary inputs (water, acid,
        // cells, catalysts, and so on) remain visible in its graph, but never
        // acquire the root merely because they co-occur in that recipe.
        // Outputs carry a root forward only when GT's prefix parser or a
        // material-shaped item/fluid identity says that output belongs to it.
        Map<String, Set<RecipeInfo>> recipesByRoot = new TreeMap<>();
        Map<String, Set<String>> provenanceByKey = new TreeMap<>();
        int rootRecipeAssignments = 0;
        boolean changed = true;
        while (changed) {
            changed = false;
            for (RecipeInfo info : recipes) {
                Set<String> roots = info.rootCandidates(provenanceByKey);
                for (String root : roots) {
                    Set<RecipeInfo> rootRecipes = recipesByRoot.get(root);
                    if (rootRecipes == null) {
                        if (recipesByRoot.size() >= MAX_ORE_GRAPH_COUNT) {
                            throw oreGraphLimit("graph count during provenance closure", root,
                                    recipesByRoot.size() + 1, MAX_ORE_GRAPH_COUNT);
                        }
                        rootRecipes = new LinkedHashSet<>();
                        recipesByRoot.put(root, rootRecipes);
                    }
                    if (rootRecipes.size() >= MAX_ORE_GRAPH_RECIPES
                            && !rootRecipes.contains(info)) {
                        throw oreGraphLimit("recipe count during provenance closure", root,
                                rootRecipes.size() + 1, MAX_ORE_GRAPH_RECIPES);
                    }
                    if (!rootRecipes.add(info)) continue;
                    rootRecipeAssignments++;
                    if (rootRecipeAssignments > MAX_ORE_TOTAL_RECIPES) {
                        throw oreGraphLimit("total recipe assignments during provenance closure", root,
                                rootRecipeAssignments, MAX_ORE_TOTAL_RECIPES);
                    }
                    changed = true;
                    for (String outputKey : info.outputKeys) {
                        if (!info.outputBelongsTo(root, outputKey)) continue;
                        Set<String> outputRoots = provenanceByKey.get(outputKey);
                        if (outputRoots == null) {
                            outputRoots = new TreeSet<>();
                            provenanceByKey.put(outputKey, outputRoots);
                        }
                        if (outputRoots.add(root)) changed = true;
                    }
                }
            }
        }

        System.err.println("[RuntimeSpecialAdapter] GT ore provenance closure recipes=" + recipes.size()
                + " assignments=" + rootRecipeAssignments + " roots=" + recipesByRoot.size()
                + " propagatedKeys=" + provenanceByKey.size());
        int graphCount = 0;
        int totalRecipes = 0;
        int totalEdges = 0;
        int count = 0;
        for (Map.Entry<String, Set<RecipeInfo>> entry : recipesByRoot.entrySet()) {
            if (graphCount >= MAX_ORE_GRAPH_COUNT) {
                throw oreGraphLimit("graph count", entry.getKey(), graphCount + 1, MAX_ORE_GRAPH_COUNT);
            }
            Graph graph = new Graph(entry.getKey());
            List<RecipeInfo> rootRecipes = new ArrayList<>(entry.getValue());
            Collections.sort(rootRecipes, new Comparator<RecipeInfo>() {
                @Override
                public int compare(RecipeInfo left, RecipeInfo right) {
                    return left.sortKey().compareTo(right.sortKey());
                }
            });
            for (RecipeInfo info : rootRecipes) graph.addRecipe(sink, info);
            totalRecipes += graph.recipeCount;
            totalEdges += graph.edges.size();
            if (totalRecipes > MAX_ORE_TOTAL_RECIPES) {
                throw oreGraphLimit("total recipe count", entry.getKey(), totalRecipes,
                        MAX_ORE_TOTAL_RECIPES);
            }
            if (totalEdges > MAX_ORE_TOTAL_EDGES) {
                throw oreGraphLimit("total edge count", entry.getKey(), totalEdges, MAX_ORE_TOTAL_EDGES);
            }
            graphCount++;
            System.err.println("[RuntimeSpecialAdapter] GT ore graph " + graph.summary());
            Map<String, Object> payload = graph.payload();
            List<String> goods = graph.goods;
            String slug = slug(graph.root);
            sink.addRecord("ore-processing:" + slug, "gt-ore-processing",
                    "GT Ore Processing: " + graph.root,
                    searchText("gregtech", "gt-ore-processing", graph.root,
                            join(new ArrayList<String>(graph.machines), " ")), goods,
                    "special:ore-processing:" + slug + ":recipes",
                    "special:ore-processing:" + slug + ":usages", "service:ore-processing", payload);
            count++;
        }
        requireRecords("gt-ore-processing", count);
    }

    private static IllegalStateException oreGraphLimit(String kind, String material, long actual, long limit) {
        return new IllegalStateException("GT ore graph " + material + " exceeded " + kind
                + " guardrail: " + actual + " > " + limit);
    }

    private static final class RecipeInfo {
        private final String mapName;
        private final Object recipe;
        private final List<ItemStack> inputs;
        private final List<ItemStack> outputs;
        private final List<FluidStack> fluidInputs;
        private final List<FluidStack> fluidOutputs;
        private final List<String> inputKeys;
        private final List<String> outputKeys;
        private final Map<String, Set<String>> inputMaterialLabels;
        private final Map<String, Set<String>> outputMaterialLabels;

        private RecipeInfo(String mapName, Object recipe, List<ItemStack> inputs,
                List<ItemStack> outputs, List<FluidStack> fluidInputs, List<FluidStack> fluidOutputs) {
            this.mapName = mapName;
            this.recipe = recipe;
            this.inputs = inputs;
            this.outputs = outputs;
            this.fluidInputs = fluidInputs;
            this.fluidOutputs = fluidOutputs;
            this.inputKeys = new ArrayList<>();
            this.outputKeys = new ArrayList<>();
            this.inputMaterialLabels = new TreeMap<>();
            this.outputMaterialLabels = new TreeMap<>();
            for (ItemStack stack : inputs) {
                if (stack == null) continue;
                String key = "item:" + stableStackName(stack);
                inputKeys.add(key);
                List<String> labels = oreSeedMaterials(Collections.singletonList(stack));
                addMaterialLabels(inputMaterialLabels, key, labels);
            }
            for (FluidStack stack : fluidInputs) if (stack != null) inputKeys.add("fluid:" + fluidName(stack));
            for (ItemStack stack : outputs) {
                if (stack == null) continue;
                String key = "item:" + stableStackName(stack);
                outputKeys.add(key);
                addMaterialLabels(outputMaterialLabels, key,
                        oreSeedMaterials(Collections.singletonList(stack)));
            }
            for (FluidStack stack : fluidOutputs) if (stack != null) outputKeys.add("fluid:" + fluidName(stack));
        }

        private static void addMaterialLabels(Map<String, Set<String>> labelsByKey, String key,
                Collection<String> labels) {
            if (labels.isEmpty()) return;
            Set<String> labelsForKey = labelsByKey.get(key);
            if (labelsForKey == null) {
                labelsForKey = new TreeSet<>();
                labelsByKey.put(key, labelsForKey);
            }
            labelsForKey.addAll(labels);
        }

        private boolean hasInputsOrOutputs() {
            return !inputKeys.isEmpty() || !outputKeys.isEmpty();
        }

        private Set<String> rootCandidates(Map<String, Set<String>> provenanceByKey) {
            Set<String> roots = new TreeSet<>();
            for (Set<String> labels : inputMaterialLabels.values()) roots.addAll(labels);
            for (String key : inputKeys) {
                Set<String> known = provenanceByKey.get(key);
                if (known != null) roots.addAll(known);
            }
            return roots;
        }

        private boolean outputBelongsTo(String root, String outputKey) {
            Set<String> directLabels = outputMaterialLabels.get(outputKey);
            // A direct parser label is authoritative.  In particular, a gold
            // byproduct from an iron recipe must not gain iron provenance just
            // because its identity happens to contain a shared token.
            if (directLabels != null && !directLabels.isEmpty()) return directLabels.contains(root);
            return normalizedIdentityMatches(outputKey, root);
        }

        private boolean hasResolvableItemStacks() {
            if (!hasCompactSlots(inputs, "item input") || !hasCompactSlots(outputs, "item output")
                    || !hasCompactFluidSlots(fluidInputs, "fluid input")
                    || !hasCompactFluidSlots(fluidOutputs, "fluid output")) return false;
            for (ItemStack stack : inputs) {
                if (stack == null) continue;
                if (itemRegistrationProblem(stack) != null) {
                    noteSkippedItem("GT ore-processing " + mapName + " input", stack,
                            itemRegistrationProblem(stack));
                    return false;
                }
            }
            for (ItemStack stack : outputs) {
                if (stack == null) continue;
                if (itemRegistrationProblem(stack) != null) {
                    noteSkippedItem("GT ore-processing " + mapName + " output", stack,
                            itemRegistrationProblem(stack));
                    return false;
                }
            }
            return true;
        }

        /** GT's normal builder removes trailing nulls; interior holes are not chance-indexable. */
        private boolean hasCompactSlots(List<ItemStack> slots, String context) {
            boolean nullSeen = false;
            for (ItemStack stack : slots) {
                if (stack == null) {
                    nullSeen = true;
                } else if (nullSeen) {
                    noteDiagnostic("[RuntimeSpecialAdapter] Skipping " + mapName + " recipe with interior null "
                            + context + "; GT chance indexes would be ambiguous");
                    return false;
                }
            }
            return true;
        }

        private boolean hasCompactFluidSlots(List<FluidStack> slots, String context) {
            boolean nullSeen = false;
            for (FluidStack stack : slots) {
                if (stack == null) {
                    nullSeen = true;
                } else if (nullSeen) {
                    noteDiagnostic("[RuntimeSpecialAdapter] Skipping " + mapName + " recipe with interior null "
                            + context + "; GT chance indexes would be ambiguous");
                    return false;
                }
            }
            return true;
        }

        private String sortKey() {
            return mapName + "|" + join(inputKeys, ",") + "->" + join(outputKeys, ",")
                    + "|" + number(fieldOrNull(recipe, "mDuration")) + ":"
                    + number(fieldOrNull(recipe, "mEUt"));
        }
    }

    private static final class Graph {
        private final String root;
        private final Map<String, Map<String, Object>> nodes = new TreeMap<>();
        private final List<Map<String, Object>> edges = new ArrayList<>();
        private final Set<String> goodsSet = new LinkedHashSet<>();
        private final Set<String> machines = new TreeSet<>();
        private final List<String> goods = new ArrayList<>();
        private int recipeCount;

        private Graph(String root) {
            this.root = root;
        }

        private void addRecipe(NeiSpecialOverlay.Sink sink, RecipeInfo info) {
            if (recipeCount >= MAX_ORE_GRAPH_RECIPES) {
                throw oreGraphLimit("recipe count", root, recipeCount + 1, MAX_ORE_GRAPH_RECIPES);
            }
            int potentialNodes = info.inputs.size() + info.outputs.size()
                    + info.fluidInputs.size() + info.fluidOutputs.size();
            long potentialEdges = (long) (info.inputs.size() + info.fluidInputs.size())
                    * (info.outputs.size() + info.fluidOutputs.size());
            if (nodes.size() + potentialNodes > MAX_ORE_GRAPH_NODES) {
                throw oreGraphLimit("potential node count", root, nodes.size() + potentialNodes,
                        MAX_ORE_GRAPH_NODES);
            }
            if (edges.size() + potentialEdges > MAX_ORE_GRAPH_EDGES) {
                throw oreGraphLimit("potential edge count", root, edges.size() + potentialEdges,
                        MAX_ORE_GRAPH_EDGES);
            }
            int rank = rank(info.mapName);
            List<String> inputGoods = retainItemSlots(sink, info.inputs);
            List<String> outputGoods = retainItemSlots(sink, info.outputs);
            if (inputGoods == null || outputGoods == null) return;
            List<String> fluidInputGoods = retainFluidSlots(sink, info.fluidInputs);
            List<String> fluidOutputGoods = retainFluidSlots(sink, info.fluidOutputs);
            List<String> from = concat(inputGoods, fluidInputGoods);
            List<String> to = concat(outputGoods, fluidOutputGoods);
            int newNodes = 0;
            Set<String> unseen = new HashSet<>();
            for (String id : concat(from, to)) if (!nodes.containsKey(id) && unseen.add(id)) newNodes++;
            if (nodes.size() + newNodes > MAX_ORE_GRAPH_NODES) {
                throw oreGraphLimit("node count", root, nodes.size() + newNodes, MAX_ORE_GRAPH_NODES);
            }
            long newEdges = (long) from.size() * to.size();
            if (edges.size() + newEdges > MAX_ORE_GRAPH_EDGES) {
                throw oreGraphLimit("edge count", root, edges.size() + newEdges, MAX_ORE_GRAPH_EDGES);
            }
            for (String id : concat(from, to)) addNode(id, rank);
            String machine = machineLabel(info.mapName);
            machines.add(machine);
            recipeCount++;
            for (int inputIndex = 0; inputIndex < from.size(); inputIndex++) {
                for (int outputIndex = 0; outputIndex < to.size(); outputIndex++) {
                    Map<String, Object> edge = new LinkedHashMap<>();
                    edge.put("from", from.get(inputIndex));
                    edge.put("to", to.get(outputIndex));
                    edge.put("machine", machine);
                    edge.put("durationTicks", number(fieldOrNull(info.recipe, "mDuration")));
                    edge.put("euPerTick", number(fieldOrNull(info.recipe, "mEUt")));
                    int itemInputCount = info.inputs.size();
                    int itemOutputCount = info.outputs.size();
                    boolean inputIsFluid = inputIndex >= itemInputCount;
                    boolean outputIsFluid = outputIndex >= itemOutputCount;
                    int actualInputIndex = inputIsFluid ? inputIndex - itemInputCount : inputIndex;
                    int actualOutputIndex = outputIsFluid ? outputIndex - itemOutputCount : outputIndex;
                    int inputChance = inputIsFluid
                            ? recipeChance(info.recipe, "getFluidInputChance", actualInputIndex,
                                    "mFluidInputChances")
                            : recipeChance(info.recipe, "getInputChance", actualInputIndex, "mInputChances");
                    int outputChance = outputIsFluid
                            ? recipeChance(info.recipe, "getFluidOutputChance", actualOutputIndex,
                                    "mFluidOutputChances")
                            : recipeChance(info.recipe, "getOutputChance", actualOutputIndex, "mOutputChances");
                    edge.put("inputChance", inputChance);
                    edge.put("outputChance", outputChance);
                    edge.put("inputProbability", inputChance / 10000.0);
                    edge.put("probability", outputChance / 10000.0);
                    if (!inputIsFluid) edge.put("inputAmount", info.inputs.get(actualInputIndex).stackSize);
                    if (!outputIsFluid) edge.put("outputAmount", info.outputs.get(actualOutputIndex).stackSize);
                    edges.add(edge);
                }
            }
        }

        private void addNode(String goodsId, int rank) {
            goodsSet.add(goodsId);
            if (!nodes.containsKey(goodsId)) {
                Map<String, Object> node = new LinkedHashMap<>();
                node.put("id", goodsId);
                node.put("goodsId", goodsId);
                node.put("rank", rank);
                nodes.put(goodsId, node);
            }
        }

        private Map<String, Object> payload() {
            if (recipeCount > MAX_ORE_GRAPH_RECIPES)
                throw oreGraphLimit("recipe count", root, recipeCount, MAX_ORE_GRAPH_RECIPES);
            if (nodes.size() > MAX_ORE_GRAPH_NODES)
                throw oreGraphLimit("node count", root, nodes.size(), MAX_ORE_GRAPH_NODES);
            if (edges.size() > MAX_ORE_GRAPH_EDGES)
                throw oreGraphLimit("edge count", root, edges.size(), MAX_ORE_GRAPH_EDGES);
            goods.clear();
            goods.addAll(goodsSet);
            Collections.sort(goods);
            sortMaps(edges, "from");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("material", root);
            payload.put("recipeCount", recipeCount);
            payload.put("nodeCount", nodes.size());
            payload.put("edgeCount", edges.size());
            payload.put("nodes", new ArrayList<>(nodes.values()));
            payload.put("edges", edges);
            payload.put("machines", new ArrayList<>(machines));
            payload.put("stages", Arrays.asList("maceration", "washing", "thermal-centrifuging",
                    "centrifuging", "electromagnetic-separation", "chemical-bath", "sifting", "furnace",
                    "blast-furnace", "reactor", "mixer", "autoclave", "extractor", "fluid-extraction"));
            return payload;
        }

        private String summary() {
            return "material=" + root + " recipes=" + recipeCount + " nodes=" + nodes.size()
                    + " edges=" + edges.size();
        }

        private static int rank(String mapName) {
            int index = Arrays.asList(PROCESS_MAPS).indexOf(mapName);
            return index < 0 ? 0 : index;
        }
    }

    private static List<String> cropGoods(NeiSpecialOverlay.Sink sink, Object crop) {
        List<String> goods = new ArrayList<>();
        Object drops = callOrNull(crop, "getDropTable");
        if (drops instanceof Map) {
            for (Object stack : ((Map<?, ?>) drops).keySet()) addItem(sink, goods, stack, "crop drop");
        }
        for (Object stack : list(callOrNull(crop, "getAlternateSeeds"))) addItem(sink, goods, stack, "alternate seed");
        for (Object stack : list(callOrNull(crop, "getSoilsForNEI", false))) addItem(sink, goods, stack, "crop soil");
        for (Object stack : list(callOrNull(crop, "getBlocksUnderForNEI", false))) addItem(sink, goods, stack, "crop block");
        Collections.sort(goods);
        return unique(goods);
    }

    private static List<Object> cropDrops(NeiSpecialOverlay.Sink sink, Object crop) {
        List<Object> result = new ArrayList<>();
        Object table = callOrNull(crop, "getDropTable");
        if (!(table instanceof Map)) return result;
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) table).entrySet()) {
            ItemStack stack = asItemStack(entry.getKey(), "crop drop");
            if (stack == null) continue;
            String goodsId = retainItemOrNull(sink, stack, "crop drop");
            if (goodsId == null) continue;
            Map<String, Object> drop = new LinkedHashMap<>();
            drop.put("goodsId", goodsId);
            drop.put("amount", number(entry.getValue()));
            drop.put("chance", number(callOrNull(crop, "getDropChance")));
            result.add(drop);
        }
        sortMaps(result, "goodsId");
        return result;
    }

    private static List<Object> meteorComponents(NeiSpecialOverlay.Sink sink, Object value, List<String> goods,
            int radius, double fillerChance, boolean filler) throws Exception {
        List<Object> result = new ArrayList<>();
        int totalWeight = intValue(call(Class.forName(
                "WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorComponent"),
                "getTotalListWeight", value));
        double roleRatio = filler ? fillerChance / 100.0 : 1.0 - (fillerChance / 100.0);
        double volume = 4.1887903296220665 * Math.pow(radius + 0.5, 3.0);
        for (Object component : list(value)) {
            ItemStack stack = asItemStack(call(component, "getBlock"), "meteor component");
            if (stack == null) continue;
            String goodsId = retainItemOrNull(sink, stack, "meteor component");
            if (goodsId == null) continue;
            addAllUnique(goods, Collections.singletonList(goodsId));
            int weight = intValue(call(component, "getWeight"));
            double probability = totalWeight <= 0 ? 0.0 : (weight / (double) totalWeight) * roleRatio;
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("goodsId", goodsId);
            payload.put("weight", weight);
            payload.put("chance", probability);
            payload.put("probability", probability);
            payload.put("estimatedAmount", (int) Math.ceil(volume * probability));
            payload.put("role", filler ? "filler" : "ore");
            payload.put("requiredReagents", reagentNames(callOrNull(component, "getRequiredReagents")));
            result.add(payload);
        }
        sortMaps(result, "goodsId");
        return result;
    }

    private static int meteorTotalWeight(Object value) throws Exception {
        return intValue(call(Class.forName(
                "WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorComponent"),
                "getTotalListWeight", value));
    }

    private static Map<String, Object> estimatedMeteorAmounts(List<Object> outputs) {
        Map<String, Double> sums = new TreeMap<>();
        for (Object value : outputs) {
            if (!(value instanceof Map)) continue;
            Object goodsId = ((Map<?, ?>) value).get("goodsId");
            Object amount = ((Map<?, ?>) value).get("estimatedAmount");
            if (!(goodsId instanceof String) || !(amount instanceof Number)) continue;
            Double previous = sums.get(goodsId);
            sums.put((String) goodsId, (previous == null ? 0.0 : previous) + ((Number) amount).doubleValue());
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, Double> entry : sums.entrySet()) result.put(entry.getKey(), entry.getValue().intValue());
        return result;
    }

    private static List<String> meteorRequirements(List<Object> outputs) {
        List<String> result = new ArrayList<>();
        for (Object value : outputs) {
            if (!(value instanceof Map)) continue;
            Object required = ((Map<?, ?>) value).get("requiredReagents");
            if (required instanceof Collection) {
                for (Object reagent : (Collection<?>) required) result.add(String.valueOf(reagent));
            }
        }
        return uniqueSorted(result);
    }

    private static Object ritualDefinition(String ritualId) {
        Object raw = staticField("WayofTime.alchemicalWizardry.api.rituals.Rituals", "ritualMap");
        if (!(raw instanceof Map)) throw new IllegalStateException("Blood Magic ritualMap is not a map");
        Object ritual = ((Map<?, ?>) raw).get(ritualId);
        if (ritual == null) throw new IllegalStateException("Blood Magic ritual is missing: " + ritualId);
        return ritual;
    }

    private static List<Object> meteorReagents() throws Exception {
        List<Object> result = new ArrayList<>();
        Object map = staticField("WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorReagentRegistry", "reagents");
        if (map instanceof Map) {
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) map).entrySet()) {
                Object reagent = entry.getKey();
                Object definition = entry.getValue();
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("name", stringOrEmpty(callOrNull(reagent, "name")));
                payload.put("intensity", number(callOrNull(reagent, "intensity")));
                payload.put("radiusChange", number(fieldOrNull(definition, "radiusChange")));
                payload.put("fillerChanceChange", number(fieldOrNull(definition, "fillerChanceChange")));
                payload.put("rawFillerChanceChange", number(fieldOrNull(definition, "rawFillerChanceChange")));
                payload.put("disableExplosions", bool(fieldOrNull(definition, "disableExplosions")));
                payload.put("invertExplosionBlockDamage", bool(fieldOrNull(definition, "invertExplosionBlockDamage")));
                payload.put("destroysBlocks", bool(callOrNull(Class.forName(
                        "WayofTime.alchemicalWizardry.common.summoning.meteor.MeteorReagentRegistry"),
                        "doMeteorsDestroyBlocks", Collections.singletonList(reagent))));
                payload.put("effect", meteorReagentEffect(payload));
                payload.put("filler", meteorReagentFiller(definition));
                result.add(payload);
            }
        }
        sortMaps(result, "name");
        return result;
    }

    private static String meteorReagentEffect(Map<String, Object> payload) {
        List<String> effects = new ArrayList<>();
        effects.add("radius " + payload.get("radiusChange"));
        effects.add("filler chance " + payload.get("fillerChanceChange"));
        effects.add("raw filler chance " + payload.get("rawFillerChanceChange"));
        if (Boolean.TRUE.equals(payload.get("disableExplosions"))) effects.add("disable explosions");
        if (Boolean.TRUE.equals(payload.get("invertExplosionBlockDamage"))) effects.add("invert explosion damage");
        if (Boolean.TRUE.equals(payload.get("destroysBlocks"))) effects.add("destroy blocks");
        return join(effects, ", ");
    }

    private static List<Object> meteorReagentFiller(Object definition) {
        List<Object> result = new ArrayList<>();
        for (Object component : list(fieldOrNull(definition, "filler"))) {
            ItemStack stack = asItemStack(callOrNull(component, "getBlock"), "meteor reagent filler");
            if (stack == null) continue;
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("stack", stableStackName(stack));
            value.put("weight", number(callOrNull(component, "getWeight")));
            value.put("requiredReagents", reagentNames(callOrNull(component, "getRequiredReagents")));
            result.add(value);
        }
        sortMaps(result, "stack");
        return result;
    }

    private static List<String> reagentNames(Object value) {
        List<String> result = new ArrayList<>();
        for (Object reagent : list(value)) {
            result.add(stringOrEmpty(callOrNull(reagent, "name")));
        }
        Collections.sort(result);
        return unique(result);
    }

    private static List<Object> fortuneChances(Object handler, Object group, List<Object> ignored) {
        List<Object> result = new ArrayList<>();
        for (String level : new String[] {"LV0", "LV1", "LV2", "LV3"}) {
            try {
                Object enumLevel = Enum.valueOf((Class) Class.forName(
                        "eu.usrv.enhancedlootbags.core.LootGroupsHandler$FortuneLevel"), level);
                double total = 0.0;
                for (Object drop : list(call(group, "getDrops"))) {
                    Object value = call(handler, "calcPercentageFromWeight", drop, group, enumLevel);
                    if (value instanceof Number) total += ((Number) value).doubleValue();
                }
                result.add(total);
            } catch (Throwable error) {
                throw new IllegalStateException("Could not evaluate EnhancedLootBags fortune level " + level, error);
            }
        }
        return result;
    }

    private static List<Object> currencyPayload(NeiSpecialOverlay.Sink sink, Object value, List<String> goods) {
        List<Object> result = new ArrayList<>();
        for (Object currency : list(value)) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("type", String.valueOf(fieldOrNull(currency, "type")));
            payload.put("value", number(fieldOrNull(currency, "value")));
            List<String> currencyGoods = retainItems(sink, stacks(callOrNull(currency, "itemize")));
            payload.put("goodsIds", currencyGoods);
            addAllUnique(goods, currencyGoods);
            result.add(payload);
        }
        return result;
    }

    private static List<Object> bigStacks(NeiSpecialOverlay.Sink sink, Object value, List<String> goods) {
        List<Object> result = new ArrayList<>();
        for (Object stack : list(value)) result.add(bigStack(sink, stack, goods));
        return result;
    }

    private static Object bigStack(NeiSpecialOverlay.Sink sink, Object value, List<String> goods) {
        if (value == null) return null;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("amount", number(fieldOrNull(value, "stackSize")));
        payload.put("oreDictionary", stringOrEmpty(callOrNull(value, "getOreDict")));
        List<String> ids = retainItems(sink, stacks(callOrNull(value, "getCombinedStacks")));
        if (ids.isEmpty()) {
            Object ingredient = callOrNull(value, "getOreIngredient");
            ids.addAll(retainItems(sink, stacks(callOrNull(ingredient, "getMatchingStacks"))));
        }
        if (ids.isEmpty()) {
            ItemStack base = asItemStack(callOrNull(value, "getBaseStack"), "vending item");
            if (base != null) {
                String baseId = retainItemOrNull(sink, base, "vending item");
                if (baseId != null) ids.add(baseId);
            }
        }
        payload.put("goodsIds", ids);
        addAllUnique(goods, ids);
        return payload;
    }

    private static List<Object> itemPayloads(NeiSpecialOverlay.Sink sink, Object value) {
        List<Object> result = new ArrayList<>();
        for (Object stack : list(value)) {
            ItemStack item = asItemStack(stack, "item payload");
            if (item == null) continue;
            String goodsId = retainItemOrNull(sink, item, "item payload");
            if (goodsId == null) continue;
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("goodsId", goodsId);
            result.add(payload);
        }
        sortMaps(result, "goodsId");
        return result;
    }

    private static List<Object> itemPayloadsNested(NeiSpecialOverlay.Sink sink, Object value) {
        List<Object> result = new ArrayList<>();
        for (Object nested : list(value)) result.add(itemPayloads(sink, nested));
        return result;
    }

    private static void addAllGoodsFromPayload(List<Object> payload, List<String> goods) {
        for (Object entry : payload) {
            if (entry instanceof Map) {
                Object id = ((Map<?, ?>) entry).get("goodsId");
                if (id instanceof String) addAllUnique(goods, Collections.singletonList((String) id));
                Object ids = ((Map<?, ?>) entry).get("goodsIds");
                if (ids instanceof Collection) for (Object item : (Collection<?>) ids)
                    if (item instanceof String) addAllUnique(goods, Collections.singletonList((String) item));
            } else if (entry instanceof Collection) addAllGoodsFromPayload((List<Object>) entry, goods);
        }
    }

    private static List<String> materialGoods(NeiSpecialOverlay.Sink sink, Object material, String... prefixes) {
        List<String> result = new ArrayList<>();
        if (material == null) return result;
        Object prefixClass = null;
        try { prefixClass = Class.forName("gregtech.api.enums.OrePrefixes"); }
        catch (ClassNotFoundException error) { throw new IllegalStateException("GT OrePrefixes API is missing", error); }
        for (String prefix : prefixes) {
            Object orePrefix = fieldOrNull(prefixClass, prefix);
            if (orePrefix == null) continue;
            ItemStack stack = materialPart(material, orePrefix, "GT material " + materialName(material));
            if (stack != null) {
                String goodsId = retainItemOrNull(sink, stack, "GT material " + materialName(material));
                if (goodsId != null) result.add(goodsId);
            }
        }
        return uniqueSorted(result);
    }

    private static ItemStack materialPart(Object material, Object orePrefix, String context) {
        try {
            return asItemStack(callOrNull(material, "getPart", orePrefix, 1), context);
        } catch (RuntimeException error) {
            if (!containsCauseText(error, "NO SUCH ITEM")
                    && !containsCauseText(error, "getCorrespondingItemStack")) throw error;
            noteDiagnostic("[RuntimeSpecialAdapter] Skipping unavailable " + context + ": "
                    + error.getMessage());
            return null;
        }
    }

    private static boolean containsCauseText(Throwable error, String text) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (String.valueOf(current.getMessage()).contains(text)) return true;
        }
        return false;
    }

    private static void noteDiagnostic(String diagnostic) {
        if (SKIPPED_ITEM_DIAGNOSTICS.add(diagnostic)) System.err.println(diagnostic);
    }

    private static String materialName(Object material) {
        return stringOrEmpty(callOrNull(material, "getInternalName"));
    }

    private static double oreLayerChance(String fieldName) {
        if ("mSporadic".equals(fieldName)) return 1.0 / 7.0;
        return 2.0 / 7.0;
    }

    private static int oreLayerWeight(String fieldName) {
        return "mSporadic".equals(fieldName) ? 1 : 2;
    }

    private static Map<String, Object> dimensionChance(Object layer, List<String> dimensions) {
        Map<String, Object> result = new LinkedHashMap<>();
        Number weight = number(callOrNull(layer, "getWeight"));
        for (String dimension : dimensions) {
            // GTNH 2.9.0-beta-2 has one global mWeight; the dimension gate is
            // binary. Keep that exact weight beside each allowed dimension so
            // consumers do not mistake an omitted dimension for zero chance.
            result.put(dimension, weight);
        }
        return result;
    }

    private static Map<String, Object> binaryDimensionChance(List<String> dimensions) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String dimension : dimensions) result.put(dimension, 1.0);
        return result;
    }

    private static List<Object> dimensionOverrides(Object layer) {
        List<Object> result = new ArrayList<>();
        Object raw = fieldOrNull(layer, "dimVeinHeights");
        if (!(raw instanceof Map)) return result;
        List<String> dimensions = new ArrayList<>();
        for (Object key : ((Map<?, ?>) raw).keySet()) dimensions.add(String.valueOf(key));
        Collections.sort(dimensions);
        for (String dimension : dimensions) {
            Object pair = ((Map<?, ?>) raw).get(dimension);
            Map<String, Object> override = new LinkedHashMap<>();
            override.put("dimension", dimension);
            override.put("minY", pairShort(pair, "leftShort", "left"));
            override.put("maxY", pairShort(pair, "rightShort", "right"));
            result.add(override);
        }
        return result;
    }

    private static Number pairShort(Object pair, String method, String fallback) {
        Object value = callOrNull(pair, method);
        if (value == null) value = callOrNull(pair, fallback);
        return number(value);
    }

    private static List<Object> smallOrePotentialDrops(NeiSpecialOverlay.Sink sink, Object material,
            List<String> goods) throws Exception {
        Object raw = staticCall("gregtech.common.ores.SmallOreDrops", "getDropList", material);
        List<ItemStack> stacks = stacks(raw);
        Map<String, Integer> counts = new TreeMap<>();
        for (ItemStack stack : stacks) {
            if (stack == null) continue;
            String goodsId = retainItemOrNull(sink, stack, "GT small-ore potential drop");
            if (goodsId == null) continue;
            addAllUnique(goods, Collections.singletonList(goodsId));
            Integer count = counts.get(goodsId);
            counts.put(goodsId, count == null ? 1 : count + 1);
        }
        int total = 0;
        for (Integer count : counts.values()) total += count;
        List<Object> result = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            Map<String, Object> drop = new LinkedHashMap<>();
            drop.put("goodsId", entry.getKey());
            drop.put("chance", total == 0 ? 0.0 : entry.getValue() / (double) total);
            drop.put("min", 1);
            drop.put("max", 1);
            result.add(drop);
        }
        return result;
    }

    private static Map<String, Object> dimensionHeights(Object layer, List<String> dimensions)
            throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String dimension : dimensions) {
            Map<String, Object> range = new LinkedHashMap<>();
            range.put("minY", number(call(layer, "getMinY", dimension)));
            range.put("maxY", number(call(layer, "getMaxY", dimension)));
            result.put(dimension, range);
        }
        return result;
    }

    private static String cropTitle(Object crop, String id) {
        String unlocalized = stringOrEmpty(callOrNull(crop, "getUnlocalizedName"));
        return unlocalized.length() == 0 ? id : unlocalized;
    }

    private static List<String> requirementDescriptions(Object value) {
        List<String> result = new ArrayList<>();
        for (Object requirement : list(value)) {
            Object description = callOrNull(requirement, "getDescriptionForNEI");
            if (description == null) description = callOrNull(requirement, "getDescription");
            if (description == null) description = String.valueOf(requirement);
            result.add(String.valueOf(description));
        }
        Collections.sort(result);
        return unique(result);
    }

    private static List<String> stringCollection(Object value) {
        List<String> result = new ArrayList<>();
        for (Object entry : list(value)) result.add(String.valueOf(entry));
        return uniqueSorted(result);
    }

    private static List<String> sortedStrings(Object value) {
        return stringCollection(value);
    }

    private static List<String> retainItems(NeiSpecialOverlay.Sink sink, List<ItemStack> stacks) {
        List<String> result = new ArrayList<>();
        for (ItemStack stack : stacks) {
            if (stack == null) continue;
            String goodsId = retainItemOrNull(sink, stack, "item collection");
            if (goodsId != null) result.add(goodsId);
        }
        return uniqueSorted(result);
    }

    private static List<String> retainItemSlots(NeiSpecialOverlay.Sink sink, List<ItemStack> stacks) {
        List<String> result = new ArrayList<>();
        for (ItemStack stack : stacks) {
            if (stack == null) continue;
            String goodsId = retainItemOrNull(sink, stack, "GT ore-processing recipe slot");
            // Do not compact a partially retained recipe: the edge builder
            // indexes chances and amounts by the original slot positions.
            // Rejecting the whole recipe is the only safe representation when
            // Forge cannot assign one slot a goods ID.
            if (goodsId == null) return null;
            result.add(goodsId);
        }
        return result;
    }

    private static List<String> retainFluids(NeiSpecialOverlay.Sink sink, List<FluidStack> stacks) {
        List<String> result = new ArrayList<>();
        for (FluidStack stack : stacks) if (stack != null) result.add(sink.retainFluid(stack));
        return uniqueSorted(result);
    }

    private static List<String> retainFluidSlots(NeiSpecialOverlay.Sink sink, List<FluidStack> stacks) {
        List<String> result = new ArrayList<>();
        for (FluidStack stack : stacks) if (stack != null) result.add(sink.retainFluid(stack));
        return result;
    }

    private static List<ItemStack> stacks(Object value) {
        List<ItemStack> result = new ArrayList<>();
        for (Object valueEntry : arrayOrCollection(value)) {
            ItemStack stack = asItemStack(valueEntry, "item stack array");
            if (stack != null) result.add(stack);
        }
        return result;
    }

    /** Preserve recipe-array positions so chance indexes cannot shift silently. */
    private static List<ItemStack> recipeStacks(Object value, String context) {
        List<Object> entries = arrayOrCollection(value);
        int end = entries.size();
        while (end > 0 && entries.get(end - 1) == null) end--;
        List<ItemStack> result = new ArrayList<>();
        for (int index = 0; index < end; index++) {
            result.add(asItemStack(entries.get(index), context + " slot " + index));
        }
        return result;
    }

    private static List<FluidStack> fluids(Object value) {
        List<FluidStack> result = new ArrayList<>();
        for (Object valueEntry : arrayOrCollection(value)) {
            if (valueEntry instanceof FluidStack) result.add((FluidStack) valueEntry);
        }
        return result;
    }

    /** Preserve non-trailing fluid slots for the same reason as recipeStacks. */
    private static List<FluidStack> recipeFluids(Object value) {
        List<Object> entries = arrayOrCollection(value);
        int end = entries.size();
        while (end > 0 && entries.get(end - 1) == null) end--;
        List<FluidStack> result = new ArrayList<>();
        for (int index = 0; index < end; index++) {
            Object entry = entries.get(index);
            if (entry != null && !(entry instanceof FluidStack)) {
                throw new IllegalStateException("recipe fluid slot " + index + " is not a FluidStack: " + entry);
            }
            result.add((FluidStack) entry);
        }
        return result;
    }

    private static ItemStack sampleWeighted(Object weighted, long seed) {
        if (weighted == null) return null;
        Object nested = fieldOrNull(weighted, "items");
        if (nested instanceof Collection && !((Collection<?>) nested).isEmpty()) {
            for (Object child : (Collection<?>) nested) {
                ItemStack sample = sampleWeighted(child, seed);
                if (sample != null) return sample;
            }
        }
        Object value = callOrNull(weighted, "get", new Random(seed));
        return asItemStack(value, "Roguelike weighted loot");
    }

    private static void addItem(NeiSpecialOverlay.Sink sink, List<String> target, Object value, String context) {
        ItemStack stack = asItemStack(value, context);
        if (stack != null) {
            String goodsId = retainItemOrNull(sink, stack, context);
            if (goodsId != null) addAllUnique(target, Collections.singletonList(goodsId));
        }
    }

    private static ItemStack asItemStack(Object value, String context) {
        if (value == null) return null;
        if (!(value instanceof ItemStack)) throw new IllegalStateException(context + " is not an ItemStack: " + value);
        return (ItemStack) value;
    }

    private static List<Object> list(Object value) {
        if (value == null) return Collections.emptyList();
        if (value instanceof Collection) return new ArrayList<>((Collection<?>) value);
        if (value.getClass().isArray()) return arrayOrCollection(value);
        return Collections.singletonList(value);
    }

    private static List<Object> arrayOrCollection(Object value) {
        if (value == null) return Collections.emptyList();
        List<Object> result = new ArrayList<>();
        if (value instanceof Collection) result.addAll((Collection<?>) value);
        else if (value.getClass().isArray()) {
            for (int index = 0; index < Array.getLength(value); index++) result.add(Array.get(value, index));
        } else result.add(value);
        return result;
    }

    private static List<Object> sortedObjects(Object value, final String key) {
        List<Object> result = list(value);
        Collections.sort(result, new Comparator<Object>() {
            @Override
            public int compare(Object left, Object right) { return stableObjectName(left).compareTo(stableObjectName(right)); }
        });
        return result;
    }

    private static String stableObjectName(Object value) {
        if (value == null) return "";
        for (String method : new String[] {
                "getId", "getName", "getUnlocalizedName", "getUnlocalisedName", "getGroupID",
                "getIdentifier"
        }) {
            Object candidate = callOrNull(value, method);
            if (candidate != null) return String.valueOf(candidate);
        }
        return value.getClass().getName() + ":" + String.valueOf(value);
    }

    private static String mutationKey(Object mutation) {
        Object output = callOrNull(mutation, "getOutput");
        String outputId = output == null ? "" : stringOrEmpty(callOrNull(output, "getId"));
        List<String> parents = new ArrayList<>();
        for (Object parent : list(callOrNull(mutation, "getParents"))) {
            parents.add(stringOrEmpty(callOrNull(parent, "getId")));
        }
        Collections.sort(parents);
        return outputId + "|" + join(parents, ",");
    }

    private static String stableStackName(ItemStack stack) {
        if (stack == null) return "";
        Item item = stack.getItem();
        String uniqueName = item == null ? null : ITEM_UNIQUE_NAMES.get(item);
        if (uniqueName == null && item != null && itemRegistrationProblem(stack) == null) {
            uniqueName = ITEM_UNIQUE_NAMES.get(item);
        }
        if (uniqueName == null) {
            String unlocalized;
            try {
                unlocalized = item == null ? "null-item" : stringOrEmpty(item.getUnlocalizedName());
            } catch (Throwable error) {
                unlocalized = item == null ? "null-item" : item.getClass().getName();
            }
            uniqueName = "unregistered:" + unlocalized;
        }
        return uniqueName + ":" + stack.getItemDamage() + stableTagName(stack.getTagCompound());
    }

    private static String stableTagName(NBTTagCompound tag) {
        if (tag == null || tag.hasNoTags()) return "";
        return stableTagValue(tag);
    }

    private static String stableTagValue(NBTBase value) {
        if (value == null) return "null";
        if (!(value instanceof NBTTagCompound) && !(value instanceof NBTTagList)) {
            return String.valueOf(value);
        }
        if (value instanceof NBTTagList) {
            Object raw = fieldOrNull(value, "tagList");
            StringBuilder listValue = new StringBuilder("[");
            if (raw instanceof Collection) {
                boolean first = true;
                for (Object entry : (Collection<?>) raw) {
                    if (!first) listValue.append(';');
                    first = false;
                    listValue.append(stableTagValue((NBTBase) entry));
                }
            }
            return listValue.append(']').toString();
        }
        NBTTagCompound compound = (NBTTagCompound) value;
        List<String> keys = new ArrayList<>();
        for (Object key : compound.func_150296_c()) keys.add(String.valueOf(key));
        Collections.sort(keys);
        StringBuilder result = new StringBuilder("{");
        boolean first = true;
        for (String key : keys) {
            if (!first) result.append(';');
            first = false;
            result.append(key).append('=').append(stableTagValue(compound.getTag(key)));
        }
        return result.append('}').toString();
    }

    private static String fluidName(FluidStack stack) {
        if (stack == null || stack.getFluid() == null) return "";
        return stringOrEmpty(stack.getFluid().getName());
    }

    private static List<String> oreSeedMaterials(List<ItemStack> stacks) {
        List<String> result = new ArrayList<>();
        Class<?> prefixes;
        try {
            prefixes = Class.forName("gregtech.api.enums.OrePrefixes");
        } catch (ClassNotFoundException error) {
            throw new IllegalStateException("GT OrePrefixes API is missing while building ore graph", error);
        }
        for (ItemStack stack : stacks) {
            if (stack == null) continue;
            if (itemRegistrationProblem(stack) != null) continue;
            String stackKey = stableStackName(stack);
            List<String> cached = ORE_SEMANTIC_CACHE.get(stackKey);
            if (cached != null) {
                result.addAll(cached);
                continue;
            }
            List<String> parsedMaterials = new ArrayList<>();
            Object parsed = call(prefixes, "detectPrefix", stack);
            for (Object entry : list(parsed)) {
                Object prefix = fieldOrNull(entry, "prefix");
                String prefixName = stringOrEmpty(fieldOrNull(prefix, "name"));
                if (!isOreSeedPrefix(prefixName)) continue;
                String material = stringOrEmpty(fieldOrNull(entry, "material"));
                if (material.length() > 0) parsedMaterials.add(material.toLowerCase(Locale.ROOT));
            }
            List<String> immutable = Collections.unmodifiableList(uniqueSorted(parsedMaterials));
            ORE_SEMANTIC_CACHE.put(stackKey, immutable);
            result.addAll(immutable);
        }
        return uniqueSorted(result);
    }

    private static boolean isOreSeedPrefix(String prefixName) {
        return prefixName.startsWith("ore") || prefixName.startsWith("crushed")
                || prefixName.startsWith("rawOre") || prefixName.startsWith("shard")
                || prefixName.startsWith("clump") || prefixName.startsWith("reduced")
                || prefixName.startsWith("crystalline") || prefixName.startsWith("cleanGravel")
                || prefixName.startsWith("dirtyGravel") || prefixName.startsWith("dust")
                || prefixName.startsWith("gem") || prefixName.startsWith("ingot")
                || prefixName.startsWith("nugget") || prefixName.startsWith("plate")
                || prefixName.startsWith("block") || prefixName.startsWith("rod")
                || prefixName.startsWith("wire") || prefixName.startsWith("foil")
                || prefixName.startsWith("ring") || prefixName.startsWith("screw")
                || prefixName.startsWith("bolt") || prefixName.startsWith("stick")
                || prefixName.startsWith("gear") || prefixName.startsWith("spring")
                || prefixName.startsWith("round") || prefixName.startsWith("frame")
                || prefixName.startsWith("casing") || prefixName.startsWith("rotor")
                || prefixName.startsWith("lens") || prefixName.startsWith("pipe");
    }

    /** Match only a material-shaped identity when the prefix parser has no label. */
    private static boolean normalizedIdentityMatches(String key, String root) {
        if (key == null || root == null) return false;
        boolean fluid = key.startsWith("fluid:");
        if (!fluid && !key.startsWith("item:")) return false;
        String identity = key.substring(key.indexOf(':') + 1);
        if (fluid) return containsMaterialToken(identity, root);

        // Item keys are mod:name:damage.  Avoid treating a generic container
        // named after a material as a processing output; only familiar
        // material-bearing prefixes can use this fallback.
        int modSeparator = identity.indexOf(':');
        if (modSeparator < 0 || modSeparator + 1 >= identity.length()) return false;
        String itemName = identity.substring(modSeparator + 1);
        int damageSeparator = itemName.indexOf(':');
        if (damageSeparator >= 0) itemName = itemName.substring(0, damageSeparator);
        if (!hasMaterialIdentityPrefix(itemName)) return false;
        return containsMaterialToken(itemName, root);
    }

    private static boolean hasMaterialIdentityPrefix(String value) {
        String lower = value.toLowerCase(Locale.ROOT);
        for (String prefix : new String[] {
                "ore", "raw", "crushed", "purified", "washed", "centrifuged", "dust", "gem",
                "ingot", "nugget", "plate", "block", "shard", "clump", "reduced", "crystalline",
                "gravel", "powder", "rod", "wire", "foil", "ring", "screw", "bolt"
        }) {
            if (lower.startsWith(prefix) || lower.contains("_" + prefix)
                    || lower.contains("." + prefix)) return true;
        }
        return false;
    }

    private static boolean containsMaterialToken(String identity, String root) {
        String normalizedRoot = root.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        if (normalizedRoot.length() == 0) return false;
        String lower = identity.toLowerCase(Locale.ROOT);
        String[] tokens = lower.split("[^a-z0-9]+");
        for (String token : tokens) if (normalizedRoot.equals(token)) return true;
        String compact = lower.replaceAll("[^a-z0-9]", "");
        if (compact.equals(normalizedRoot)) return true;
        // GT item and fluid names commonly concatenate the material with a
        // representation prefix (ingotIron, moltenIron).  Strip only known
        // representation prefixes; arbitrary substring matches would bridge
        // unrelated materials (for example steel and stainlesssteel).
        for (String prefix : new String[] {
                "molten", "liquid", "plasma", "fluid", "steam", "gas", "hot", "cold",
                "ore", "rawore", "crushed", "purified", "washed", "centrifuged", "dust",
                "gem", "ingot", "nugget", "plate", "block", "shard", "clump", "reduced",
                "crystalline", "gravel", "powder", "rod", "wire", "foil", "ring", "screw",
                "bolt", "stick", "gear", "spring", "round", "frame", "casing", "rotor",
                "lens", "pipe"
        }) {
            if (compact.startsWith(prefix) && compact.substring(prefix.length()).equals(normalizedRoot)) {
                return true;
            }
        }
        return false;
    }

    private static int recipeChance(Object recipe, String getter, int index, String fieldName) {
        Object value = callOrNull(recipe, getter, index);
        if (value instanceof Number) return ((Number) value).intValue();
        Object values = fieldOrNull(recipe, fieldName);
        List<Object> entries = arrayOrCollection(values);
        if (index >= 0 && index < entries.size() && entries.get(index) instanceof Number) {
            return ((Number) entries.get(index)).intValue();
        }
        return 10000;
    }

    private static String machineLabel(String mapName) {
        if ("maceratorRecipes".equals(mapName)) return "maceration";
        if ("oreWasherRecipes".equals(mapName)) return "washing";
        if ("thermalCentrifugeRecipes".equals(mapName)) return "thermal-centrifuging";
        if ("centrifugeRecipes".equals(mapName)) return "centrifuging";
        if ("electroMagneticSeparatorRecipes".equals(mapName)) return "electromagnetic-separation";
        if ("chemicalBathRecipes".equals(mapName)) return "chemical-bath";
        if ("sifterRecipes".equals(mapName)) return "sifting";
        if ("furnaceRecipes".equals(mapName)) return "furnace";
        if ("blastFurnaceRecipes".equals(mapName)) return "blast-furnace";
        if ("chemicalReactorRecipes".equals(mapName)) return "reactor";
        if ("mixerRecipes".equals(mapName)) return "mixer";
        if ("autoclaveRecipes".equals(mapName)) return "autoclave";
        if ("extractorRecipes".equals(mapName)) return "extractor";
        if ("fluidExtractionRecipes".equals(mapName)) return "fluid-extraction";
        return mapName;
    }

    private static Object construct(String className) throws Exception {
        return Class.forName(className).getDeclaredConstructor().newInstance();
    }

    private static Object staticField(String className, String fieldName) {
        try { return field(Class.forName(className), fieldName, null); }
        catch (Throwable error) { throw new IllegalStateException("Cannot read " + className + "." + fieldName, error); }
    }

    private static Object fieldOrNull(Object receiver, String fieldName) {
        if (receiver == null) return null;
        Class<?> owner = receiver instanceof Class ? (Class<?>) receiver : receiver.getClass();
        Object target = receiver instanceof Class ? null : receiver;
        try { return field(owner, fieldName, target); }
        catch (NoSuchFieldException error) { return null; }
        catch (ReflectiveOperationException error) { throw new IllegalStateException("Cannot read " + owner.getName()
                + "." + fieldName, error); }
    }

    private static Object field(Class<?> type, String fieldName, Object receiver)
            throws NoSuchFieldException, IllegalAccessException {
        Class<?> current = type;
        while (current != null) {
            try {
                Field field = current.getDeclaredField(fieldName);
                field.setAccessible(true);
                return field.get(receiver);
            } catch (NoSuchFieldException error) { current = current.getSuperclass(); }
        }
        throw new NoSuchFieldException(type.getName() + "." + fieldName);
    }

    private static Object staticCall(String className, String method, Object... args) throws Exception {
        return call(Class.forName(className), method, args);
    }

    private static Object callOrNull(Object receiver, String method, Object... args) {
        if (receiver == null) return null;
        try { return call(receiver, method, args); }
        catch (MissingMethodException error) { return null; }
    }

    private static Object call(Object receiver, String method, Object... args) {
        try {
            Class<?> type = receiver instanceof Class ? (Class<?>) receiver : receiver.getClass();
            Method selected = findMethod(type, method, args);
            if (selected == null) throw new MissingMethodException(
                    type.getName() + "." + method + "/" + args.length);
            selected.setAccessible(true);
            return selected.invoke(receiver instanceof Class ? null : receiver, args);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause() == null ? error : error.getCause();
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            throw new IllegalStateException("Invocation failed for " + receiver + "." + method, cause);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Invocation failed for " + receiver + "." + method, error);
        }
    }

    /** Optional API calls use this distinct runtime exception, not a wrapped failure. */
    private static final class MissingMethodException extends RuntimeException {
        private MissingMethodException(String message) { super(message); }
    }

    private static Method findMethod(Class<?> type, String name, Object[] args) {
        Class<?> current = type;
        while (current != null) {
            for (Method method : current.getDeclaredMethods()) {
                if (method.getName().equals(name) && compatible(method.getParameterTypes(), args)) return method;
            }
            current = current.getSuperclass();
        }
        for (Method method : type.getMethods()) {
            if (method.getName().equals(name) && compatible(method.getParameterTypes(), args)) return method;
        }
        return null;
    }

    private static boolean compatible(Class<?>[] types, Object[] args) {
        if (types.length != args.length) return false;
        for (int index = 0; index < types.length; index++) {
            if (args[index] == null) continue;
            Class<?> expected = box(types[index]);
            if (!expected.isAssignableFrom(args[index].getClass())) return false;
        }
        return true;
    }

    private static Class<?> box(Class<?> type) {
        if (!type.isPrimitive()) return type;
        if (type == int.class) return Integer.class;
        if (type == long.class) return Long.class;
        if (type == float.class) return Float.class;
        if (type == double.class) return Double.class;
        if (type == boolean.class) return Boolean.class;
        if (type == byte.class) return Byte.class;
        if (type == short.class) return Short.class;
        if (type == char.class) return Character.class;
        return type;
    }

    private static Map<?, ?> castMap(Object value) {
        if (!(value instanceof Map)) throw new IllegalStateException("Expected map but got " + value);
        return (Map<?, ?>) value;
    }

    private static String string(Object value) {
        if (value == null) throw new IllegalStateException("Expected non-null string value");
        return String.valueOf(value);
    }

    private static String stringOrNull(Object value) { return value == null ? null : String.valueOf(value); }
    private static String stringOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }

    /** Build stable, plain-text search terms without leaking payload markup. */
    private static String searchText(String... terms) {
        LinkedHashSet<String> words = new LinkedHashSet<>();
        for (String term : terms) {
            if (term == null) continue;
            String normalized = term.trim().replaceAll("\\s+", " ");
            if (normalized.length() > 0) words.add(normalized.toLowerCase(Locale.ROOT));
        }
        if (words.isEmpty()) throw new IllegalArgumentException("special record search text is empty");
        return join(new ArrayList<>(words), " ");
    }

    private static Number number(Object value) {
        if (value == null) return 0;
        if (!(value instanceof Number)) throw new IllegalStateException("Expected numeric value but got " + value);
        return (Number) value;
    }
    private static int intValue(Object value) { return number(value).intValue(); }
    private static boolean bool(Object value) { return value instanceof Boolean && (Boolean) value; }

    private static List<String> concat(List<String>... values) {
        List<String> result = new ArrayList<>();
        for (List<String> value : values) result.addAll(value);
        return result;
    }

    private static boolean containsAny(String value, String... terms) {
        for (String term : terms) if (value.contains(term)) return true;
        return false;
    }

    private static void addAllUnique(List<String> target, Collection<String> values) {
        for (String value : values) if (value != null && !target.contains(value)) target.add(value);
    }

    private static List<String> unique(List<String> values) {
        return new ArrayList<>(new LinkedHashSet<>(values));
    }

    private static List<String> uniqueSorted(List<String> values) {
        List<String> result = unique(values);
        Collections.sort(result);
        return result;
    }

    private static <T> void sortMaps(List<T> maps, final String key) {
        Collections.sort(maps, new Comparator<T>() {
            @Override
            public int compare(T left, T right) {
                Object a = left instanceof Map ? ((Map<?, ?>) left).get(key) : null;
                Object b = right instanceof Map ? ((Map<?, ?>) right).get(key) : null;
                int primary = String.valueOf(a).compareTo(String.valueOf(b));
                return primary == 0 ? String.valueOf(left).compareTo(String.valueOf(right)) : primary;
            }
        });
    }

    private static String slug(String value) {
        String result = value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-");
        result = result.replaceAll("^-+|-+$", "");
        return result.length() == 0 ? "unknown-" + digest(String.valueOf(value)).substring(0, 10) : result;
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"));
            StringBuilder result = new StringBuilder();
            for (byte valueByte : bytes) result.append(String.format("%02x", valueByte & 0xff));
            return result.toString();
        } catch (Exception error) { throw new IllegalStateException("Cannot hash special record key", error); }
    }

    private static String join(List<?> values, String separator) {
        List<String> strings = new ArrayList<>();
        for (Object value : values) strings.add(String.valueOf(value));
        return String.join(separator, strings);
    }

    private static void requireRecords(String category, int count) {
        if (count == 0) throw new IllegalStateException("Pinned runtime registry produced no " + category + " records");
    }
}
