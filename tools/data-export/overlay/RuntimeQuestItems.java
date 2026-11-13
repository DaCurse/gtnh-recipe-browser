package com.github.dcysteine.nesql.exporter.special;

import codechicken.nei.ItemList;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import cpw.mods.fml.relauncher.FMLInjectionData;
import java.io.File;
import java.io.Reader;
import java.io.Writer;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraftforge.fluids.FluidStack;
import net.minecraftforge.oredict.OreDictionary;

/** Retain every native quest stack through the same factories as recipe goods.
 * No asset substitutions, registry aliases, or per-quest item tables live here. */
public final class RuntimeQuestItems {

  private RuntimeQuestItems() {}

  public static void export(NeiSpecialOverlay.Sink sink) throws Exception {
    File game = (File) FMLInjectionData.data()[6];
    Path root = new File(game, "config/betterquesting/DefaultQuests").toPath();
    if (!Files.isDirectory(root)) throw new IllegalStateException(
      "Missing native questbook " + root
    );
    List<Path> files;
    try (Stream<Path> paths = Files.walk(root)) {
      files = paths
        .filter(path -> path.toString().endsWith(".json"))
        .sorted()
        .collect(Collectors.toList());
    }
    Method decoder = Class.forName("betterquesting.api.utils.NBTConverter").getMethod(
      "JSONtoNBT_Object",
      JsonObject.class,
      NBTTagCompound.class,
      boolean.class
    );
    Class<?> bigStack = Class.forName("betterquesting.api.utils.BigItemStack");
    Method loader = bigStack.getMethod("loadItemStackFromNBT", NBTTagCompound.class);
    Method baseStack = bigStack.getMethod("getBaseStack");
    List<Map<String, Object>> references = new ArrayList<>();
    for (Path file : files) {
      JsonObject data;
      try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
        data = new JsonParser().parse(reader).getAsJsonObject();
      }
      visit(
        sink,
        decoder,
        loader,
        baseStack,
        data,
        root.relativize(file).toString().replace('\\', '/'),
        "",
        references
      );
    }
    if (references.isEmpty()) throw new IllegalStateException(
      "Questbook produced no item references"
    );
    references.sort(Comparator.comparing(row -> (String) row.get("id")));
    Map<String, Object> report = new LinkedHashMap<>();
    report.put("schemaVersion", 1);
    report.put("version", System.getProperty("nesql.special.gtnhVersion"));
    report.put("references", references);
    String repository = System.getProperty("nesql.automation.repository");
    if (
      repository == null || !repository.matches("[A-Za-z0-9._-]+")
    ) throw new IllegalStateException("Quest export requires the automated repository identity");
    Path output = new File(
      new File(new File(game, "nesql"), repository),
      "browser-quest-items.json"
    ).toPath();
    Files.createDirectories(output.getParent());
    try (Writer writer = Files.newBufferedWriter(output, StandardCharsets.UTF_8)) {
      new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create().toJson(report, writer);
    }
  }

  private static void visit(
    NeiSpecialOverlay.Sink sink,
    Method decoder,
    Method loader,
    Method baseStack,
    JsonObject value,
    String source,
    String path,
    List<Map<String, Object>> references
  ) throws Exception {
    boolean fluid = value.has("FluidName:8") && value.has("Amount:3");
    boolean item = value.has("id:8") && (value.has("Count:3") || value.has("Count:1"));
    if (!fluid && !item) {
      for (Map.Entry<String, JsonElement> child : value.entrySet()) {
        if (child.getValue().isJsonObject()) visit(
          sink,
          decoder,
          loader,
          baseStack,
          child.getValue().getAsJsonObject(),
          source,
          path + "/" + child.getKey(),
          references
        );
      }
      return;
    }
    NBTTagCompound tags = (NBTTagCompound) decoder.invoke(null, value, new NBTTagCompound(), true);
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("id", source + "#" + path);
    row.put("source", source);
    row.put("path", path);
    Set<String> ids = new LinkedHashSet<>();
    String reason = null;
    if (fluid) {
      FluidStack stack = FluidStack.loadFluidStackFromNBT(tags);
      if (stack == null || stack.getFluid() == null) reason = "unregistered-fluid";
      else {
        stack.amount = 1;
        ids.add(sink.retainFluid(stack));
      }
    } else {
      String ore = tags.getString("OreDict");
      Object loaded = loader.invoke(null, tags);
      ItemStack stack = loaded == null ? null : (ItemStack) baseStack.invoke(loaded);
      if (!ore.isEmpty()) {
        List<ItemStack> members = OreDictionary.getOres(ore);
        if (members.isEmpty()) reason = "empty-ore-dictionary";
        else {
          String group = sink.retainOreDictionary(ore, members);
          ids.add(group);
          row.put("oreDictionaryId", group);
        }
      } else if (stack == null || stack.getItem() == null) reason = "unregistered-item";
      else if (stack.getItemDamage() == OreDictionary.WILDCARD_VALUE) {
        for (ItemStack candidate : ItemList.items) {
          if (
            candidate.getItem() != stack.getItem() ||
            candidate.getItemDamage() == OreDictionary.WILDCARD_VALUE
          ) continue;
          ItemStack variant = candidate.copy();
          variant.stackSize = 1;
          if (stack.hasTagCompound()) variant.setTagCompound(
            (NBTTagCompound) stack.getTagCompound().copy()
          );
          ids.add(sink.retainItem(variant));
        }
        if (ids.isEmpty()) reason = "wildcard-without-registered-variants";
      } else {
        stack.stackSize = 1;
        ids.add(sink.retainItem(stack));
      }
    }
    List<String> sorted = new ArrayList<>(ids);
    Collections.sort(sorted);
    row.put("goodsIds", sorted);
    row.put("status", reason == null ? "resolved" : "unavailable");
    if (reason != null) row.put("reason", reason);
    references.add(row);
  }
}
