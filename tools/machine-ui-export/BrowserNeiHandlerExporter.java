package com.github.dcysteine.nesql.exporter.main;

import codechicken.nei.PositionedStack;
import codechicken.nei.recipe.GuiRecipeTab;
import codechicken.nei.recipe.HandlerInfo;
import codechicken.nei.recipe.IRecipeHandler;
import codechicken.nei.recipe.RecipeCatalysts;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.List;
import net.minecraft.block.Block;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidRegistry;

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

  public static JsonObject export() throws Exception {
    JsonObject snapshot = new JsonObject();
    for (String name : BOTANIA_HANDLERS) {
      String className = BOTANIA_PACKAGE + "RecipeHandler" + name;
      snapshot.add(className, capture(className, name));
    }
    return snapshot;
  }

  private static JsonObject capture(String className, String name) throws Exception {
    Class<?> type = Class.forName(className);
    IRecipeHandler handler = (IRecipeHandler) type.getConstructor().newInstance();
    String identifier = handler.getOverlayIdentifier();
    type
      .getMethod("loadCraftingRecipes", String.class, Object[].class)
      .invoke(handler, identifier, new Object[0]);
    List<?> cached = (List<?>) type.getField("arecipes").get(handler);
    int count = cached.size();
    if (count == 0) throw new IllegalStateException("No loaded recipes for " + className);

    String manaField = manaField(name);
    boolean hasFinishingIngredient = name.equals("PetalApothecary") || name.equals("RunicAltar");
    HandlerInfo info = GuiRecipeTab.getHandlerInfo(handler);
    JsonArray recipes = new JsonArray();
    for (int index = 0; index < count; index++) {
      JsonObject recipe = new JsonObject();
      List<PositionedStack> inputs = handler.getIngredientStacks(index);
      // Both handlers append the centered finisher after the actual ingredient list.
      if (hasFinishingIngredient) {
        JsonObject finisher = slot(inputs.get(inputs.size() - 1));
        finisher.addProperty("kind", name.equals("PetalApothecary") ? "any-seed" : "livingrock");
        recipe.add("finisher", finisher);
        inputs = inputs.subList(0, inputs.size() - 1);
      }
      recipe.add("ingredients", slots(inputs));
      PositionedStack output = handler.getResultStack(index);
      if (output != null) recipe.add("result", slot(output));
      recipe.add("other", slots(handler.getOtherStacks(index)));
      int recipeHeight = handler.getRecipeHeight(index);
      if (recipeHeight > 0) recipe.addProperty("heightOverride", recipeHeight);
      if (manaField != null) {
        Object page = cached.get(index);
        recipe.addProperty("mana", page.getClass().getField(manaField).getInt(page));
      }
      recipes.add(recipe);
    }

    JsonObject captured = new JsonObject();
    captured.addProperty("overlayIdentifier", identifier);
    captured.addProperty("label", handler.getRecipeName());
    captured.addProperty("texture", (String) type.getMethod("getGuiTexture").invoke(handler));
    captured.addProperty("width", info.getWidth());
    captured.addProperty("height", info.getHeight());
    captured.addProperty("yShift", info.getYShift());
    ItemStack icon = info.getItemStack();
    if (icon != null) captured.add("tabIcon", item(icon));
    captured.add("handlerCatalysts", slots(RecipeCatalysts.getRecipeCatalysts(handler)));
    captured.add("recipes", recipes);
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

  private static JsonArray slots(List<PositionedStack> positions) {
    JsonArray slots = new JsonArray();
    for (PositionedStack position : positions) slots.add(slot(position));
    return slots;
  }

  private static JsonObject slot(PositionedStack position) {
    JsonObject slot = new JsonObject();
    slot.addProperty("x", position.relx);
    slot.addProperty("y", position.rely);
    JsonArray alternatives = new JsonArray();
    for (ItemStack stack : position.items) {
      if (stack == null || stack.getItem() == null) continue;
      alternatives.add(item(stack));
    }
    if (alternatives.size() == 0) throw new IllegalStateException("Empty NEI positioned stack");
    slot.add("alternatives", alternatives);
    return slot;
  }

  private static JsonObject item(ItemStack stack) {
    String registryName = Item.itemRegistry.getNameForObject(stack.getItem());
    if (registryName == null) throw new IllegalStateException("Unregistered NEI stack: " + stack);
    NBTTagCompound data = stack.writeToNBT(new NBTTagCompound());
    JsonObject item = new JsonObject();
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
