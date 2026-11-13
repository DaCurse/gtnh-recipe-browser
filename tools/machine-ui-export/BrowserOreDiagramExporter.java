package com.github.dcysteine.nesql.exporter.main;

import com.google.gson.*;
import java.lang.reflect.*;
import java.util.*;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraftforge.fluids.FluidStack;

/** Snapshot the actual NEI Custom Diagram generator, including optional layouts. */
public final class BrowserOreDiagramExporter {

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

  private static JsonObject display(Object value) throws Exception {
    JsonObject result = new JsonObject();
    result.addProperty("id", identity(call(value, "component")));
    Optional<?> amount = (Optional<?>) call(value, "stackSize");
    if (amount.isPresent()) result.addProperty("amount", (Number) amount.get());
    Optional<?> info = (Optional<?>) call(value, "additionalInfo");
    if (info.isPresent()) result.addProperty("info", String.valueOf(info.get()));
    result.add("notes", tooltip(call(value, "additionalTooltip")));
    return result;
  }

  private static JsonObject scene(Object diagram) throws Exception {
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
          components.add(display(component));
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
        label.addProperty("id", identity(call(drawable, "component")));
        label.add("notes", tooltip(call(value, "tooltip")));
        labels.add(label);
      } else if (!value.getClass().getName().endsWith("AllDiagramsButton")) {
        throw new IllegalStateException("Unknown diagram interaction " + value.getClass());
      }
    }
    if (((Collection<?>) call(layout, "labels")).size() != 0) throw new IllegalStateException(
      "Unhandled static labels"
    );
    result.add("slots", sorted(slots));
    result.add("paths", sorted(paths));
    result.add("groups", sorted(groups));
    result.add("labels", sorted(labels));
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
      JsonObject value = scene(diagram);
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
}
