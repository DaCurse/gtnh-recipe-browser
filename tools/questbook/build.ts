import { readFile, readdir, mkdir, writeFile, copyFile, unlink } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { decode, encode } from '@msgpack/msgpack';
import sharp from 'sharp';
import { prepareBootstrapCatalog } from '../../src/lib/catalogBootstrap';
import { ingredientGroupPreview } from '../../src/lib/catalogMaterialization';
import { readLogicalAsset } from '../pack-builder/recordPages';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import type {
  DatasetAsset,
  DatasetManifest,
  PackedGoodsDetailsShard,
  PackedIngredientGroupsShard,
} from '../../src/lib/datasetSchema';
import { parseMinecraftCodes, restoreMinecraftFormatting } from '../../src/lib/minecraftText';
import { expandRelations } from '../../src/lib/packedRelations';
import type { CatalogEntry } from '../../src/lib/types';
import type { SpecialGoods } from '../../src/lib/specialData';
import type { QuestPack, QuestVersion, QuestVersions } from '../../src/lib/questbook/types';
import { questLinkId } from '../../src/lib/questbook/types';
import { parseQuestJson, readQuest, readChapter, type NbtObject, type SourceStack } from './source';
import { nbtIdentity } from '../../src/lib/nbt';
import { itemNavigationResolver } from '../../src/lib/itemNavigation';
import { writeQuestLinks } from './links';
import { writeNavigationIcons } from './navigationIcons';
import { decodeFormat5 } from '../pack-builder/decoder';
import { exportedQuestItems, questStackIdentity } from './exportedItems';

const [modpackPath, rendererPath, questReportPath, questRequestsPath, processedDataPath] =
  process.argv.slice(2);
if (!modpackPath || !rendererPath)
  throw new Error('Usage: npm run build:quests -- <GTNH-2.9.0-checkout> <BetterQuesting-checkout>');
if (Boolean(questReportPath) !== Boolean(questRequestsPath))
  throw new Error('Supply both the quest export report and its source requests');
if (questReportPath && !processedDataPath)
  throw new Error(
    'Native quest builds require the matching processed data.bin for complete NBT identity',
  );
const exportedItems =
  questReportPath && questRequestsPath
    ? await exportedQuestItems(questReportPath, questRequestsPath)
    : undefined;
const publicRoot = resolve('public');
const questRoot = join(modpackPath, 'config/betterquesting/DefaultQuests');
const commit = (path: string) =>
  execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceCommit = commit(modpackPath),
  rendererCommit = commit(rendererPath);
if (sourceCommit !== '79f9a03b5dd9e492d28998b9dee0ea1d1822a6b1')
  throw new Error('Expected the pinned GTNH 2.9.0 source commit');
if (rendererCommit !== '81109f73cdeee72b26035d7937a170830a5074bf')
  throw new Error('Expected the pinned BetterQuesting renderer commit');
const versions = JSON.parse(await readFile(join(publicRoot, 'versions-v7.json'), 'utf8'));
const recipeVersion = versions.versions.find(
  (version: { gtnhVersion: string }) => version.gtnhVersion === '2.9.0',
);
if (!recipeVersion) throw new Error('Missing 2.9.0 item dataset');
const manifestPath = join(publicRoot, recipeVersion.packManifestUrl);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DatasetManifest &
  GeneratedPackManifest;
const readAsset = (asset: DatasetAsset) =>
  readLogicalAsset(asset, manifest, join(publicRoot, 'assets/sha256'));
const prepared = await prepareBootstrapCatalog(
  manifest,
  'https://quest-build.invalid/' + relative(publicRoot, manifestPath).replaceAll('\\', '/'),
  () => {},
  readAsset,
);
const entries = new Map(prepared.resolved.entries.map((entry) => [entry.id, entry]));
// Hydrate real NBT and complete tooltip formatting using the existing pack codec.
for (const descriptor of manifest.goodsDetailShards) {
  const value = decode(await readAsset(descriptor)) as PackedGoodsDetailsShard;
  const formats = new Map((value.goodsTooltips ?? []).map((row) => [row.id, row.formats]));
  for (const detail of value.goods) {
    const entry = entries.get(detail.id);
    if (!entry) throw new Error(`Unknown detail entry ${detail.id}`);
    entry.nbt = detail.nbt;
    entry.productionCount = detail.productionCount;
    entry.usageCount = detail.usageCount;
    entry.specialProductionCount = detail.specialProductionCount;
    entry.specialUsageCount = detail.specialUsageCount;
    entry.rawTooltip = detail.tooltip ?? entry.rawTooltip;
    const spans = formats.get(detail.id);
    if (spans?.length)
      entry.formattedTooltip = restoreMinecraftFormatting(entry.rawTooltip ?? '', spans);
  }
}
if (processedDataPath) {
  const data = await readFile(processedDataPath);
  const atlas = await readFile(join(dirname(processedDataPath), 'atlas.webp'));
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  if (hash(data) !== manifest.source.dataSha256 || hash(atlas) !== manifest.source.atlasSha256)
    throw new Error('Processed NBT source does not match the selected recipe release');
  // Published recipe details omit most raw NBT for size. Use the verified
  // retained export for semantic matching and exact quest presentation.
  for (const item of decodeFormat5(data, { recipes: false }).items) {
    const entry = entries.get(item.id);
    if (!entry) throw new Error(`Processed NBT references an unpublished item: ${item.id}`);
    entry.nbt = item.nbt;
  }
}
for (const descriptor of manifest.ingredientGroupShards) {
  const value = decode(await readAsset(descriptor)) as PackedIngredientGroupsShard;
  for (const group of expandRelations(value.ingredientGroups, value.lists)) {
    const entry = entries.get(group.id);
    if (entry) Object.assign(entry, ingredientGroupPreview(group.itemIds, entries));
  }
}
const baseItems = new Map<string, CatalogEntry[]>();
const registryItems = new Map<string, CatalogEntry[]>();
for (const entry of entries.values()) {
  if (entry.kind !== 'item') continue;
  const key = `${entry.mod}:${entry.internalName}:${entry.damage ?? 0}`;
  const values = baseItems.get(key) ?? [];
  values.push(entry);
  baseItems.set(key, values);
  const registry = `${entry.mod}:${entry.internalName}`;
  const registryValues = registryItems.get(registry) ?? [];
  registryValues.push(entry);
  registryItems.set(registry, registryValues);
}
const used = new Set<string>();
const unresolved = new Map<string, SourceStack>();
const nbtKeys = new Map<string, string>();
const navigationTargets: Record<string, string> = {};
const variants = new Map<string, CatalogEntry>();
const sourceStacks = new Map<SpecialGoods, SourceStack>();
const resolveStack = (stack: SourceStack): SpecialGoods => {
  const exported = exportedItems?.get(questStackIdentity(stack));
  if (exportedItems && !exported)
    throw new Error(
      `Quest stack absent from the native export inventory: ${questStackIdentity(stack)}`,
    );
  const nativeIds = exported?.goodsIds;
  if (nativeIds?.some((id) => !entries.has(id)))
    throw new Error(
      `Quest export report requires a different recipe dataset: ${nativeIds.join(', ')}`,
    );
  for (const id of nativeIds ?? []) used.add(id);
  let id =
    nativeIds?.[0] ??
    (stack.fluid
      ? `f:${stack.item.includes(':') ? stack.item : 'minecraft:' + stack.item}`
      : stack.ore && !exported?.unavailableReason
        ? `o:${stack.ore}`
        : '');
  if (stack.fluid && !entries.has(id))
    id =
      [...entries.values()].find(
        (entry) => entry.kind === 'fluid' && entry.internalName === stack.item,
      )?.id ?? id;
  if (!nativeIds?.length && !stack.fluid && (!stack.ore || exported?.unavailableReason)) {
    const candidates = baseItems.get(`${stack.item}:${stack.damage}`) ?? [];
    let match: CatalogEntry | undefined;
    if (stack.nbt) {
      const wanted = nbtIdentity(stack.nbt);
      match = candidates.find((entry) => {
        if (!entry.nbt) return false;
        let key = nbtKeys.get(entry.id);
        if (!key) {
          key = nbtIdentity(entry.nbt);
          nbtKeys.set(entry.id, key);
        }
        return key === wanted;
      });
    } else match = candidates.find((entry) => !entry.nbt || entry.nbt === '{}');
    id = match?.id ?? '';
  }
  if (!id || !entries.has(id)) {
    const key = JSON.stringify({ ...stack, count: 1 });
    id = `quest-item:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    const base =
      (baseItems.get(`${stack.item}:${stack.damage}`) ?? []).find((entry) => !entry.nbt) ??
      baseItems.get(`${stack.item}:${stack.damage}`)?.[0] ??
      (stack.nbt ? registryItems.get(stack.item)?.find((entry) => entry.damage === 0) : undefined);
    if (base) {
      used.add(base.id);
      variants.set(id, {
        ...base,
        id,
        name: stack.name ? parseMinecraftCodes(stack.name).plainText : base.name,
        icon: base.icon ? { ...base.icon, ownerId: base.id } : undefined,
        rawName: stack.name ? undefined : base.rawName,
        formattedName: stack.name ? parseMinecraftCodes(stack.name).lines : base.formattedName,
        rawTooltip: undefined,
        tooltip: [],
        nbt: stack.nbt,
        formattedTooltip: stack.lore?.length
          ? parseMinecraftCodes(stack.lore.join('\n')).lines
          : [],
      });
      navigationTargets[id] = base.id;
    } else unresolved.set(id, stack);
  } else used.add(id);
  const tooltipNotes = [
    ...(exported?.unavailableReason
      ? [
          exported.unavailableReason === 'empty-ore-dictionary'
            ? `Ore dictionary unavailable in GTNH 2.9.0: ${stack.ore}`
            : `Quest reference unavailable in GTNH 2.9.0: ${exported.unavailableReason.replaceAll('-', ' ')}`,
        ]
      : []),
  ];
  const result: SpecialGoods = {
    goodsId: id,
    amount: stack.count,
    ...(!entries.has(id) && !variants.has(id) ? { label: stack.ore || stack.item } : {}),
    ...(nativeIds && nativeIds.length > 1 ? { alternatives: nativeIds } : {}),
    ...(stack.ore && !exported?.unavailableReason ? { oreDictionaryId: id } : {}),
    ...(tooltipNotes.length ? { tooltipNotes } : {}),
  };
  sourceStacks.set(result, stack);
  return result;
};
const sources = new Map<string, NbtObject>();
for (const name of (await readdir(questRoot, { recursive: true }))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replaceAll('\\', '/'))
  .sort()) {
  sources.set(
    name.replaceAll('\\', '/'),
    parseQuestJson(await readFile(join(questRoot, name), 'utf8')),
  );
}
const quests = [...sources]
  .filter(([path]) => path.startsWith('Quests/'))
  .map(([, data]) => readQuest(data, resolveStack));
const questIds = new Set(quests.map((quest) => quest.id));
if (questIds.size !== quests.length) throw new Error('Duplicate quest IDs');
const order = (await readFile(join(questRoot, 'QuestLinesOrder.txt'), 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => questLinkId(line.split(':')[0]));
const chapters = [...sources]
  .filter(([path]) => path.endsWith('/QuestLine.json'))
  .map(([path, data]) => {
    const prefix = dirname(path).replaceAll('\\', '/') + '/';
    const placements = [...sources]
      .filter(([name]) => name.startsWith(prefix) && name !== path)
      .map(([, value]) => value);
    return readChapter(data, placements, resolveStack);
  })
  .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const missingRequirements = quests.flatMap((quest) =>
  quest.requirements.filter((dependency) => !questIds.has(dependency.id)),
);
const missingPlacements = chapters.flatMap((chapter) =>
  chapter.quests.filter((placement) => !questIds.has(placement.id)),
);
// BQ's database filter ignores deleted quests. Keep prerequisite references for
// inspection, and omit orphan canvas buttons just as CanvasQuestLine does.
for (const chapter of chapters)
  chapter.quests = chapter.quests.filter((placement) => questIds.has(placement.id));
console.log(
  `Upstream references: ${missingRequirements.length} deleted prerequisites; ${missingPlacements.length} orphan placements.`,
);
// Include the actual members of requested ore dictionaries and wildcard groups.
for (const id of used) for (const member of entries.get(id)?.members ?? []) used.add(member);
const navigationDestination = itemNavigationResolver(entries.values());
for (const id of used) {
  const entry = entries.get(id)!;
  const target = navigationDestination(entry);
  if (target !== id && !navigationTargets[id]) {
    navigationTargets[id] = target;
    used.add(target);
  }
}
const items: CatalogEntry[] = [...used].sort().map((id) => {
  const entry = entries.get(id)!;
  if (entry.icon)
    entry.icon = { ...entry.icon, url: './' + new URL(entry.icon.url).pathname.slice(1) };
  return { ...entry, showNbt: Boolean(entry.nbt && entry.nbt !== '{}') };
});
for (const entry of variants.values()) {
  if (entry.icon)
    entry.icon = { ...entry.icon, url: './' + new URL(entry.icon.url).pathname.slice(1) };
  items.push({ ...entry, showNbt: Boolean(entry.nbt && entry.nbt !== '{}') });
}
const assets = join(publicRoot, 'quests/assets');
await mkdir(assets, { recursive: true });
const midnightRoot = join(modpackPath, 'config/betterquesting/resources/midnight');
const [midnight] = JSON.parse(await readFile(join(midnightRoot, 'bq_themes.json'), 'utf8'));
const frameSizes = new Map(
  chapters.flatMap((chapter) =>
    chapter.quests.map(
      (placement) => [`${placement.width}x${placement.height}`, placement] as const,
    ),
  ),
);
for (const [name, key] of [
  ['normal', 'quest_norm_0'],
  ['main', 'quest_main_0'],
] as const) {
  const texture = midnight.textures[`betterquesting:${key}`];
  const [left, top, width, height] = texture.bounds as number[];
  const borders = texture.padding as number[];
  if (
    texture.sliceMode !== 1 ||
    width !== 24 ||
    height !== 24 ||
    !borders.every((value) => value === borders[0])
  ) {
    throw new Error(`Unsupported Midnight quest frame geometry: ${key}`);
  }
  const source = await sharp(join(midnightRoot, texture.atlas.split(':')[1]))
    .extract({ left: left!, top: top!, width, height })
    .png()
    .toBuffer();
  await writeFile(join(assets, `quest-${name}.png`), source);
  for (const [size, placement] of frameSizes) {
    // Scale the complete frame so its outline and transparent cutouts stay
    // together. Slicing through this artwork's corners exposes a rectangular fill.
    await sharp(source)
      .resize(placement.width, placement.height, { kernel: 'nearest' })
      .png()
      .toFile(join(assets, `quest-${name}-${size}.png`));
  }
}
await copyFile(join(modpackPath, 'LICENSE'), join(assets, 'GTNH-Modpack-LICENSE.txt'));
// Native checkbox cross and open-eye visibility control, from PresetIcon.
const editorIcons = await readFile(
  join(rendererPath, 'src/main/resources/assets/betterquesting/textures/gui/editor_icons.png'),
);
for (const [name, left, top, tint] of [
  ['checkbox-cross.png', 160, 16, [1, 0, 0]],
  ['secret-eye.png', 192, 80, [1, 1, 1]],
] as const)
  await sharp(editorIcons)
    .extract({ left, top, width: 16, height: 16 })
    .linear([...tint], [0, 0, 0])
    .png()
    .toFile(join(assets, name));
await copyFile(join(rendererPath, 'LICENSE'), join(assets, 'BetterQuesting-LICENSE.txt'));
const images: Record<string, string> = {};
const imageSource = 'midnight:textures/gui/guide-nh-pictures/guide-nh-image.png';
await copyFile(
  join(modpackPath, 'config/betterquesting/resources', imageSource.replace(':', '/')),
  join(assets, 'guide-nh-image.png'),
);
images[imageSource] = './quests/assets/guide-nh-image.png';
const pack: QuestPack = {
  schemaVersion: 1,
  version: '2.9.0',
  sourceCommit,
  rendererCommit,
  quests,
  chapters,
  items,
  images,
  navigationTargets,
};
await writeQuestLinks(pack, entries, sourceStacks, manifest.datasetId, publicRoot);
await writeNavigationIcons(entries, publicRoot, manifest.datasetId);
const packed = gzipSync(encode(pack), { level: 9 });
const sha256 = createHash('sha256').update(packed).digest('hex');
await writeFile(join(publicRoot, 'quests', `${sha256}.mpk`), packed);
const version: QuestVersion = {
  id: `quests-2.9.0-${sha256.slice(0, 12)}`,
  version: '2.9.0',
  questCount: quests.length,
  chapterCount: chapters.length,
  sourceCommit,
  sha256,
  bytes: packed.length,
  url: `./${sha256}.mpk`,
  encoding: 'gzip',
};
await writeFile(
  join(publicRoot, 'quests/versions.json'),
  JSON.stringify({ schemaVersion: 1, versions: [version] } satisfies QuestVersions, null, 2) + '\n',
);
for (const filename of await readdir(join(publicRoot, 'quests')))
  if (/^[a-f0-9]{64}\.mpk$/.test(filename) && filename !== `${sha256}.mpk`)
    await unlink(join(publicRoot, 'quests', filename));
await writeFile(
  '.pack-output/quest-unresolved.json',
  JSON.stringify([...unresolved.values()], null, 2),
);
const unresolvedAudit = [...unresolved].map(([id, stack]) => {
  const registered = registryItems.get(stack.item) ?? [];
  return {
    id,
    ...stack,
    reason:
      stack.fluid || stack.ore
        ? 'missing-group-or-fluid'
        : registered.length
          ? 'missing-metadata-variant'
          : 'missing-registry-item',
    availableDamageValues: [...new Set(registered.map((entry) => entry.damage ?? 0))].sort(
      (a, b) => a - b,
    ),
    questIconUses: quests.filter((quest) => quest.icon.goodsId === id).length,
  };
});
await writeFile(
  '.pack-output/quest-icon-audit.json',
  JSON.stringify(
    {
      unresolved: unresolvedAudit,
      itemsWithoutIcons: items
        .filter((item) => !item.icon)
        .map((item) => ({ id: item.id, name: item.name })),
    },
    null,
    2,
  ),
);
console.log(
  `${quests.length} quests, ${chapters.length} chapters, ${items.length} referenced items, ${packed.length} bytes; ${unresolved.size} unresolved item variants (audit: .pack-output/quest-unresolved.json).`,
);
