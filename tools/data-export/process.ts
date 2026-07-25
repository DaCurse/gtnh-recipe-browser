#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildPack } from '../pack-builder/builder';
import { decodeFormat5 } from '../pack-builder/decoder';
import { verifyPack } from '../pack-builder/verifier';
import {
  argumentsMap,
  assertPathMissing,
  combinedRevision,
  directoryDigest,
  findFiles,
  readExportSession,
  requiredArgument,
  sha256File,
  auditRenderedItemPaths,
  validateCombinedTooltipSchema
} from './lib';

function run(
  command: string,
  args: string[],
  cwd?: string,
  environment?: NodeJS.ProcessEnv
): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: environment ? { ...process.env, ...environment } : process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

const args = argumentsMap(process.argv.slice(2));
const repositoryRoot = process.cwd();
const sessionPath = resolve(requiredArgument(args, 'session'));
const session = await readExportSession(sessionPath);
const outputWorkDirectory = resolve(args.get('work-dir') ?? session.workDirectory);
const resumeProcessed = args.get('resume-processed') === 'true';
const nesqlRoot = join(session.instanceDirectory, '.minecraft/nesql');
const scripts = await findFiles(nesqlRoot, 'nesql-db.script');
if (scripts.length !== 1) {
  throw new Error(`Expected one NESQL database, found ${scripts.length}: ${scripts.join(', ')}`);
}
const nesqlDirectory = dirname(scripts[0]!);
const imageZip = join(nesqlDirectory, 'image.zip');
await access(imageZip);
if ((await stat(scripts[0]!)).size < 100_000_000) {
  throw new Error('NESQL database is unexpectedly small; export may be incomplete');
}
if ((await stat(imageZip)).size < 10_000_000) {
  throw new Error('NESQL image archive is unexpectedly small; export may be incomplete');
}
await validateCombinedTooltipSchema(scripts[0]!, ['THAUMCRAFT']);
const imageEntries = execFileSync('unzip', ['-Z1', imageZip], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024
}).split('\n').filter(Boolean);
const imageAudit = await auditRenderedItemPaths(scripts[0]!, imageEntries);
if (imageAudit.missingVariantPaths > 0) {
  throw new Error(
    `NESQL image archive is missing ${imageAudit.missingVariantPaths.toLocaleString()} of `
    + `${imageAudit.totalItemPaths.toLocaleString()} item renders referenced by the database. `
    + `The exporter must snapshot image paths before mutable renderers run. Examples: `
    + imageAudit.examples.join(', ')
  );
}

const processedDirectory = join(outputWorkDirectory, 'processed');
const processorDirectory = join(outputWorkDirectory, 'processor');
const firstBuild = join(outputWorkDirectory, 'pack-a');
const secondBuild = join(outputWorkDirectory, 'pack-b');
const finalPack = join(outputWorkDirectory, 'pack');
for (const path of [firstBuild, secondBuild, finalPack]) {
  await assertPathMissing(path, 'Process output');
}
const browserPolicyPatch = join(
  repositoryRoot,
  'tools/data-export/patches/browser-catalog-policy.patch'
);
const namedOreDictionariesPatch = join(
  repositoryRoot,
  'tools/data-export/patches/named-ore-dictionaries.patch'
);
if (!resumeProcessed) {
  await assertPathMissing(processedDirectory, 'Process output');
  await assertPathMissing(processorDirectory, 'Process output');
  await mkdir(processedDirectory, { recursive: true });
  await cp(join(repositoryRoot, 'gtnh@ShadowTheAge/export'), processorDirectory, {
    recursive: true
  });
  const processorPatch = join(repositoryRoot, 'tools/data-export/patches/processor-2.9.patch');
  run('patch', ['--dry-run', '--batch', '-p1', '-i', processorPatch], processorDirectory);
  run('patch', ['--batch', '-p1', '-i', processorPatch], processorDirectory);
  run('patch', ['--dry-run', '--batch', '-p1', '-i', browserPolicyPatch], processorDirectory);
  run('patch', ['--batch', '-p1', '-i', browserPolicyPatch], processorDirectory);
  run('patch', ['--dry-run', '--batch', '-p1', '-i', namedOreDictionariesPatch], processorDirectory);
  run('patch', ['--batch', '-p1', '-i', namedOreDictionariesPatch], processorDirectory);
}
const patchedProcessor = await readFile(join(processorDirectory, 'PackPreProcessor.cs'), 'utf8');
const patchedConverter = await readFile(join(processorDirectory, 'PackConverter.cs'), 'utf8');
const patchedGenerator = await readFile(join(processorDirectory, 'PackGenerator.cs'), 'utf8');
const patchedItemPolicy = await readFile(join(processorDirectory, 'ItemBanlist.cs'), 'utf8');
const patchedAtlasBuilder = await readFile(join(processorDirectory, 'AtlasBuilder.cs'), 'utf8');
if (
  !patchedProcessor.includes('x.mod == "thaumcraftneiplugin"') ||
  !patchedProcessor.includes('x.mod == "aspectrecipeindex"') ||
  !patchedConverter.includes('items.TryGetValue(aspectModel.IconId') ||
  !patchedGenerator.includes('dbParser = null') ||
  !patchedItemPolicy.includes('BrowserCatalogPolicy.RetainRecipeConnectedItems') ||
  !patchedAtlasBuilder.includes('i >> IconAtlas.DimensionBits') ||
  !patchedAtlasBuilder.includes('hasVariantIdentity') ||
  !patchedAtlasBuilder.includes('Mutable item renderers must preserve their persisted image path') ||
  !patchedProcessor.includes('for (var i = 1; i < parts.Length; i++)') ||
  !patchedConverter.includes('GetRepositoryGroups()') ||
  !patchedConverter.includes('MarkOreDictionaryItems()')
) {
  throw new Error('Processor compatibility patch did not produce the expected source');
}
const previousData = join(repositoryRoot, 'tests/fixtures/shadowtheage-v5-2.8.0/data.bin');
if (!resumeProcessed) {
  run('dotnet', [
    'run',
    '--project',
    join(processorDirectory, 'export.csproj'),
    '--',
    nesqlDirectory,
    '--output',
    processedDirectory,
    '--previous',
    previousData
  ], repositoryRoot, {
    // Keep transient hash/remap allocations from exhausting a 16 GiB WSL environment.
    // .NET environment-variable percentages use hexadecimal notation: 0x32 = 50%.
    DOTNET_GCHeapHardLimitPercent: '0x32'
  });
}

const dataPath = join(processedDirectory, 'data.bin');
const atlasPath = join(processedDirectory, 'atlas.webp');
const data = await readFile(dataPath);
const atlas = await readFile(atlasPath);
const repository = decodeFormat5(data);
if (repository.items.length < 75_000 || repository.recipes.length < 200_000) {
  throw new Error(
    `Processed repository is unexpectedly small: ${repository.items.length} items, `
    + `${repository.recipes.length} recipes`
  );
}
const retainedGtTools = repository.items.filter(
  (item) =>
    item.searchable
    && item.mod.toLowerCase() === 'gregtech'
    && item.internalName === 'gt.metatool.01'
);
const craftableGtTools = retainedGtTools.filter((item) => item.productionRecipeIds.length > 0);
if (retainedGtTools.length < 10_000 || craftableGtTools.length < 10_000) {
  throw new Error(
    `Browser retention policy is incomplete: ${retainedGtTools.length} searchable GT tools, `
    + `${craftableGtTools.length} with production recipes`
  );
}
const searchableItems = repository.items.filter((item) => item.searchable);
const tooltips = searchableItems.map((item) => item.tooltip ?? '').filter(Boolean);
if (tooltips.length < searchableItems.length * 0.25) {
  throw new Error(`Only ${tooltips.length} of ${searchableItems.length} searchable items have tooltips`);
}
if (!tooltips.some((tooltip) => tooltip.includes('<span') || tooltip.includes('§'))) {
  throw new Error('Processed repository has no colored tooltip formatting');
}
if (!tooltips.some((tooltip) => tooltip.includes('\n') || /<br\s*\/?>/i.test(tooltip))) {
  throw new Error('Processed repository has no multiline tooltips');
}

const revision = combinedRevision(data, atlas);
const datasetId = `${session.gtnhVersion}-r${revision}`;
const options = {
  dataPath,
  atlasPath,
  gtnhVersion: session.gtnhVersion,
  revision,
  datasetId,
  displayName: `GTNH ${session.gtnhVersion} (revision ${revision})`
};
await buildPack({ ...options, outputDirectory: firstBuild });
await buildPack({ ...options, outputDirectory: secondBuild });
const firstDigest = await directoryDigest(firstBuild);
const secondDigest = await directoryDigest(secondBuild);
if (firstDigest !== secondDigest) {
  throw new Error(`Pack output is not deterministic: ${firstDigest} != ${secondDigest}`);
}
const verification = await verifyPack({
  packDirectory: firstBuild,
  atlasPath,
  spriteSamples: 100
});
await verifyPack({
  packDirectory: secondBuild,
  atlasPath,
  spriteSamples: 100
});
await rm(secondBuild, { recursive: true });
await rename(firstBuild, finalPack);

const provenance = {
  schemaVersion: 1,
  datasetId,
  gtnhVersion: session.gtnhVersion,
  revision,
  generatedAt: new Date().toISOString(),
  sourceArchive: session.archive,
  exporter: session.exporter,
  processor: session.processor,
  browserCatalogPolicy: {
    mode: 'recipe-connected',
    patchSha256: await sha256File(browserPolicyPatch)
  },
  namedOreDictionaries: {
    mode: 'preserve-all-names-and-separate-anonymous-groups',
    patchSha256: await sha256File(namedOreDictionariesPatch)
  },
  toolchains: session.toolchains,
  previousData: {
    path: 'tests/fixtures/shadowtheage-v5-2.8.0/data.bin',
    sha256: await sha256File(previousData)
  },
  processed: {
    dataBin: { bytes: data.byteLength, sha256: await sha256File(dataPath) },
    atlasWebp: { bytes: atlas.byteLength, sha256: await sha256File(atlasPath) }
  },
  deterministicPackSha256: firstDigest,
  verification
};
await writeFile(
  join(finalPack, 'provenance.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
  { flag: 'wx' }
);
const resultPath = join(outputWorkDirectory, 'process-result.json');
await writeFile(
  resultPath,
  `${JSON.stringify({ datasetId, revision, packDirectory: finalPack, verification }, null, 2)}\n`,
  { flag: 'wx' }
);
console.log(JSON.stringify({ result: resultPath, pack: finalPack, datasetId, verification }, null, 2));
