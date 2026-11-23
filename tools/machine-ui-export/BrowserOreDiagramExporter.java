package com.github.dcysteine.nesql.exporter.main;

import codechicken.nei.ItemList;
import codechicken.nei.recipe.IRecipeHandler;
import com.google.gson.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.function.Function;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraftforge.fluids.FluidRegistry;
import net.minecraftforge.fluids.FluidStack;

/** Snapshot the actual NEI Custom Diagram generator, including optional layouts. */
public final class BrowserOreDiagramExporter {

  @FunctionalInterface
  private interface ComponentId {
    String of(Object component) throws Exception;
  }

  private static Object call(Object value, String name) throws Exception {
    Method method = value.getClass().getMethod(name);
    method.setAccessible(true);
    return method.invoke(value);
  }

  private static Object field(Object value, String name) throws Exception {
    for (Class<?> type = value.getClass(); type != null; type = type.getSuperclass()) {
      try {
        Field f = type.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(value);
      } catch (NoSuchFieldException ignored) {}
    }
    throw new NoSuchFieldException(name);
  }

  private static JsonArray point(Object value) throws Exception {
    JsonArray result = new JsonArray();
    result.add(new JsonPrimitive((Number) call(value, "x")));
    result.add(new JsonPrimitive((Number) call(value, "y")));
    return result;
  }

  private static JsonArray sorted(Collection<JsonObject> values) {
    List<JsonObject> list = new ArrayList<>(values);
    Collections.sort(list, Comparator.comparing(JsonObject::toString));
    JsonArray result = new JsonArray();
    for (JsonObject value : list) result.add(value);
    return result;
  }

  private static String identity(Object component) throws Exception {
    Method method = component.getClass().getMethod("stack", Optional.class);
    method.setAccessible(true);
    Object value = method.invoke(component, Optional.empty());
    if (value instanceof ItemStack) {
      ItemStack stack = (ItemStack) value;
      if (stack.hasTagCompound()) throw new IllegalStateException(
        "Unexpected diagram NBT: " + stack
      );
      if (
        "gregtech:gt.GregTech_FluidDisplay".equals(
          Item.itemRegistry.getNameForObject(stack.getItem())
        )
      ) {
        net.minecraftforge.fluids.Fluid fluid = net.minecraftforge.fluids.FluidRegistry.getFluid(
          stack.getItemDamage()
        );
        if (fluid == null) throw new IllegalStateException("Unknown GT fluid-display identity");
        return "fluid:" + fluid.getName();
      }
      return (
        "i:" +
        Item.itemRegistry.getNameForObject(stack.getItem()) +
        ":" +
        net.minecraft.init.Items.feather.getDamage(stack)
      );
    }
    if (value instanceof FluidStack) {
      FluidStack stack = (FluidStack) value;
      if (stack.tag != null) throw new IllegalStateException("Unexpected diagram fluid NBT");
      return "fluid:" + stack.getFluid().getName();
    }
    throw new IllegalStateException("Unknown component " + component.getClass());
  }

  private static JsonArray tooltip(Object value) throws Exception {
    JsonArray lines = new JsonArray();
    for (Object line : (Iterable<?>) call(value, "lines")) {
      List<String> text = new ArrayList<>();
      for (Object element : (Iterable<?>) call(line, "elements")) {
        String type = String.valueOf(call(element, "type"));
        if (type.equals("TEXT")) text.add(String.valueOf(call(element, "text")));
        else if (type.equals("COMPONENT_DESCRIPTION")) text.add(
          String.valueOf(call(call(element, "componentDescription"), "description"))
        );
      }
      if (!text.isEmpty()) lines.add(new JsonPrimitive(String.join(" ", text)));
    }
    return lines;
  }

  private static JsonObject display(Object value, ComponentId identity) throws Exception {
    JsonObject result = new JsonObject();
    result.addProperty("id", identity.of(call(value, "component")));
    Optional<?> amount = (Optional<?>) call(value, "stackSize");
    if (amount.isPresent()) result.addProperty("amount", (Number) amount.get());
    Optional<?> info = (Optional<?>) call(value, "additionalInfo");
    if (info.isPresent()) result.addProperty("info", String.valueOf(info.get()));
    result.add("notes", tooltip(call(value, "additionalTooltip")));
    return result;
  }

  private static JsonObject scene(Object diagram, ComponentId identity) throws Exception {
    Object layout = field(diagram, "layout");
    JsonObject result = new JsonObject();
    List<JsonObject> slots = new ArrayList<>(),
      paths = new ArrayList<>(),
      groups = new ArrayList<>(),
      labels = new ArrayList<>();
    Map<?, ?> singles = (Map<?, ?>) call(layout, "slots");
    for (Map.Entry<?, ?> entry : singles.entrySet()) {
      JsonObject slot = new JsonObject();
      slot.addProperty("key", String.valueOf(call(entry.getKey(), "key")));
      slot.add("pos", point(call(entry.getValue(), "position")));
      slot.addProperty("size", 26);
      slot.add("notes", tooltip(call(entry.getValue(), "tooltip")));
      slots.add(slot);
    }
    for (Map.Entry<?, ?> entry : ((Map<?, ?>) call(layout, "slotGroups")).entrySet()) {
      String key = String.valueOf(call(entry.getKey(), "key"));
      int index = 0;
      for (Object value : (Iterable<?>) call(entry.getValue(), "slots")) {
        JsonObject slot = new JsonObject();
        slot.addProperty("key", key);
        slot.addProperty("index", index++);
        slot.add("pos", point(call(value, "position")));
        slot.addProperty("size", (Number) call(value, "slotWidth"));
        slot.add("notes", tooltip(call(value, "tooltip")));
        slots.add(slot);
      }
    }
    for (Object lines : (Iterable<?>) call(layout, "lines")) {
      for (String kind : new String[] { "segments", "arrows" })
        for (Object segment : (Iterable<?>) call(lines, kind)) {
          JsonObject path = new JsonObject();
          path.add("a", point(call(segment, "a")));
          path.add("b", point(call(segment, "b")));
          path.addProperty("arrow", kind.equals("arrows"));
          paths.add(path);
        }
    }
    for (Object value : (Iterable<?>) field(diagram, "interactables")) {
      if (value.getClass().getName().endsWith("InteractiveComponentGroup")) {
        JsonObject group = new JsonObject();
        group.add("pos", point(call(value, "position")));
        JsonArray components = new JsonArray();
        for (Object component : (Iterable<?>) field(value, "components"))
          components.add(display(component, identity));
        group.add("components", components);
        group.add("notes", tooltip(field(value, "slotTooltip")));
        groups.add(group);
      } else if (value.getClass().getName().endsWith("CustomInteractable")) {
        Object drawable = call(value, "drawable");
        if (
          !drawable.getClass().getName().endsWith("ComponentLabel")
        ) throw new IllegalStateException("Unknown diagram label " + drawable.getClass());
        JsonObject label = new JsonObject();
        label.add("pos", point(call(value, "position")));
        label.addProperty("id", identity.of(call(drawable, "component")));
        label.add("notes", tooltip(call(value, "tooltip")));
        labels.add(label);
      } else if (!value.getClass().getName().endsWith("AllDiagramsButton")) {
        throw new IllegalStateException("Unknown diagram interaction " + value.getClass());
      }
    }
    List<JsonObject> text = new ArrayList<>();
    for (Object drawable : (Iterable<?>) call(layout, "labels")) {
      JsonObject label = new JsonObject();
      label.add("pos", point(call(drawable, "position")));
      if (drawable.getClass().getName().endsWith("ComponentLabel")) {
        label.addProperty("id", identity.of(call(drawable, "component")));
        label.add("notes", new JsonArray());
        labels.add(label);
      } else if (drawable.getClass().getName().endsWith("Text")) {
        label.addProperty("text", (String) call(drawable, "text"));
        label.addProperty("colour", ((Number) call(drawable, "colour")).intValue() & 0xffffff);
        label.addProperty("small", (Boolean) call(drawable, "small"));
        label.addProperty("shadow", (Boolean) call(drawable, "shadow"));
        text.add(label);
      } else {
        throw new IllegalStateException("Unknown static diagram label " + drawable.getClass());
      }
    }
    result.add("slots", sorted(slots));
    result.add("paths", sorted(paths));
    result.add("groups", sorted(groups));
    result.add("labels", sorted(labels));
    if (!text.isEmpty()) result.add("text", sorted(text));
    return result;
  }

  private static String hash(String text) throws Exception {
    byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(
      text.getBytes(java.nio.charset.StandardCharsets.UTF_8)
    );
    StringBuilder result = new StringBuilder();
    for (byte b : digest) result.append(String.format("%02x", b));
    return result.toString();
  }

  public static JsonObject export() throws Exception {
    Object generator = Class.forName(
      "com.github.dcysteine.neicustomdiagram.generators.gregtech5.oreprocessing.GregTechOreProcessing"
    )
      .getConstructor(String.class)
      .newInstance("browser-ore-processing");
    Object group = call(generator, "generate"),
      matcher = field(group, "matcher");
    Map<Object, String> ids = new IdentityHashMap<>();
    Map<String, JsonObject> scenes = new TreeMap<>();
    for (Object diagram : (Collection<?>) call(matcher, "all")) {
      JsonObject value = scene(diagram, BrowserOreDiagramExporter::identity);
      String id = hash(value.toString());
      ids.put(diagram, id);
      scenes.put(id, value);
    }
    Map<String, Map<String, Set<String>>> matches = new TreeMap<>();
    for (Map.Entry<?, ?> entry : ((Map<?, ?>) field(matcher, "matchData")).entrySet()) {
      String direction = String.valueOf(entry.getKey());
      Map<String, Set<String>> lookup = new TreeMap<>();
      for (Map.Entry<?, ?> association : ((Map<?, ?>) call(entry.getValue(), "asMap")).entrySet()) {
        String id = identity(association.getKey());
        Set<String> diagramIds = lookup.computeIfAbsent(id, k -> new TreeSet<>());
        for (Object diagram : (Collection<?>) association.getValue())
          diagramIds.add(ids.get(diagram));
      }
      matches.put(direction, lookup);
    }
    if (scenes.size() < 100) throw new IllegalStateException(
      "Incomplete ore diagrams: " + scenes.size()
    );
    JsonObject result = new JsonObject();
    result.addProperty("schemaVersion", 1);
    result.addProperty("icon", identity(generator.getClass().getField("ICON").get(null)));
    Gson gson = new Gson();
    result.add("scenes", gson.toJsonTree(scenes));
    result.add("matches", gson.toJsonTree(matches));
    System.err.println("[BrowserOreDiagramExporter] Native scenes=" + scenes.size());
    return result;
  }

  public static JsonObject exportMaterials(
    Function<ItemStack, String> retainItem,
    Function<FluidStack, String> retainFluid
  ) throws Exception {
    JsonObject result = new JsonObject();
    for (String type : new String[] { "Tools", "Parts" }) {
      String suffix = "material" + type.toLowerCase(Locale.ROOT);
      Object group = registeredGroup("neicustomdiagram.diagramgroup.gregtech." + suffix);
      Map<String, ItemStack> items = new LinkedHashMap<>();
      Map<String, FluidStack> fluids = new LinkedHashMap<>();
      ComponentId retain = component -> {
        Object value = call(component, "stack");
        if (value instanceof ItemStack) {
          ItemStack stack = (ItemStack) value;
          String id = retainItem.apply(stack);
          items.putIfAbsent(id, stack);
          return id;
        }
        if (value instanceof FluidStack) {
          FluidStack stack = (FluidStack) value;
          String id = retainFluid.apply(stack);
          fluids.putIfAbsent(id, stack);
          return id;
        }
        throw new IllegalStateException("Unknown material component " + component.getClass());
      };
      Object info = call(group, "info");
      Map<Object, String> ids = new IdentityHashMap<>();
      Map<String, JsonObject> scenes = new TreeMap<>();
      for (Object diagram : (Iterable<?>) call(field(group, "matcher"), "all")) {
        JsonObject value = scene(diagram, retain);
        String id = hash(value.toString());
        ids.put(diagram, id);
        scenes.put(id, value);
      }
      JsonObject captured = new JsonObject();
      captured.addProperty("label", (String) call(info, "groupName"));
      captured.addProperty("icon", retain.of(call(info, "icon")));
      Gson gson = new Gson();
      captured.add("scenes", gson.toJsonTree(scenes));
      captured.add("matches", materialMatches(group, ids, items, fluids, retainItem, retainFluid));
      if (scenes.isEmpty()) throw new IllegalStateException("No material " + type + " diagrams");
      result.add("gt-material-" + type.toLowerCase(Locale.ROOT), captured);
    }
    return result;
  }

  private static IRecipeHandler registeredGroup(String id) throws ReflectiveOperationException {
    Class<?> registry = Class.forName("codechicken.nei.recipe.GuiCraftingRecipe");
    for (String name : new String[] { "craftinghandlers", "serialCraftingHandlers" }) {
      Field handlers = registry.getDeclaredField(name);
      handlers.setAccessible(true);
      for (Object candidate : (Iterable<?>) handlers.get(null)) {
        IRecipeHandler handler = (IRecipeHandler) candidate;
        if (id.equals(handler.getHandlerId())) return handler;
      }
    }
    throw new IllegalStateException("NEI did not register diagram group " + id);
  }

  private static JsonObject materialMatches(
    Object group,
    Map<Object, String> ids,
    Map<String, ItemStack> items,
    Map<String, FluidStack> fluids,
    Function<ItemStack, String> retainItem,
    Function<FluidStack, String> retainFluid
  ) throws Exception {
    Class<?> direction = Class.forName(
      "com.github.dcysteine.neicustomdiagram.api.diagram.interactable.Interactable$RecipeType"
    );
    Method match = group
      .getClass()
      .getMethod("loadDiagrams", String.class, direction, Object[].class);
    JsonObject result = new JsonObject();
    for (String name : new String[] { "CRAFTING", "USAGE" }) {
      Object type = direction.getField(name).get(null);
      Map<String, Set<String>> matches = new TreeMap<>();
      List<ItemStack> candidates = new ArrayList<>(ItemList.items);
      candidates.addAll(items.values());
      for (ItemStack stack : candidates) {
        Set<String> found = matchMaterial(group, match, type, "item", stack, ids);
        if (!found.isEmpty()) matches.put(retainItem.apply(stack), found);
      }
      List<FluidStack> fluidCandidates = new ArrayList<>(fluids.values());
      FluidRegistry.getRegisteredFluids()
        .values()
        .forEach(fluid -> fluidCandidates.add(new FluidStack(fluid, 1000)));
      for (FluidStack stack : fluidCandidates) {
        Set<String> found = matchMaterial(group, match, type, "fluid", stack, ids);
        if (!found.isEmpty()) matches.put(retainFluid.apply(stack), found);
      }
      result.add(name, new Gson().toJsonTree(matches));
    }
    return result;
  }

  private static Set<String> matchMaterial(
    Object group,
    Method match,
    Object direction,
    String kind,
    Object stack,
    Map<Object, String> ids
  ) throws Exception {
    Object page = match.invoke(group, kind, direction, new Object[] { stack });
    Set<String> matches = new TreeSet<>();
    for (Object diagram : (Iterable<?>) field(page, "diagrams")) {
      String id = ids.get(diagram);
      if (id == null) throw new IllegalStateException("Unknown matched material diagram");
      matches.add(id);
    }
    return matches;
  }
}
