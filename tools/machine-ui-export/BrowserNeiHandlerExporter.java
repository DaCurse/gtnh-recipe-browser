package com.github.dcysteine.nesql.exporter.main;

import codechicken.nei.ItemList;
import codechicken.nei.PositionedStack;
import codechicken.nei.recipe.GuiRecipeTab;
import codechicken.nei.recipe.HandlerInfo;
import codechicken.nei.recipe.IRecipeHandler;
import codechicken.nei.recipe.RecipeCatalysts;
import codechicken.nei.recipe.StackInfo;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.awt.Rectangle;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import net.minecraft.block.Block;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.util.StatCollector;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidRegistry;
import net.minecraftforge.fluids.FluidStack;

/** Captures the slots exposed by the pinned NEI handlers, independent of rendering. */
public final class BrowserNeiHandlerExporter {

  private static final String BOTANIA_PACKAGE = "vazkii.botania.client.integration.nei.recipe.";
  private static final String[] BOTANIA_HANDLERS = {
    "ManaPool",
    "PetalApothecary",
    "RunicAltar",
    "PureDaisy",
    "ElvenTrade",
    "Brewery",
  };

  private BrowserNeiHandlerExporter() {}

  private static final String BLOOD_MAGIC = "WayofTime.alchemicalWizardry.client.nei.";
  private static final String TINKERS = "tconstruct.plugins.nei.";

  public static JsonObject export() throws Exception {
    return export(null, null);
  }

  public static JsonObject export(
    Function<ItemStack, String> retain,
    Function<FluidStack, String> retainFluid
  ) throws Exception {
    JsonObject snapshot = new JsonObject();
    for (String name : BOTANIA_HANDLERS) {
      String className = BOTANIA_PACKAGE + "RecipeHandler" + name;
      snapshot.add(className, capture(className, name, null, retain, retainFluid));
    }
    if (retain != null) {
      for (String name : new String[] { "FloatingFlowers", "LexicaBotania" }) {
        String className = BOTANIA_PACKAGE + "RecipeHandler" + name;
        snapshot.add(className, capture(className, name, null, retain, retainFluid));
      }
      for (String name : new String[] {
        "NEIAlchemyRecipeHandler",
        "NEIAltarRecipeHandler",
        "NEICalcinatorHandler",
        "NEIBloodOrbShapedHandler",
      }) {
        String className = BLOOD_MAGIC + name;
        String identifier = null;
        if (name.equals("NEIBloodOrbShapedHandler")) identifier = "crafting";
        if (name.equals("NEIAltarRecipeHandler")) identifier = "alchemicalwizardry.altar";
        snapshot.add(className, capture(className, name, identifier, retain, retainFluid));
      }
      for (String name : new String[] { "RecipeHandlerCastingTable", "RecipeHandlerMelting" }) {
        String className = TINKERS + name;
        String identifier = name.endsWith("Table")
          ? "tconstruct.smeltery.casting"
          : "tconstruct.smeltery.melting";
        snapshot.add(className, capture(className, name, identifier, retain, retainFluid));
      }
    }
    return snapshot;
  }

  /** Use the pinned handler so empty, disallowed and unrelated containers are excluded. */
  public static JsonArray infernalUsages(Function<ItemStack, String> retain)
    throws ReflectiveOperationException {
    Class<?> type = Class.forName("com.kuba6000.mobsinfo.nei.MobHandlerInfernal");
    Object handler = type.getConstructor().newInstance();
    Method usage = type.getMethod("loadUsageRecipes", ItemStack.class);
    List<?> pages = (List<?>) type.getField("arecipes").get(handler);
    Class<?> enderIO = Class.forName("crazypants.enderio.EnderIO");
    Item spawner = Item.getItemFromBlock((Block) enderIO.getField("blockPoweredSpawner").get(null));
    Item vessel = (Item) enderIO.getField("itemSoulVessel").get(null);
    Item brokenSpawner = (Item) enderIO.getField("itemBrokenSpawner").get(null);
    Set<String> matches = new TreeSet<>();
    for (ItemStack stack : ItemList.items) {
      Item item = stack.getItem();
      if (item != spawner && item != vessel && item != brokenSpawner) continue;
      usage.invoke(handler, stack);
      if (pages.isEmpty()) continue;
      matches.add(retain.apply(stack));
      pages.clear();
    }
    JsonArray result = new JsonArray();
    for (String id : matches) result.add(new JsonPrimitive(id));
    return result;
  }

  private static JsonObject capture(
    String className,
    String name,
    String identifierOverride,
    Function<ItemStack, String> retain,
    Function<FluidStack, String> retainFluid
  ) throws Exception {
    Class<?> type = Class.forName(className);
    IRecipeHandler handler = (IRecipeHandler) type.getConstructor().newInstance();
    String identifier =
      identifierOverride == null ? handler.getOverlayIdentifier() : identifierOverride;
    if (name.equals("FloatingFlowers")) {
      // This handler has no category-wide loader. Query its real NBT-aware
      // usage path with the special flowers already enumerated by NEI.
      Class<?> flower = Class.forName("vazkii.botania.common.block.BlockSpecialFlower");
      for (ItemStack stack : ItemList.items) {
        if (stack.hasTagCompound() && flower.isInstance(Block.getBlockFromItem(stack.getItem()))) {
          type.getMethod("loadUsageRecipes", ItemStack.class).invoke(handler, stack);
        }
      }
    } else {
      type
        .getMethod("loadCraftingRecipes", String.class, Object[].class)
        .invoke(handler, identifier, new Object[0]);
    }
    List<?> cached = (List<?>) type.getField("arecipes").get(handler);
    int count = cached.size();
    if (count == 0) throw new IllegalStateException("No loaded recipes for " + className);
    List<?> castingRecipes = name.equals("RecipeHandlerCastingTable")
      ? (List<?>) type.getMethod("getCastingRecipes").invoke(handler)
      : null;
    if (castingRecipes != null && castingRecipes.size() != count) throw new IllegalStateException(
      "Casting table source no longer matches its NEI pages"
    );
    Map<Object, JsonArray> reagentContainers = name.equals("NEICalcinatorHandler")
      ? reagentContainers(type, retain)
      : Collections.emptyMap();
    List<Object> alchemyRecipes = name.equals("NEIAlchemyRecipeHandler")
      ? alchemyRecipes(count)
      : Collections.emptyList();

    String manaField = manaField(name);
    boolean hasFinishingIngredient = name.equals("PetalApothecary") || name.equals("RunicAltar");
    boolean melting = name.equals("RecipeHandlerMelting");
    HandlerInfo info = GuiRecipeTab.getHandlerInfo(handler);
    JsonArray recipes = new JsonArray();
    for (int index = 0; index < count; index++) {
      Object nativePage = cached.get(index);
      JsonArray legacyTanks =
        melting || castingRecipes != null ? legacyTanks(nativePage, retainFluid) : new JsonArray();
      PositionedStack output = handler.getResultStack(index);
      // NEI can show a grouped Smeltery page with no fluid if its first
      // displayed alternative has no melting result. It yields no conversion.
      if (output == null && melting && legacyTanks.size() == 0) continue;
      if (output == null && !melting) throw new IllegalStateException(
        "Missing output for " + className
      );
      JsonObject recipe = new JsonObject();
      List<PositionedStack> inputs = handler.getIngredientStacks(index);
      // Both handlers append the centered finisher after the actual ingredient list.
      if (hasFinishingIngredient) {
        JsonObject finisher = slot(inputs.get(inputs.size() - 1), retain, retainFluid);
        finisher.addProperty("kind", name.equals("PetalApothecary") ? "any-seed" : "livingrock");
        recipe.add("finisher", finisher);
        inputs = inputs.subList(0, inputs.size() - 1);
      }
      JsonArray ingredients = melting ? new JsonArray() : legacyTanks;
      for (com.google.gson.JsonElement ingredient : slots(inputs, retain, retainFluid)) {
        ingredients.add(ingredient);
      }
      recipe.add("ingredients", ingredients);
      if (output == null && legacyTanks.size() != 1) throw new IllegalStateException(
        "Expected one fluid result for " + className
      );
      recipe.add("result", output == null ? legacyTanks.get(0) : slot(output, retain, retainFluid));
      recipe.add("other", slots(handler.getOtherStacks(index), retain, retainFluid));
      int recipeHeight = handler.getRecipeHeight(index);
      if (recipeHeight > 0) recipe.addProperty("heightOverride", recipeHeight);
      if (manaField != null) {
        Object page = cached.get(index);
        recipe.addProperty("mana", page.getClass().getField(manaField).getInt(page));
      }
      if (castingRecipes != null) {
        Object casting = castingRecipes.get(index);
        copyInt(casting, recipe, "coolTime", "coolingTicks");
        recipe.addProperty(
          "consumesCast",
          casting.getClass().getField("consumeCast").getBoolean(casting)
        );
      }
      if (name.equals("LexicaBotania")) {
        Object entry = nativePage.getClass().getField("entry").get(nativePage);
        for (String[] property : new String[][] {
          { "getUnlocalizedName", "entryTitle" },
          { "getTagline", "entryTagline" },
        }) {
          String key = (String) entry.getClass().getMethod(property[0]).invoke(entry);
          recipe.addProperty(property[1], StatCollector.translateToLocal(key));
        }
      }
      if (!alchemyRecipes.isEmpty()) {
        copyInt(nativePage, recipe, "lp", "lifePoints");
        Object alchemy = alchemyRecipes.get(index);
        recipe.addProperty(
          "orbTier",
          (Number) alchemy.getClass().getMethod("getOrbLevel").invoke(alchemy)
        );
      }
      if (name.equals("NEICalcinatorHandler")) {
        copyInt(nativePage, recipe, "amount", "reagentAmount");
        Object reagent = nativePage.getClass().getMethod("getReagent").invoke(nativePage);
        Class<?> reagentType = reagent.getClass();
        recipe.addProperty("reagentName", (String) reagentType.getMethod("name").invoke(reagent));
        int red = ((Number) reagentType.getMethod("red").invoke(reagent)).intValue() & 255;
        int green = ((Number) reagentType.getMethod("green").invoke(reagent)).intValue() & 255;
        int blue = ((Number) reagentType.getMethod("blue").invoke(reagent)).intValue() & 255;
        recipe.addProperty("reagentColour", (red << 16) | (green << 8) | blue);
        if (reagentContainers.containsKey(reagent)) {
          recipe.add("reagentContainers", reagentContainers.get(reagent));
        }
      }
      if (name.equals("NEIAltarRecipeHandler")) {
        copyInt(nativePage, recipe, "tier", "altarTier");
        copyInt(nativePage, recipe, "lp_amount", "lifePoints");
        copyInt(nativePage, recipe, "consumption", "consumption");
        copyInt(nativePage, recipe, "drain", "drain");
      }
      if (name.equals("RecipeHandlerMelting")) copyInt(
        nativePage,
        recipe,
        "temperature",
        "temperature"
      );
      recipes.add(recipe);
    }
    if (recipes.size() == 0) throw new IllegalStateException("No valid recipes for " + className);

    JsonObject captured = new JsonObject();
    captured.addProperty("overlayIdentifier", identifier);
    captured.addProperty("label", handler.getRecipeName());
    captured.addProperty("texture", (String) type.getMethod("getGuiTexture").invoke(handler));
    captured.addProperty("width", info.getWidth());
    captured.addProperty("height", info.getHeight());
    captured.addProperty("yShift", info.getYShift());
    ItemStack icon = info.getItemStack();
    if (icon == null && name.equals("NEICalcinatorHandler")) {
      Block calcinator = (Block) Class.forName("WayofTime.alchemicalWizardry.ModBlocks")
        .getField("blockAlchemicCalcinator")
        .get(null);
      icon = new ItemStack(calcinator);
    }
    if (icon != null) captured.add("tabIcon", item(icon, retain));
    captured.add(
      "handlerCatalysts",
      slots(RecipeCatalysts.getRecipeCatalysts(handler), retain, retainFluid)
    );
    captured.add("recipes", recipes);
    System.out.println("[BrowserNeiHandlerExporter] " + name + ": " + recipes.size() + "/" + count);
    return captured;
  }

  private static String manaField(String name) {
    switch (name) {
      case "ManaPool":
      case "Brewery":
        return "mana";
      case "RunicAltar":
        return "manaUsage";
      default:
        return null;
    }
  }

  private static Map<Object, JsonArray> reagentContainers(
    Class<?> handlerType,
    Function<ItemStack, String> retain
  ) throws ReflectiveOperationException {
    Object handler = handlerType.getConstructor().newInstance();
    List<?> pages = (List<?>) handlerType.getField("arecipes").get(handler);
    Method usage = handlerType.getMethod("loadUsageRecipes", ItemStack.class);
    Map<Object, JsonArray> containers = new HashMap<>();
    for (ItemStack stack : ItemList.items) {
      NBTTagCompound nbt = stack.getTagCompound();
      if (nbt == null || !nbt.hasKey("reagentTanks", 9)) continue;
      usage.invoke(handler, stack);
      if (pages.isEmpty()) continue;
      String id = retain.apply(stack);
      for (Object page : pages) {
        Object reagent = page.getClass().getMethod("getReagent").invoke(page);
        containers.computeIfAbsent(reagent, key -> new JsonArray()).add(new JsonPrimitive(id));
      }
      pages.clear();
    }
    return containers;
  }

  private static List<Object> alchemyRecipes(int expectedCount)
    throws ReflectiveOperationException {
    Class<?> registry = Class.forName(
      "WayofTime.alchemicalWizardry.api.alchemy.AlchemyRecipeRegistry"
    );
    List<Object> result = new ArrayList<>();
    for (Object recipe : (Iterable<?>) registry.getField("recipes").get(null)) {
      if (recipe.getClass().getMethod("getResult").invoke(recipe) != null) result.add(recipe);
    }
    if (result.size() != expectedCount) throw new IllegalStateException(
      "Blood Magic registry no longer matches its alchemy pages"
    );
    return result;
  }

  private static void copyInt(Object page, JsonObject recipe, String field, String label)
    throws ReflectiveOperationException {
    Field source = page.getClass().getDeclaredField(field);
    source.setAccessible(true);
    recipe.addProperty(label, source.getInt(page));
  }

  private static JsonArray slots(
    List<PositionedStack> positions,
    Function<ItemStack, String> retain,
    Function<FluidStack, String> retainFluid
  ) throws ReflectiveOperationException {
    JsonArray slots = new JsonArray();
    for (PositionedStack position : positions) slots.add(slot(position, retain, retainFluid));
    return slots;
  }

  /** TConstruct 1.14.123 draws tanks separately from NEI's positioned stacks. */
  private static JsonArray legacyTanks(Object page, Function<FluidStack, String> retain)
    throws ReflectiveOperationException {
    JsonArray result = new JsonArray();
    Method tanks;
    try {
      tanks = page.getClass().getMethod("getFluidTanks");
    } catch (NoSuchMethodException modernHandler) {
      return result;
    }
    for (Object tank : (Iterable<?>) tanks.invoke(page)) {
      Class<?> type = tank.getClass();
      FluidStack fluid = (FluidStack) type.getField("fluid").get(tank);
      if (fluid == null) continue;
      Rectangle bounds = (Rectangle) type.getField("position").get(tank);
      JsonObject slot = new JsonObject();
      slot.addProperty("x", bounds.x);
      slot.addProperty("y", bounds.y);
      slot.addProperty("width", bounds.width);
      slot.addProperty("height", bounds.height);
      JsonArray alternatives = new JsonArray();
      alternatives.add(fluidAlternative(fluid, retain));
      slot.add("alternatives", alternatives);
      result.add(slot);
    }
    return result;
  }

  private static JsonObject slot(
    PositionedStack position,
    Function<ItemStack, String> retain,
    Function<FluidStack, String> retainFluid
  ) throws ReflectiveOperationException {
    JsonObject slot = new JsonObject();
    slot.addProperty("x", position.relx);
    slot.addProperty("y", position.rely);
    JsonArray alternatives = new JsonArray();
    Class<?> positionType = position.getClass();
    boolean tank = positionType.getName().equals(PositionedStack.class.getName() + "$Tank");
    if (tank) {
      slot.addProperty("width", positionType.getField("width").getInt(position));
      slot.addProperty("height", positionType.getField("height").getInt(position));
    }
    for (ItemStack stack : position.items) {
      if (stack == null || stack.getItem() == null) continue;
      if (tank) {
        FluidStack fluid = StackInfo.getFluid(stack);
        if (fluid == null || retainFluid == null) throw new IllegalStateException(
          "NEI tank has no retained fluid"
        );
        alternatives.add(fluidAlternative(fluid, retainFluid));
      } else {
        alternatives.add(item(stack, retain));
      }
    }
    if (alternatives.size() == 0) throw new IllegalStateException("Empty NEI positioned stack");
    slot.add("alternatives", alternatives);
    return slot;
  }

  private static JsonObject fluidAlternative(
    FluidStack fluid,
    Function<FluidStack, String> retain
  ) {
    JsonObject alternative = new JsonObject();
    alternative.addProperty("goodsId", retain.apply(fluid));
    alternative.addProperty("amount", fluid.amount);
    return alternative;
  }

  private static JsonObject item(ItemStack stack, Function<ItemStack, String> retain) {
    String registryName = Item.itemRegistry.getNameForObject(stack.getItem());
    if (registryName == null) throw new IllegalStateException("Unregistered NEI stack: " + stack);
    NBTTagCompound data = stack.writeToNBT(new NBTTagCompound());
    JsonObject item = new JsonObject();
    if (retain != null) item.addProperty("goodsId", retain.apply(stack));
    item.addProperty("registryName", registryName);
    item.addProperty("damage", data.getShort("Damage"));
    item.addProperty("amount", stack.stackSize);
    if (stack.hasTagCompound()) item.addProperty("nbt", stack.getTagCompound().toString());
    if (stack.getItemDamage() == 0 && !stack.hasTagCompound()) {
      Fluid fluid = FluidRegistry.lookupFluidForBlock(Block.getBlockFromItem(stack.getItem()));
      if (fluid != null) {
        item.addProperty("placedFluidId", "f:" + FluidRegistry.getDefaultFluidName(fluid));
      }
    }
    return item;
  }
}
