package com.github.dcysteine.nesql.exporter.main;

import codechicken.nei.ItemList;
import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import cpw.mods.fml.relauncher.FMLInjectionData;
import net.minecraft.client.Minecraft;
import net.minecraft.world.WorldSettings;
import net.minecraft.world.WorldType;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.regex.Pattern;

/**
 * Opt-in controller for unattended exports from a disposable Minecraft client.
 *
 * <p>The normal mod remains interactive unless {@code nesql.automation.enabled}
 * is true. The controller creates a new integrated creative world, explicitly
 * starts and waits for NEI item loading, normalizes the export player's
 * Thaumcraft state through server commands, runs the exporter, validates its
 * three durable outputs, writes an atomic status file, and shuts the client
 * down. The outer launcher owns the wall-clock timeout and process exit-code
 * checks.</p>
 */
public final class ExportAutomationController {
    public static final String ENABLED_PROPERTY = "nesql.automation.enabled";
    public static final String REPOSITORY_PROPERTY = "nesql.automation.repository";
    public static final String STATUS_PROPERTY = "nesql.automation.status";
    public static final String WORLD_PROPERTY = "nesql.automation.world";
    public static final String SEED_PROPERTY = "nesql.automation.seed";

    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9._-]+");
    private static final int WORLD_START_DELAY_TICKS = 80;
    private static final int WORLD_FAILURE_GRACE_TICKS = 200;
    private static final int WORLD_JOIN_TIMEOUT_TICKS = 6_000;
    private static final int PLAYER_SETTLE_TICKS = 100;
    private static final int THAUMCRAFT_SETTLE_TICKS = 600;

    private enum Phase {
        BOOTING,
        STARTING_WORLD,
        LOADING_NEI,
        PREPARING_PLAYER,
        EXPORTING,
        COMPLETE,
        FAILED
    }

    private final Minecraft minecraft = Minecraft.getMinecraft();
    private final String repositoryName;
    private final String worldName;
    private final long worldSeed;
    private final File statusFile;
    private int ticks;
    private int playerTicks;
    private int preparedTicks;
    private boolean worldStarted;
    private boolean neiLoadRequested;
    private boolean playerPrepared;
    private boolean exportStarted;
    private volatile boolean shutdownRequested;
    private volatile Phase phase = Phase.BOOTING;

    private ExportAutomationController() {
        repositoryName = safeName(
                System.getProperty(REPOSITORY_PROPERTY, "browser-export"),
                "repository");
        worldName = safeName(
                System.getProperty(WORLD_PROPERTY, "browser-export-world"),
                "world");
        worldSeed = parseSeed(System.getProperty(SEED_PROPERTY, "8675309"));
        String configuredStatus = System.getProperty(STATUS_PROPERTY, "").trim();
        File minecraftDirectory = (File) FMLInjectionData.data()[6];
        statusFile = configuredStatus.length() == 0
                ? new File(minecraftDirectory, "nesql-export-status.json")
                : new File(configuredStatus).getAbsoluteFile();
    }

    /** Installs the controller only for explicitly automated disposable runs. */
    public static void install() {
        if (!Boolean.parseBoolean(System.getProperty(ENABLED_PROPERTY, "false"))) return;
        ExportAutomationController controller = new ExportAutomationController();
        controller.writeStatus(Phase.BOOTING, "Waiting for the client main menu", null);
        FMLCommonHandler.instance().bus().register(controller);
        Logger.MOD.info("Unattended NESQL export controller installed; status: {}", controller.statusFile);
    }

    @SubscribeEvent
    @SuppressWarnings("unused")
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        if (shutdownRequested) {
            minecraft.shutdown();
            return;
        }
        if (phase == Phase.FAILED || phase == Phase.COMPLETE || exportStarted) return;

        try {
            ticks++;
            if (minecraft.thePlayer == null) {
                if (!worldStarted && minecraft.theWorld == null && ticks >= WORLD_START_DELAY_TICKS) {
                    worldStarted = true;
                    writeStatus(Phase.STARTING_WORLD, "Creating disposable integrated world", null);
                    WorldSettings settings = new WorldSettings(
                            worldSeed,
                            WorldSettings.GameType.CREATIVE,
                            false,
                            false,
                            WorldType.FLAT).enableCommands();
                    minecraft.launchIntegratedServer(worldName, worldName, settings);
                }
                if (worldStarted && ticks >= WORLD_START_DELAY_TICKS + WORLD_FAILURE_GRACE_TICKS
                        && !minecraft.isIntegratedServerRunning()) {
                    throw new IllegalStateException("Disposable integrated server stopped before player join");
                }
                if (worldStarted && ticks >= WORLD_START_DELAY_TICKS + WORLD_JOIN_TIMEOUT_TICKS) {
                    throw new IllegalStateException("Timed out waiting to join disposable integrated world");
                }
                return;
            }

            playerTicks++;
            if (!neiLoadRequested && playerTicks >= PLAYER_SETTLE_TICKS) {
                neiLoadRequested = true;
                writeStatus(Phase.LOADING_NEI, "Waiting for the complete NEI item registry", null);
                ItemList.loadItems();
            }
            if (!neiLoadRequested || !ItemList.loadFinished || ItemList.items.isEmpty()) return;

            if (!playerPrepared) {
                playerPrepared = true;
                preparePlayer();
                writeStatus(
                        Phase.PREPARING_PLAYER,
                        "Applied static Thaumcraft research and warp state",
                        null);
                return;
            }
            preparedTicks++;
            if (preparedTicks < THAUMCRAFT_SETTLE_TICKS) return;

            startExport();
        } catch (Throwable error) {
            fail("Client bootstrap failed", error);
        }
    }

    private void preparePlayer() {
        String player = minecraft.thePlayer.getCommandSenderName();
        minecraft.thePlayer.sendChatMessage("/tc research " + player + " all");
        minecraft.thePlayer.sendChatMessage("/tc aspect " + player + " all 50");
        minecraft.thePlayer.sendChatMessage("/tc warp " + player + " set 0");
        minecraft.thePlayer.sendChatMessage("/tc warp " + player + " set 0 PERM");
        minecraft.thePlayer.sendChatMessage("/tc warp " + player + " set 0 TEMP");
    }

    private void startExport() {
        exportStarted = true;
        writeStatus(
                Phase.EXPORTING,
                "Exporting " + ItemList.items.size() + " NEI items",
                null);
        Thread exportThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    new Exporter(true, repositoryName).exportReportException();
                    validateOutput();
                    writeStatus(Phase.COMPLETE, "Export completed and outputs validated", null);
                } catch (Throwable error) {
                    fail("Exporter failed", error);
                    return;
                }
                shutdownRequested = true;
            }
        }, "NESQL unattended export");
        exportThread.setDaemon(false);
        exportThread.start();
    }

    private void validateOutput() throws IOException {
        File minecraftDirectory = (File) FMLInjectionData.data()[6];
        File repository = new File(new File(minecraftDirectory, "nesql"), repositoryName);
        requireNonEmpty(new File(repository, "nesql-db.script"));
        requireNonEmpty(new File(repository, "image.zip"));
        requireNonEmpty(new File(repository, "browser-nei-special.json"));
    }

    private static void requireNonEmpty(File file) throws IOException {
        if (!file.isFile() || file.length() == 0L) {
            throw new IOException("Missing or empty export output: " + file.getAbsolutePath());
        }
    }

    private synchronized void fail(String message, Throwable error) {
        Logger.MOD.error(message, error);
        writeStatus(Phase.FAILED, message, error);
        shutdownRequested = true;
    }

    private synchronized void writeStatus(Phase nextPhase, String message, Throwable error) {
        phase = nextPhase;
        File parent = statusFile.getParentFile();
        File temporary = new File(parent, statusFile.getName() + ".tmp");
        String errorText = error == null ? null : stackTrace(error);
        String json = "{\n"
                + "  \"schemaVersion\": 1,\n"
                + "  \"phase\": \"" + nextPhase.name().toLowerCase() + "\",\n"
                + "  \"updatedAt\": \"" + Instant.now().toString() + "\",\n"
                + "  \"repository\": \"" + escape(repositoryName) + "\",\n"
                + "  \"world\": \"" + escape(worldName) + "\",\n"
                + "  \"worldSeed\": " + worldSeed + ",\n"
                + "  \"neiItemCount\": " + ItemList.items.size() + ",\n"
                + "  \"message\": \"" + escape(message) + "\""
                + (errorText == null ? "\n" : ",\n  \"error\": \"" + escape(errorText) + "\"\n")
                + "}\n";
        try {
            if (parent != null) Files.createDirectories(parent.toPath());
            Files.write(temporary.toPath(), json.getBytes(StandardCharsets.UTF_8));
            try {
                Files.move(
                        temporary.toPath(),
                        statusFile.toPath(),
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException unsupportedAtomicMove) {
                Files.move(
                        temporary.toPath(),
                        statusFile.toPath(),
                        StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException statusError) {
            Logger.MOD.error("Could not write unattended export status " + statusFile, statusError);
        }
    }

    private static String safeName(String value, String label) {
        String trimmed = value.trim();
        if (!SAFE_NAME.matcher(trimmed).matches()) {
            throw new IllegalArgumentException(
                    "Unsafe unattended export " + label + " name: " + value);
        }
        return trimmed;
    }

    private static long parseSeed(String value) {
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Invalid unattended export world seed: " + value, error);
        }
    }

    private static String stackTrace(Throwable error) {
        StringBuilder result = new StringBuilder(error.toString());
        for (StackTraceElement element : error.getStackTrace()) {
            result.append("\n\tat ").append(element.toString());
        }
        Throwable cause = error.getCause();
        if (cause != null && cause != error) {
            result.append("\nCaused by: ").append(stackTrace(cause));
        }
        return result.toString();
    }

    private static String escape(String value) {
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("\t", "\\t");
    }
}
