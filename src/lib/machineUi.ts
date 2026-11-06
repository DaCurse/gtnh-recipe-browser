import snapshot from './generated/machine-ui.json';
import type { Ingredient, Recipe } from './types';

export const RECIPE_UI_SCALE = 3;

type UiPoint = [number, number];
export type UiGroup = 'itemInputs' | 'itemOutputs' | 'fluidInputs' | 'fluidOutputs';
export interface UiTexture { file: string; size: UiPoint; uv: [number, number, number, number] }
export interface UiSlot { pos: UiPoint; overlay?: UiTexture }
interface UiWidget { pos: UiPoint; size: UiPoint; texture: UiTexture; kind: string }
export interface MachineUiProfile {
  id: string; name: string; frontend: string; size: UiPoint;
  itemInputs: UiSlot[]; itemOutputs: UiSlot[]; fluidInputs: UiSlot[]; fluidOutputs: UiSlot[];
  widgets: UiWidget[]; specialPos?: UiPoint;
}
export const UI_GROUPS: readonly UiGroup[] = ['itemInputs', 'fluidInputs', 'itemOutputs', 'fluidOutputs'];
const textures: UiTexture[] = snapshot.textures.map(uv => ({ file: snapshot.atlas.file,
  size: snapshot.atlas.size as UiPoint, uv: uv as UiTexture['uv'] }));
function expandSlot(slot: { pos: number[]; overlay?: number }): UiSlot {
  return { pos: slot.pos as UiPoint, overlay: slot.overlay === undefined ? undefined : textures[slot.overlay] };
}
export const machineUiProfiles: MachineUiProfile[] = snapshot.maps.map(profile => ({
  ...profile, size: profile.size as UiPoint,
  itemInputs: profile.itemInputs.map(expandSlot),
  itemOutputs: profile.itemOutputs.map(expandSlot),
  fluidInputs: profile.fluidInputs.map(expandSlot),
  fluidOutputs: profile.fluidOutputs.map(expandSlot),
  widgets: profile.widgets.map(widget => ({ ...widget, pos: widget.pos as UiPoint, size: widget.size as UiPoint, texture: textures[widget.texture]! })),
  specialPos: profile.specialPos as UiPoint | undefined
}));
const byName = new Map<string, MachineUiProfile[]>();
const signatures = new Map<string, Set<string>>();
for (const profile of machineUiProfiles) {
  const group = byName.get(profile.name) ?? [];
  const known = signatures.get(profile.name) ?? new Set<string>();
  const { size, itemInputs, itemOutputs, fluidInputs, fluidOutputs, widgets, specialPos } = profile;
  const signature = JSON.stringify({ size, itemInputs, itemOutputs, fluidInputs, fluidOutputs, widgets, specialPos });
  if (!known.has(signature)) group.push(profile);
  known.add(signature); signatures.set(profile.name, known); byName.set(profile.name, group);
}
export function machineUiAsset(file: string): string {
  return `${import.meta.env.BASE_URL}assets/machine-ui/${file}`;
}
export function recipeUiIngredients(recipe: Recipe): Record<UiGroup, Ingredient[]> {
  return {
    itemInputs: recipe.inputs.filter(item => item.kind !== 'fluid'),
    fluidInputs: recipe.inputs.filter(item => item.kind === 'fluid'),
    itemOutputs: recipe.outputs.filter(item => item.kind !== 'fluid'),
    fluidOutputs: recipe.outputs.filter(item => item.kind === 'fluid')
  };
}
/** Only use a runtime snapshot when its release and source category agree. */
export function machineUiFor(recipe: Recipe): MachineUiProfile | undefined {
  if (recipe.gtnhVersion !== snapshot.gtnhVersion || !recipe.typeId?.includes(':gregtech:')) return undefined;
  const ingredients = recipeUiIngredients(recipe);
  const matching = (byName.get(recipe.type) ?? []).filter(profile => UI_GROUPS.every(group => {
    const slots = profile[group];
    const columns = new Set(slots.map(slot => slot.pos[0])).size;
    const rows = new Set(slots.map(slot => slot.pos[1])).size;
    return new Set(slots.map(slot => slot.pos.join(','))).size === slots.length
      && columns === recipe.layout[group].columns && rows === recipe.layout[group].rows
      && ingredients[group].every(item => Number.isInteger(item.slot ?? 0) && (item.slot ?? 0) >= 0 && (item.slot ?? 0) < slots.length);
  }));
  // A display-name collision must never silently choose a different machine.
  return matching.length === 1 ? matching[0] : undefined;
}
export function machineUiBounds(profile: MachineUiProfile) {
  const rects = [
    ...UI_GROUPS.flatMap(group => profile[group].map(slot => ({ pos: slot.pos, size: [18,18] }))),
    ...profile.widgets,
    ...(profile.specialPos ? [{ pos: profile.specialPos, size: [18,18] }] : [])
  ];
  const x = Math.min(0, ...rects.map(rect => rect.pos[0]));
  const y = Math.min(0, ...rects.map(rect => rect.pos[1]));
  const right = Math.max(profile.size[0], ...rects.map(rect => rect.pos[0]! + rect.size[0]!));
  const bottom = Math.max(profile.size[1], ...rects.map(rect => rect.pos[1]! + rect.size[1]!));
  return { x, y, width: right - x, height: bottom - y };
}
