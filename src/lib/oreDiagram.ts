import registry from './generated/ore-diagrams.json';
import { decompress, fetchVerified } from './datasetAssets';
import { recordDatasetAsset } from './storage';
import type { CatalogEntry, RecipeView } from './types';
import type { SpecialRecord, SpecialResolver } from './specialData';

export type OrePoint = [number, number];
export interface OreComponent { id: string; amount?: number; info?: string; notes: string[] }
export interface OreScene {
  slots: Array<{ key: string; index?: number; pos: OrePoint; size: number; notes: string[] }>;
  paths: Array<{ a: OrePoint; b: OrePoint; arrow: boolean }>;
  groups: Array<{ pos: OrePoint; components: OreComponent[]; notes: string[] }>;
  labels: Array<{ pos: OrePoint; id: string; notes: string[] }>;
}
interface Descriptor { sha256: string; bytes: number }
export interface OreDiagramIndex {
  schemaVersion: 1; datasetId: string; scenes: Descriptor;
  iconId: string;
  sceneIds: string[];
  lists: number[][];
  matches: { recipes: Record<string, number>; usages: Record<string, number> };
}
interface Scenes { schemaVersion: 1; datasetId: string; scenes: Record<string, OreScene> }
const loads = new Map<string, Promise<unknown>>();
async function loadJson<T>(descriptor: Descriptor, datasetId: string): Promise<T> {
  let loading = loads.get(descriptor.sha256);
  if (!loading) {
    loading = (async () => {
      if (!/^[a-f0-9]{64}$/.test(descriptor.sha256) || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) throw new Error('Invalid native ore asset');
      const asset = { ...descriptor, id: `ore-diagrams-${descriptor.sha256}`, encoding: 'gzip' as const,
        url: new URL(`${import.meta.env.BASE_URL}assets/sha256/${descriptor.sha256}`, document.baseURI).href };
      const bytes = await fetchVerified(asset, document.baseURI);
      const value: unknown = JSON.parse(new TextDecoder().decode(await decompress(bytes)));
      await recordDatasetAsset(datasetId, descriptor.sha256, descriptor.bytes);
      return value;
    })();
    loads.set(descriptor.sha256, loading);
    void loading.catch(() => loads.delete(descriptor.sha256));
  }
  return loading as Promise<T>;
}
export function hasNativeOreDiagrams(datasetId: string): boolean {
  return datasetId in registry.releases;
}
export async function loadOreDiagramIndex(datasetId: string): Promise<OreDiagramIndex | undefined> {
  const descriptor = (registry.releases as Record<string, Descriptor>)[datasetId];
  if (!descriptor) return undefined;
  const value = await loadJson<OreDiagramIndex>(descriptor, datasetId);
  if (value.schemaVersion !== 1 || value.datasetId !== datasetId || !value.matches?.recipes || !value.matches?.usages) throw new Error('Native ore index does not match the dataset');
  return value;
}
/** The upstream matcher ignores NBT and also matches the fluid inside containers. */
export function oreDiagramMatches(index: OreDiagramIndex | undefined, entry: CatalogEntry, view: RecipeView): string[] {
  if (!index || view === 'machineUsages') return [];
  const ids = [entry.id, ...(entry.members ?? []), ...(entry.container ? [entry.container.fluidId] : [])];
  return [...new Set(ids.flatMap(id => {
    const list = index.matches[view][id.replace(/^((?:i:[^:]+:[^:]+):\d+):[a-f0-9]{40}$/, '$1')];
    return list === undefined ? [] : index.lists[list]!.map(scene => index.sceneIds[scene]!);
  }))].sort();
}
export function oreSceneBounds(scene: OreScene) {
  const points = [...scene.slots.map(slot => [slot.pos[0] + slot.size / 2, slot.pos[1] + slot.size / 2]),
    ...scene.labels.map(label => [label.pos[0] + 9, label.pos[1] + 9]), ...scene.paths.flatMap(path => [path.a, path.b])];
  return { width: Math.max(166, ...points.map(point => point[0]!)) + 2, height: Math.max(18, ...points.map(point => point[1]!)) + 2 };
}
/** NEI Custom Diagram Draw.drawLine/drawArrowhead use filled pixel rectangles. */
export function oreLineRect(a: OrePoint, b: OrePoint) {
  return { x: Math.min(a[0], b[0]) - 1, y: Math.min(a[1], b[1]) - 1,
    width: Math.abs(a[0] - b[0]) + 2, height: Math.abs(a[1] - b[1]) + 2 };
}
export function oreArrowRects(a: OrePoint, b: OrePoint) {
  const dx = Math.sign(a[0] - b[0]), dy = Math.sign(a[1] - b[1]);
  return [0, 1, 2].map(i => oreLineRect(
    [b[0] + i * dx + i * dy, b[1] + i * dy + i * dx],
    [b[0] + i * dx - i * dy, b[1] + i * dy - i * dx]));
}
export async function nativeOreRecords(datasetId: string, entry: CatalogEntry | undefined, view: RecipeView, resolve: SpecialResolver): Promise<SpecialRecord[]> {
  const index = await loadOreDiagramIndex(datasetId);
  if (!index || view === 'machineUsages') return [];
  const data = await loadJson<Scenes>(index.scenes, datasetId);
  if (data.schemaVersion !== 1 || data.datasetId !== datasetId) throw new Error('Native ore scenes do not match the dataset');
  const ids = entry ? oreDiagramMatches(index, entry, view) : Object.keys(data.scenes).sort();
  return ids.map(id => {
    const scene = data.scenes[id];
    if (!scene) throw new Error(`Missing native ore diagram ${id}`);
    const oreSlot = scene.slots.find(slot => slot.key === 'raw-ore') ?? scene.slots.find(slot => slot.key === 'true-raw-ore');
    const ore = scene.groups.find(group => oreSlot && group.pos[0] === oreSlot.pos[0] && group.pos[1] === oreSlot.pos[1])?.components[0];
    const name = ore ? resolve(ore.id)?.name ?? 'Ore processing' : 'Ore processing';
    const goodsIds = [...new Set([...scene.groups.flatMap(group => group.components.map(component => component.id)), ...scene.labels.map(label => label.id)])];
    return { id: `native-ore:${id}`, category: 'gt-ore-processing', title: name,
      searchText: [name, ...goodsIds.map(goodsId => resolve(goodsId)?.name ?? goodsId)].join(' '), goodsIds,
      payload: { nativeScene: scene } };
  });
}
