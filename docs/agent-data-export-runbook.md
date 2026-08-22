# Agent Runbook: GTNH Dataset Exports

Use this runbook when producing a dataset from a new GTNH release. The operator guide is
[`exporting-current-data.md`](exporting-current-data.md); this document records agent-specific invariants and
failure lessons.

## Non-negotiable invariants

- Treat `gtnh@ShadowTheAge/` and `nesql-exporter@ShadowTheAge/` as pinned, read-only submodules.
- Never use or modify an existing player instance. Launch only the disposable client prepared under `.export-work/`.
- Use native WSL tools. Do not discover or invoke Java, .NET, Gradle, or Node installations from Windows.
- Keep raw NESQL output private and generated work under ignored `.export-work/`.
- Never bypass archive, schema, hash, determinism, sprite, or size validation to make an export pass.
- Preserve old published datasets and immutable local fixtures. A new upstream shape gets a new fixture.

## Toolchain and preparation

Initialize recursively and verify the working tree before changing anything:

```sh
git submodule update --init --recursive
git status --short
```

RetroFuturaGradle requires JDK 8 for its launcher compiler, JDK 17 for Fernflower, and JDK 21 for the normal build.
Install all three side by side; leave Java 21 as the default. The processor currently requires the .NET 8 SDK.
The exporter uses `./gradlew`, so system Gradle is not required.

Use `npm run export:direct -- --version <version>` for an unattended export. The
reviewed profile pins the official archive URL, byte size, and SHA-256. For a
later GTNH release, add a new profile only after independently verifying the
official download—never weaken the check or silently retarget an existing
profile. `export:prepare` and `export:runtime` remain lower-level diagnostic
commands, not operator checkpoints.

The direct resolver reads `mmc-pack.json` and ordered component patches from the
archive. It evaluates Linux x86_64 rules, selects only the matching native
classifier, verifies all library and asset SHA-1/size metadata, preserves JAR
filenames in its immutable cache, materializes virtual assets when requested,
and launches the declared main class under Xvfb. Do not replace this with
hardcoded Forge or LWJGL classpaths. Forge 1.7.10 on Java 18+ requires
`-Djava.security.manager=allow`; keep the live-boot regression for that flag.

The committed compatibility patch is applied only to `.export-work/<version>/nesql-exporter`. It currently:

- upgrades the unavailable RetroFuturaGradle 1.3.35 plugin to the compatible 1.4.9 release;
- combines ordered tooltip lines into the single format-v5 `TOOLTIP` column expected by the pinned processor;
- retains exporter failures as tooltip text for parity with the prior representation;
- stores the persisted item image path in its render job. GT, Tinkers', genetics, and other item implementations can
  mutate copied NBT during metadata inspection or rendering; recomputing the filename later disconnects `image.zip`
  from the database row and produces transparent atlas cells;
- skips only dangling BetterQuesting prerequisite edges while warning with both quest IDs. GTNH packs can retain
  references to removed quests; aborting the entire item and recipe export for an impossible edge is not useful;
- builds against AspectRecipeIndex 1.1.3 and its `aspectrecipeindex` mod ID. The old `thaumcraftneiplugin`
  dependency otherwise silently disables the entire Thaumcraft exporter on GTNH 2.9.

The maintained NEI-special overlay is applied after that compatibility patch,
again only to the disposable exporter copy. For the 2.9.0-beta-2 profile it is
compiled against the release artifacts installed in the prepared instance:

- CropsNH 2.0.91;
- GT5-Unofficial 5.09.54.20;
- BloodMagic 1.9.4;
- EnhancedLootBags 1.3.4;
- VendingMachine 0.4.95;
- NEI Custom Diagram 1.8.30;
- Roguelike Dungeons 1.6.6-GTNH and Twilight Forest 2.7.36.

Preparation must fail when those pins do not match. The special exporter runs
before normal plugin processing so every referenced item, fluid, ore dictionary,
tooltip, and sprite is registered through the existing factories. It writes
`browser-nei-special.json` next to the named NESQL database. The sidecar is
schema-versioned, sorted by stable record ID, and contains pinned source versions,
special-view descriptors, Recipes/Usages lookup IDs, service-icon IDs, and the
category payloads. Missing required categories, duplicate IDs, unknown goods,
unknown ore dictionaries, and unresolvable service icons are fatal; never delete
a bad record to make processing pass.

`tools/data-export/overlay/RuntimeSpecialAdapter.java` is copied only into the
disposable exporter and registered through the adapter service file. Preparation
extracts and verifies the exact production jars before compiling it. The live
boundaries are CropsNH's crop/mutation registries, GT worldgen and recipe maps,
BloodMagic's meteor/reagent registries, EnhancedLootBags' group/drop registry,
VendingMachine's trade database, and the Forge/Roguelike/Twilight loot
registries. A missing registry, version mismatch, empty category, or unresolved
reference must abort the run.

Use `patch --dry-run -p1` followed by `patch -p1`. Do not substitute `git apply` inside the ignored temporary copy:
Git discovers the parent repository and interprets paths from the wrong root.

The official ZIP contains BetterQuesting paths differing only by case. Extraction must use
`unzip -o` so the last ZIP entry wins deterministically without an interactive prompt. Install the unclassified
production exporter jar and `-deps.jar`; never install the `-dev.jar`. Move BugTorch only within the disposable
instance.

Before accepting an in-game export, confirm its “Active plugins” log includes `thaumcraft`. Processing enforces this
again from `METADATA_ACTIVE_PLUGINS`; do not bypass the check, because a database without it omits aspects and native
Thaumcraft recipes while appearing otherwise complete.

The pinned format-v5 processor is also copied to `.export-work/<version>/processor` before use. Its 2.9 compatibility
patch recognizes aspect icon items from both the legacy `thaumcraftneiplugin` and current `aspectrecipeindex`
providers and retains every icon referenced by the exported `ASPECT` table. Apply this patch only to the copy; never
edit `gtnh@ShadowTheAge/`.

The browser-catalog policy patch is applied after the compatibility patch. It disables the calculator-oriented item
banlist in the disposable copy while preserving the converter’s existing relationship-reachability pass. This
restores configurable GT, Tinkers’, TGregworks, genetics, and other craftable families without special-casing an
item ID. The same patch removes the atlas writer’s 65,536-sprite Y-coordinate wrap; retained catalogs can exceed one
legacy sprite page. Processing rejects a result with fewer than 75,000 items or fewer than 10,000 craftable
`gregtech:gt.metatool.01` variants.

Atlas generation rejects a missing NBT-specific image path instead of silently writing a transparent sprite.
Generic goods may still use the processor's upstream sibling fallback. A missing variant render means the exporter
and database disagree and requires a corrected fresh NESQL export; never substitute another variant's image.

The compatibility patch also releases the processor's parsed SQL tables immediately after repository conversion.
This is required for current full exports: retaining both object graphs through recipe remapping can exhaust a 16 GiB
WSL environment. A second collection boundary releases conflict-analysis temporaries before historical remapping and
logs the live managed-heap size. It does not skip records, conflict data, recipe remaps, or icon generation.

The processing command additionally caps the .NET managed heap at 50% of available physical memory. The remap
algorithm creates many short-lived hashing allocations; the cap makes collection occur before WSL invokes its OOM
killer. Remap indexing and matching perform bounded collection checkpoints and report their live heap every 10,000
recipes. The patch also corrects the pinned processor's double dereference of legacy remap source-string pointers,
matching the format-v5 decoder's single-dereference semantics. These controls leave matching inputs and output
unchanged apart from making the previously broken carry-forward traversal usable.

If processing reaches completed `processed/data.bin` and `processed/atlas.webp` but a later sanity, pack, or
verification step fails, correct the general cause and resume with `--resume-processed true`. Resume still validates
the copied processor markers, source schema, decoded counts, deterministic pack output, hashes, and sprite samples;
it only avoids repeating SQL conversion and atlas generation. Never use it after modifying the applied processor
source or against incomplete processed files.

## Automated client checkpoint

The opt-in `ExportAutomationController` creates a flat creative integrated world,
waits for a non-empty completed NEI registry, grants static Thaumcraft research
and aspects, clears all three warp kinds, waits for the server state to settle,
then runs the overwriting exporter. It validates the database script, image ZIP,
and special sidecar before writing `complete` and shutting down the client.

Launcher, controller, and orchestrator status files must be distinct and cleared
for each launch. Treat a missing controller status, `failed` controller phase,
timeout, nonzero JVM exit, or JVM exit before controller completion as failure.
Legacy Forge can terminate with exit code zero after an early bootstrap
exception, so process exit alone is never sufficient. Keep the failed disposable
workspace and logs for audit; retry in a new work directory rather than mutating
or deleting broad paths.

## Processing and release

After the unattended controller confirms completion:

1. Let `npm run export:direct` invoke processing. For diagnosis only, the equivalent lower-level command is
   `npm run export:process -- --session <export-session.json>`.
2. Confirm the processor hashes the sidecar into the revision, validates every goods/ore-dictionary/service-icon
   reference, and reports nonzero records for every required category. Investigate any schema or sanity failure
   generally; never special-case an item or recipe.
3. Confirm the pack was built twice with identical digests and passed asset plus sprite verification.
4. Inspect representative crafting, GT machine, multiblock, fluid-container, ore-dictionary, tooltip-color, and
   large-recipe entries before publication. In-game NEI comparison must also cover one record from each special
   category, complete Meteor Ritual metadata, grouped/limited loot, conditional vending, and a branched
   ore-processing graph with chemical-bath and sifter routes.
5. Run `npm run export:publish -- --pack <verified-pack> --mode stage`. Deploy and verify every staged asset with
   `npm run smoke:deploy -- <origin> --manifest <staged-manifest> --all-assets`, then run the publish command with
   `--mode activate` to update `public/versions.json`. `--mode publish`
   performs both locally for compatibility, but must not be used for a remote release.
6. Run `npm run check`, `npm test`, and `npm run build`, then commit incrementally with Conventional Commit subjects.
7. Deploy and run `npm run smoke:deploy -- https://<site>.netlify.app/`. Do not call the dataset released before the
   deployed-origin verification succeeds.

If preparation fails, inspect the exact generated work and staging paths before removing only those paths. Never
delete broadly under `.export-work/` or a launcher’s instances directory. Keep the pinned format-v5 fixture network-independent even
after newer production data is published.
