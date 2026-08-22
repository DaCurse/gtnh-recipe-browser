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

function run(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function output(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
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
const patchedBuild = await readFile(join(patchedExporter, 'build.gradle.kts'), 'utf8');
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
  !patchedSpecialOverlay.includes('browser-nei-special.json')
) {
  throw new Error('Exporter compatibility or NEI special-data overlay did not produce the expected source');
}
run('bash', ['./gradlew', 'build'], patchedExporter);

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
