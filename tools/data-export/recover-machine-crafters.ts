import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { decode } from '@msgpack/msgpack';
import { addRecipeTypeCrafters, parseMachineCrafters } from '../../src/lib/machineCrafters';
import { recipeTypeMachineCapabilities } from '../../src/lib/recipePresentation';
import { readLogicalAsset } from '../pack-builder/recordPages';
import type { PackedGoods, PackedRecipeType } from '../../src/lib/datasetSchema';
import type { GeneratedPackManifest } from '../pack-builder/manifest';

const [sourcePath, packPath] = process.argv.slice(2);
if (!sourcePath || !packPath) throw new Error('Usage: tsx tools/data-export/recover-machine-crafters.ts <source.json> <published-pack>');
const source = parseMachineCrafters(JSON.parse(await readFile(sourcePath, 'utf8')));
const manifestBytes = await readFile(`${packPath}/pack-manifest.json`);
const manifest = JSON.parse(manifestBytes.toString()) as GeneratedPackManifest;
const goods = new Set<string>(), types: PackedRecipeType[] = [];
for (const asset of manifest.catalogAssets.filter(asset => ['goods', 'recipeTypes'].includes(asset.role))) {
  const value = decode(await readLogicalAsset(asset, manifest, 'public/assets/sha256')) as { goods?: PackedGoods[]; recipeTypes?: PackedRecipeType[] };
  value.goods?.forEach(item => goods.add(item.id)); types.push(...(value.recipeTypes ?? []));
}
const recovered: Record<string, NonNullable<PackedRecipeType['additionalCrafters']>> = {};
let missing = 0, correctedTiers = 0;
for (const type of types) {
  const previous = new Map(recipeTypeMachineCapabilities(type).map(value => [value.id, value]));
  const complete = addRecipeTypeCrafters(type, source.types[type.id] ?? [], goods);
  const changed = complete.additionalCrafters?.filter(value => !previous.has(value.id) || previous.get(value.id)!.maxVoltageTier !== value.maxVoltageTier) ?? [];
  for (const value of changed) { if (previous.has(value.id)) correctedTiers++; else missing++; }
  if (changed.length) recovered[type.id] = changed;
}
const value = { schemaVersion: 1, releases: { [manifest.datasetId]: { ...source, types: recovered } } };
await writeFile('src/lib/generated/machine-crafters.json', JSON.stringify(value) + '\n');
await mkdir('assets/source/machine-crafters', { recursive: true });
await writeFile('assets/source/machine-crafters/provenance.json', JSON.stringify({
  datasetId: manifest.datasetId, baseManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  sourceScriptSha256: source.sourceScriptSha256, sourceCategories: Object.keys(source.types).length,
  sourceCrafters: Object.values(source.types).reduce((sum, crafters) => sum + crafters.length, 0),
  restoredCategories: Object.keys(recovered).length,
  restoredCrafters: missing,
  correctedVoltageTiers: correctedTiers,
  patchedBindings: Object.values(recovered).reduce((sum, crafters) => sum + crafters.length, 0)
}, null, 2) + '\n');
console.log(JSON.stringify(recovered, null, 2));
