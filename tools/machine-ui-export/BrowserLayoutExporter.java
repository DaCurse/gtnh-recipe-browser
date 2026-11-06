package com.github.dcysteine.nesql.exporter.main;

import com.google.gson.*;
import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import net.minecraft.client.Minecraft;
import java.lang.reflect.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.IntFunction;

/** Opt-in, read-only recipe-map frontend snapshot for a disposable GTNH client. */
public final class BrowserLayoutExporter {
    private int ticks;
    private boolean finished;
    public static void install() {
        if (System.getProperty("browser.ui.output") != null)
            FMLCommonHandler.instance().bus().register(new BrowserLayoutExporter());
    }
    private static Object field(Object obj, String name) throws Exception {
        for (Class<?> type = obj.getClass(); type != null; type = type.getSuperclass()) {
            try { Field f = type.getDeclaredField(name); f.setAccessible(true); return f.get(obj); }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(name);
    }
    private static JsonArray pair(Object value, String a, String b) throws Exception {
        JsonArray out = new JsonArray();
        out.add(new JsonPrimitive(((Number)field(value, a)).intValue())); out.add(new JsonPrimitive(((Number)field(value, b)).intValue()));
        return out;
    }
    private static JsonElement drawable(Object value) {
        if (value == null) return JsonNull.INSTANCE;
        JsonObject out = new JsonObject(); out.addProperty("class", value.getClass().getName());
        for (String name : new String[]{"location", "u0", "u1", "v0", "v1", "imageWidth", "imageHeight", "borderWidth"}) {
            try { Object v = field(value, name); if (v instanceof Number) out.addProperty(name, (Number)v); else out.addProperty(name, String.valueOf(v)); }
            catch (Exception ignored) { }
        }
        return out;
    }
    @SuppressWarnings("unchecked")
    private static JsonArray slots(Object ui, String group, boolean fluid, boolean output) throws Exception {
        int count = ((Number)field(ui, "max" + group)).intValue();
        String getter = Character.toLowerCase(group.charAt(0)) + group.substring(1).replace("Inputs", "Input").replace("Outputs", "Output") + "PositionsGetter";
        List<?> positions = ((IntFunction<List<?>>)field(ui, getter)).apply(count);
        JsonArray out = new JsonArray();
        for (int index = 0; index < positions.size(); index++) {
            JsonObject slot = new JsonObject(); slot.add("pos", pair(positions.get(index), "x", "y"));
            slot.add("overlay", drawable(ui.getClass().getMethod("getOverlayForSlot", int.class, boolean.class, boolean.class, boolean.class).invoke(ui, index, fluid, output, false)));
            out.add(slot);
        }
        return out;
    }
    private static JsonArray widgets(Object frontend, Object ui) throws Exception {
        Class<?> handler = Class.forName("com.gtnewhorizons.modularui.api.forge.ItemStackHandler");
        Class<?> pos = Class.forName("com.gtnewhorizons.modularui.api.math.Pos2d");
        Class<?> context = Class.forName("gregtech.nei.GTNEIDefaultHandler$NEITemplateContext");
        Object[] args = new Object[8];
        String[] counts = {"maxItemInputs", "maxItemOutputs", null, "maxFluidInputs", "maxFluidOutputs"};
        for (int i = 0; i < 5; i++) args[i] = handler.getConstructor(int.class).newInstance(counts[i] == null ? 1 : ((Number)field(ui, counts[i])).intValue());
        args[5] = (java.util.function.Supplier<Float>)() -> 0.0f;
        args[6] = (java.util.function.Supplier<Object>)() -> null;
        args[7] = pos.getConstructor(int.class, int.class).newInstance(0, 0);
        Object ctx = context.getConstructors()[0].newInstance(args);
        Object builder = frontend.getClass().getMethod("createNEITemplate", context).invoke(frontend, ctx);
        Object window = builder.getClass().getMethod("build").invoke(builder);
        JsonArray out = new JsonArray();
        for (Object widget : (List<?>)window.getClass().getMethod("getChildren").invoke(window)) {
            String type = widget.getClass().getSimpleName();
            Object texture = null;
            if (type.equals("ProgressBar")) texture = field(widget, "emptyTexture");
            else if (type.equals("DrawableWidget")) texture = widget.getClass().getMethod("getDrawable").invoke(widget);
            else continue;
            JsonObject item = new JsonObject(); item.addProperty("type", type);
            if (texture == field(ui, "logo")) item.addProperty("role", "logo");
            item.add("texture", drawable(texture));
            item.add("pos", pair(widget.getClass().getMethod("getPos").invoke(widget), "x", "y"));
            item.add("size", pair(widget.getClass().getMethod("getSize").invoke(widget), "width", "height"));
            out.add(item);
        }
        return out;
    }
    private static String itemId(net.minecraft.item.ItemStack stack) {
        if (stack.hasTagCompound()) throw new IllegalStateException("Unexpected NBT in EOH presentation identity");
        return "i:" + net.minecraft.item.Item.itemRegistry.getNameForObject(stack.getItem()) + ":" + stack.getItemDamage();
    }
    private static JsonArray recipePresentation(Map<String, ?> registry) throws Exception {
        JsonArray out = new JsonArray();
        for (Object map : registry.values()) {
            for (Object recipe : (Collection<?>)map.getClass().getMethod("getAllRecipes").invoke(map)) {
                Object special = field(recipe, "mSpecialItems");
                if (special == null || !special.getClass().getName().equals("tectech.recipe.EyeOfHarmonyRecipe")) continue;
                JsonObject data = new JsonObject();
                data.addProperty("trigger", itemId((net.minecraft.item.ItemStack)special.getClass().getMethod("getRecipeTriggerItem").invoke(special)));
                JsonArray items = new JsonArray(); data.add("items", items);
                Object masses = special.getClass().getMethod("getItemStackToProbabilityMap").invoke(special);
                for (Object value : (List<?>)special.getClass().getMethod("getOutputItems").invoke(special)) {
                    net.minecraft.item.ItemStack stack = (net.minecraft.item.ItemStack)field(value, "itemStack");
                    JsonObject item = new JsonObject(); item.addProperty("id", itemId(stack));
                    item.addProperty("amount", String.valueOf(field(value, "stackSize")));
                    Object mass = masses.getClass().getMethod("get", Object.class).invoke(masses, stack);
                    if (mass instanceof Number) item.addProperty("solidMass", (Number)mass);
                    items.add(item);
                }
                JsonArray fluids = new JsonArray(); data.add("fluids", fluids);
                for (Object value : (List<?>)special.getClass().getMethod("getOutputFluids").invoke(special)) {
                    net.minecraftforge.fluids.FluidStack stack = (net.minecraftforge.fluids.FluidStack)field(value, "fluidStack");
                    if (stack.tag != null) throw new IllegalStateException("Unexpected fluid NBT in EOH presentation");
                    JsonObject fluid = new JsonObject(); fluid.addProperty("name", stack.getFluid().getName());
                    fluid.addProperty("amount", String.valueOf(field(value, "amount"))); fluids.add(fluid);
                }
                for (String getter : new String[]{"getHydrogenRequirement", "getHeliumRequirement", "getSumOfItems", "getRecipeTimeInTicks"})
                    data.addProperty(getter.substring(3), String.valueOf(special.getClass().getMethod(getter).invoke(special)));
                out.add(data);
            }
        }
        if (out.size() != 43) throw new IllegalStateException("Unexpected Eye of Harmony recipe count: " + out.size());
        return out;
    }
    @SubscribeEvent
    public void tick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END || finished || ++ticks < 40 || Minecraft.getMinecraft().currentScreen == null) return;
        finished = true;
        JsonObject root = new JsonObject(); root.addProperty("schemaVersion", 1);
        JsonArray maps = new JsonArray(); root.add("maps", maps);
        try {
            Map<String, ?> registry = (Map<String, ?>)Class.forName("gregtech.api.recipe.RecipeMap").getField("ALL_RECIPE_MAPS").get(null);
            for (String id : new TreeSet<String>(registry.keySet())) {
                Object map = registry.get(id); Object frontend = map.getClass().getMethod("getFrontend").invoke(map);
                Object ui = frontend.getClass().getMethod("getUIProperties").invoke(frontend);
                Object nei = frontend.getClass().getMethod("getNEIProperties").invoke(frontend);
                JsonObject item = new JsonObject(); maps.add(item); item.addProperty("id", id);
                item.addProperty("name", gregtech.api.util.GTLanguageManager.getTranslation(id));
                item.addProperty("frontend", frontend.getClass().getName());
                item.add("size", pair(field(nei, "recipeBackgroundSize"), "width", "height"));
                item.add("offset", pair(field(nei, "recipeBackgroundOffset"), "x", "y"));
                for (String group : new String[]{"ItemInputs", "ItemOutputs", "FluidInputs", "FluidOutputs"}) {
                    item.add(Character.toLowerCase(group.charAt(0)) + group.substring(1), slots(ui, group, group.startsWith("Fluid"), group.endsWith("Outputs")));
                }
                try { item.add("widgets", widgets(frontend, ui)); }
                catch (Throwable e) { item.addProperty("widgetError", e.toString()); }
                item.addProperty("useSpecialSlot", (Boolean)field(ui, "useSpecialSlot"));
                item.add("specialPos", pair(((java.util.function.Supplier<?>)field(ui, "specialItemPositionGetter")).get(), "x", "y"));
                item.addProperty("useProgressBar", (Boolean)field(ui, "useProgressBar"));
                item.add("progressPos", pair(field(ui, "progressBarPos"), "x", "y"));
                item.add("progressSize", pair(field(ui, "progressBarSize"), "width", "height"));
                item.addProperty("progressDirection", String.valueOf(field(ui, "progressBarDirection")));
                Object texture = field(ui, "progressBarTexture");
                if (texture != null) item.add("progressTexture", drawable(texture.getClass().getMethod("get").invoke(texture)));
            }
            if (maps.size() < 100) throw new IllegalStateException("Recipe registry incomplete: " + maps.size());
            root.add("recipePresentation", recipePresentation(registry));
        } catch (Throwable e) { root.addProperty("error", e.toString()); e.printStackTrace(); }
        try { Files.write(Paths.get(System.getProperty("browser.ui.output")), new GsonBuilder().setPrettyPrinting().create().toJson(root).getBytes(StandardCharsets.UTF_8)); }
        catch (Throwable e) { e.printStackTrace(); }
        Minecraft.getMinecraft().shutdown();
    }
}
