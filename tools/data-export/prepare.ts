#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  argumentsMap,
  assertPathMissing,
  requiredArgument,
  sha256File,
  type ExportSession
} from './lib';

const KNOWN_ARCHIVE = {
  version: '2.9.0-beta-2',
  bytes: 680_333_339,
  sha256: 'adb853b49e5e17cfe595a8c63c85e2f230c2d03d8aed0ac42bc83c475a1bcbee'
};

interface PinnedRuntimeMod {
  jarName: string;
  modId: string;
  version: string;
}

const PINNED_RUNTIME_MODS: readonly PinnedRuntimeMod[] = [
  { jarName: 'cropsnh-2.0.91.jar', modId: 'cropsnh', version: '2.0.91' },
  { jarName: 'gregtech-5.09.54.20.jar', modId: 'gregtech', version: '5.09.54.20' },
  { jarName: 'BloodMagic-1.9.4.jar', modId: 'AWWayofTime', version: '1.9.4' },
  { jarName: 'EnhancedLootBags-1.3.4.jar', modId: 'enhancedlootbags', version: '1.3.4' },
  { jarName: 'vendingmachine-0.4.95.jar', modId: 'vendingmachine', version: '0.4.95' },
  { jarName: 'NEICustomDiagram-1.8.30.jar', modId: 'neicustomdiagram', version: '1.8.30' },
  { jarName: 'roguelike-1.6.6-GTNH.jar', modId: 'Roguelike', version: '1.6.6-GTNH' },
  { jarName: 'TwilightForest-2.7.36.jar', modId: 'TwilightForest', version: '2.7.36' }
];

function run(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function output(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
}

function metadataContainsPin(value: unknown, modId: string, version: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => metadataContainsPin(entry, modId, version));
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  if (object.modid === modId && object.version === version) return true;
  return metadataContainsPin(object.modList, modId, version);
}

async function extractPinnedRuntimeJars(archivePath: string, workDirectory: string): Promise<string> {
  const runtimeJarsDirectory = join(workDirectory, 'runtime-jars');
  await mkdir(runtimeJarsDirectory, { recursive: true });
  const archiveRoot = `GT New Horizons ${KNOWN_ARCHIVE.version}/.minecraft/mods`;
  const entries = PINNED_RUNTIME_MODS.map((mod) => `${archiveRoot}/${mod.jarName}`);
  try {
    run('unzip', ['-q', '-j', '-o', archivePath, ...entries, '-d', runtimeJarsDirectory]);
  } catch (error) {
    throw new Error(
      `Official archive is missing one or more exact pinned mod jars: ${String(error)}`,
      { cause: error }
    );
  }
  for (const mod of PINNED_RUNTIME_MODS) {
    const jarPath = join(runtimeJarsDirectory, mod.jarName);
    let metadataText: string;
    try {
      metadataText = output('unzip', ['-p', jarPath, 'mcmod.info']);
    } catch (error) {
      throw new Error(
        `Pinned runtime jar ${mod.jarName} has no readable mcmod.info: ${String(error)}`,
        { cause: error }
      );
    }
    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataText);
    } catch (error) {
      throw new Error(
        `Pinned runtime jar ${mod.jarName} has invalid mcmod.info: ${String(error)}`,
        { cause: error }
      );
    }
    if (!metadataContainsPin(metadata, mod.modId, mod.version)) {
      throw new Error(
        `Pinned runtime jar ${mod.jarName} does not declare ${mod.modId} ${mod.version}`
      );
    }
  }
  return runtimeJarsDirectory;
}

function gradlePath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function onlyDirectory(directory: string): Promise<string> {
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) {
    throw new Error(`Expected one top-level instance directory, found ${entries.length}`);
  }
  return join(directory, entries[0]!.name);
}

async function builtJar(libs: string, classifier?: string): Promise<string> {
  const jars = (await readdir(libs)).filter((name) => {
    if (!name.endsWith('.jar')) return false;
    if (classifier) return name.endsWith(`-${classifier}.jar`);
    return !['-deps.jar', '-dev.jar', '-sources.jar', '-sql.jar'].some((suffix) =>
      name.endsWith(suffix)
    );
  });
  if (jars.length !== 1) {
    throw new Error(`Expected one ${classifier ?? 'main'} exporter jar, found: ${jars.join(', ')}`);
  }
  return join(libs, jars[0]!);
}

async function finalizeInstance(source: string, destination: string): Promise<void> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '') || attempt === 10) throw error;
      await delay(2_000);
    }
  }
}

const args = argumentsMap(process.argv.slice(2));
const repositoryRoot = process.cwd();
const archivePath = resolve(requiredArgument(args, 'archive'));
const gtnhVersion = requiredArgument(args, 'version');
if (gtnhVersion !== KNOWN_ARCHIVE.version) {
  throw new Error(`This preparation profile only supports ${KNOWN_ARCHIVE.version}`);
}

// The overlay itself is only an SPI.  A disposable Prism instance is useful
// only when a maintained provider compiled against the live GTNH mod registries
// is installed beside it.  Fail before archive/work-directory mutation rather
// than producing an exporter that will inevitably abort at launch with no
// sidecar.  Keep this check here (before archive stat, mkdir, unzip, or copy)
// so a missing provider cannot leave a half-prepared instance behind.
const specialProviderSource = join(
  repositoryRoot,
  'tools/data-export/overlay/RuntimeSpecialAdapter.java'
);
let specialProviderDetails: string;
try {
  specialProviderDetails = await readFile(specialProviderSource, 'utf8');
} catch {
  throw new Error(
    'Cannot prepare the GTNH Prism export: the maintained live NEI special-data provider is missing at '
      + `${specialProviderSource}. The current overlay supplies only the SPI and cannot emit the ten requested `
      + 'live categories (CropsNH crop-output/mutation-pool/crop-breeding; GT ore vein/small ore/processing; '
      + 'BloodMagic meteor-ritual; EnhancedLootBags loot-bag; VendingMachine vending-trade; Forge/Roguelike/'
      + 'Twilight worldgen-loot). Add and compile that provider against the pinned 2.9.0-beta-2 runtime jars '
      + 'before preparing a disposable instance.'
  );
}
if (!specialProviderDetails.includes('implements NeiSpecialOverlay.Adapter')) {
  throw new Error(
    'Cannot prepare the GTNH Prism export: the maintained NEI special-data provider is not a compiled '
      + `NeiSpecialOverlay.Adapter at ${specialProviderSource}; refusing to create a guaranteed-broken instance.`
  );
}
const workDirectory = resolve(args.get('work-dir') ?? `.export-work/${gtnhVersion}`);
const instanceDirectory = resolve(args.get('instance-dir') ?? join(workDirectory, 'prism-instance'));
const sessionPath = join(workDirectory, 'export-session.json');
const archiveStat = await stat(archivePath);
const archiveSha256 = await sha256File(archivePath);
if (archiveStat.size !== KNOWN_ARCHIVE.bytes || archiveSha256 !== KNOWN_ARCHIVE.sha256) {
  throw new Error(
    `Official archive mismatch: received ${archiveStat.size} bytes / ${archiveSha256}`
  );
}

await assertPathMissing(workDirectory, 'Export work directory');
await assertPathMissing(instanceDirectory, 'Prism export instance');
await mkdir(workDirectory, { recursive: true });
const runtimeJarsDirectory = await extractPinnedRuntimeJars(archivePath, workDirectory);

const exporterRoot = join(repositoryRoot, 'nesql-exporter@ShadowTheAge');
const patchedExporter = join(workDirectory, 'nesql-exporter');
await cp(exporterRoot, patchedExporter, {
  recursive: true,
  filter: (source) => basename(source) !== '.git'
});
const patchPath = join(repositoryRoot, 'tools/data-export/patches/combined-tooltips.patch');
run('patch', ['--dry-run', '--batch', '-p1', '-i', patchPath], patchedExporter);
run('patch', ['--batch', '-p1', '-i', patchPath], patchedExporter);
const specialOverlayPatch = join(
  repositoryRoot,
  'tools/data-export/patches/nei-special-overlay.patch'
);
run('patch', ['--dry-run', '--batch', '-p1', '-i', specialOverlayPatch], patchedExporter);
run('patch', ['--batch', '-p1', '-i', specialOverlayPatch], patchedExporter);
const exportAutomationPatch = join(
  repositoryRoot,
  'tools/data-export/patches/export-automation.patch'
);
run('patch', ['--dry-run', '--batch', '-p1', '-i', exportAutomationPatch], patchedExporter);
run('patch', ['--batch', '-p1', '-i', exportAutomationPatch], patchedExporter);

const providerTarget = join(
  patchedExporter,
  'src/main/java/com/github/dcysteine/nesql/exporter/special/RuntimeSpecialAdapter.java'
);
await cp(specialProviderSource, providerTarget);
const automationControllerSource = join(
  repositoryRoot,
  'tools/data-export/overlay/ExportAutomationController.java'
);
const automationControllerTarget = join(
  patchedExporter,
  'src/main/java/com/github/dcysteine/nesql/exporter/main/ExportAutomationController.java'
);
await cp(automationControllerSource, automationControllerTarget);
const serviceLoaderPath = join(
  patchedExporter,
  'src/main/resources/META-INF/services/com.github.dcysteine.nesql.exporter.special.NeiSpecialOverlay$Adapter'
);
await mkdir(dirname(serviceLoaderPath), { recursive: true });
await writeFile(
  serviceLoaderPath,
  'com.github.dcysteine.nesql.exporter.special.RuntimeSpecialAdapter\n',
  'utf8'
);

const buildPath = join(patchedExporter, 'build.gradle.kts');
const buildBeforeRuntimeJars = await readFile(buildPath, 'utf8');
const runtimeCompileOnly = PINNED_RUNTIME_MODS.map(
  (mod) => `    compileOnly(files("${gradlePath(join(runtimeJarsDirectory, mod.jarName))}"))`
).join('\n');
await writeFile(
  buildPath,
  `${buildBeforeRuntimeJars}\n// Exact GTNH 2.9.0-beta-2 jars used by RuntimeSpecialAdapter.\ndependencies {\n${runtimeCompileOnly}\n}\n`,
  'utf8'
);
const patchedBuild = await readFile(buildPath, 'utf8');
const patchedItem = await readFile(
  join(patchedExporter, 'src/main/java/com/github/dcysteine/nesql/sql/base/item/Item.java'),
  'utf8'
);
const patchedQuestFactory = await readFile(
  join(
    patchedExporter,
    'src/main/java/com/github/dcysteine/nesql/exporter/plugin/quest/factory/QuestFactory.java'
  ),
  'utf8'
);
const patchedItemFactory = await readFile(
  join(
    patchedExporter,
    'src/main/java/com/github/dcysteine/nesql/exporter/plugin/base/factory/ItemFactory.java'
  ),
  'utf8'
);
const patchedRenderJob = await readFile(
  join(patchedExporter, 'src/main/java/com/github/dcysteine/nesql/exporter/render/RenderJob.java'),
  'utf8'
);
const patchedSpecialOverlay = await readFile(
  join(
    patchedExporter,
    'src/main/java/com/github/dcysteine/nesql/exporter/special/NeiSpecialOverlay.java'
  ),
  'utf8'
);
const patchedMain = await readFile(
  join(patchedExporter, 'src/main/java/com/github/dcysteine/nesql/exporter/main/Main.java'),
  'utf8'
);
const copiedProvider = await readFile(providerTarget, 'utf8');
const copiedAutomationController = await readFile(automationControllerTarget, 'utf8');
const serviceLoader = await readFile(serviceLoaderPath, 'utf8');
if (
  !patchedBuild.includes('retrofuturagradle") version "1.4.9"') ||
  !patchedBuild.includes('com.github.GTNewHorizons:AspectRecipeIndex:') ||
  !patchedItem.includes('private String tooltip;') ||
  !patchedQuestFactory.includes('Skipping missing required quest {} referenced by quest {}') ||
  !patchedItemFactory.includes('RenderJob.ofItem(itemStack, item.getImageFilePath())') ||
  !patchedRenderJob.includes('job.imageFilePath = imageFilePath') ||
  !patchedRenderJob.includes('return imageFilePath;') ||
  !patchedSpecialOverlay.includes('No NEI special-data adapters installed') ||
  !patchedSpecialOverlay.includes('CropsNH') ||
  !patchedSpecialOverlay.includes('NEICustomDiagram') ||
  !patchedSpecialOverlay.includes('getEntityManager()') ||
  !patchedSpecialOverlay.includes('browser-nei-special.json') ||
  !patchedMain.includes('ExportAutomationController.install()') ||
  !copiedProvider.includes('implements NeiSpecialOverlay.Adapter') ||
  !copiedAutomationController.includes('nesql.automation.enabled') ||
  !serviceLoader.includes('RuntimeSpecialAdapter') ||
  !patchedBuild.includes('Exact GTNH 2.9.0-beta-2 jars used by RuntimeSpecialAdapter')
) {
  throw new Error('Exporter compatibility or NEI special-data overlay did not produce the expected source');
}
// Do not leave a Gradle daemon/worker behind after the disposable exporter
// build; the one-command orchestrator must be safe to retry in the same host.
run('bash', ['./gradlew', '--no-daemon', 'build'], patchedExporter);

const libs = join(patchedExporter, 'build/libs');
const mainJar = await builtJar(libs);
const dependenciesJar = await builtJar(libs, 'deps');
const instanceStaging = join(dirname(instanceDirectory), `.${basename(instanceDirectory)}.preparing-${process.pid}`);
await mkdir(instanceStaging, { recursive: true });
let instanceFinalized = false;
try {
  // The official Windows pack contains three paths that differ only by directory
  // casing. NTFS merges those directories, so explicitly let the final ZIP entry
  // win instead of ever stopping for an interactive overwrite prompt.
  run('unzip', ['-q', '-o', archivePath, '-d', instanceStaging]);
  const extracted = await onlyDirectory(instanceStaging);
  await finalizeInstance(extracted, instanceDirectory);
  instanceFinalized = true;
} finally {
  if (instanceFinalized) {
    await rm(instanceStaging, { recursive: true, force: true });
  } else {
    console.error(`Preserving incomplete instance staging directory: ${instanceStaging}`);
  }
}

const instanceConfigPath = join(instanceDirectory, 'instance.cfg');
const instanceConfig = await readFile(instanceConfigPath, 'utf8');
await writeFile(
  instanceConfigPath,
  instanceConfig.replace(/^name=.*$/m, `name=GTNH ${gtnhVersion} NESQL Export`),
  'utf8'
);
const modsDirectory = join(instanceDirectory, '.minecraft/mods');
const bugTorch = (await readdir(modsDirectory)).find((name) => /^bugtorch-.*\.jar$/i.test(name));
if (!bugTorch) throw new Error('The official instance does not contain the expected BugTorch jar');
const disabledMods = join(instanceDirectory, '.minecraft/disabled-mods');
await mkdir(disabledMods, { recursive: true });
await rename(join(modsDirectory, bugTorch), join(disabledMods, bugTorch));
await cp(mainJar, join(modsDirectory, basename(mainJar)));
await cp(dependenciesJar, join(modsDirectory, basename(dependenciesJar)));

const session: ExportSession = {
  schemaVersion: 1,
  gtnhVersion,
  createdAt: new Date().toISOString(),
  workDirectory,
  instanceDirectory,
  archive: {
    path: archivePath,
    bytes: archiveStat.size,
    sha256: archiveSha256
  },
  exporter: {
    repository: 'https://github.com/ShadowTheAge/nesql-exporter',
    commit: output('git', ['rev-parse', 'HEAD'], exporterRoot),
    patchSha256: await sha256File(patchPath),
    specialOverlayPatchSha256: await sha256File(specialOverlayPatch),
    exportAutomationPatchSha256: await sha256File(exportAutomationPatch),
    mainJar: basename(mainJar),
    mainJarSha256: await sha256File(mainJar),
    dependenciesJar: basename(dependenciesJar),
    dependenciesJarSha256: await sha256File(dependenciesJar)
  },
  processor: {
    repository: 'https://github.com/ShadowTheAge/gtnh',
    commit: output('git', ['rev-parse', 'HEAD'], join(repositoryRoot, 'gtnh@ShadowTheAge')),
    patchSha256: await sha256File(
      join(repositoryRoot, 'tools/data-export/patches/processor-2.9.patch')
    )
  },
  toolchains: {
    java: output('java', ['--version']).split('\n')[0]!,
    dotnetSdk: output('dotnet', ['--version'])
  }
};
await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ session: sessionPath, instance: instanceDirectory }, null, 2));
