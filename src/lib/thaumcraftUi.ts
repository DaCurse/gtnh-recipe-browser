import type { Ingredient, Recipe } from './types';
import type { MachineUiProfile, UiTexture, UiWidget } from './machineUi';

// ARI 1.1.6 TemplateThaumHandler + InfusionRecipeHandler + ShapedArcaneRecipeHandler.
// Exporter componentFillOrder is reversed to recover the original component order.
const componentFillOrder = [2, 22, 10, 14, 0, 24, 4, 20, 1, 23, 3, 21, 5, 19, 15, 9, 7, 17, 11, 13, 6, 18, 8, 16, 25, 26, 27, 28, 29, 30, 31, 32];
const aspectItem = 'i:aspectrecipeindex:aspect:';
function texture(x: number, y: number, width: number, height: number): UiTexture {
  return { file: 'thaumcraft-overlay.png', size: [512, 512],
    uv: [x / 256, y / 256, (x + width) / 256, (y + height) / 256] };
}
const resultWidget: UiWidget = { kind: 'ThaumcraftResult', pos: [39.3 * 1.75, -0.6 * 1.75],
  size: [16 * 1.75, 17 * 1.75], texture: texture(20, 3, 16, 17) };

/** A display-only projection; exported quantities, identities and original recipe stay intact. */
export function thaumcraftUiFor(recipe: Recipe): { recipe: Recipe; profile: MachineUiProfile } | undefined {
  const infusion = recipe.type === 'Arcane Infusion';
  const crafting = recipe.type === 'Magical Crafting (Shaped)' || recipe.type === 'Magical Crafting (Shapeless)';
  if (recipe.gtnhVersion !== '2.9.0' || !recipe.typeId?.includes(':thaumcraft:') || (!infusion && !crafting)) return;
  if (recipe.outputs.length !== 1 || recipe.outputs[0]?.kind === 'fluid'
    || recipe.inputs.some(input => input.kind === 'fluid')
    || recipe.layout.itemInputs.columns !== (infusion ? 5 : 3)
    || recipe.layout.itemInputs.rows !== (infusion ? 7 : 5)) return;
  const aspects = recipe.inputs.filter(input => input.id.startsWith(aspectItem))
    .sort((a, b) => (b.amount ?? 1) - (a.amount ?? 1) || (a.slot ?? 0) - (b.slot ?? 0));
  const items = recipe.inputs.filter(input => !input.id.startsWith(aspectItem));
  const positions: Array<[number, number]> = [];
  const inputs: Ingredient[] = [];
  const add = (input: Ingredient, x: number, y: number) => {
    inputs.push({ ...input, slot: inputs.length });
    // RecipeGrid's 18px cell includes the native 1px margin around a 16px icon.
    positions.push([x - 1, y - 1]);
  };
  const widgets: UiWidget[] = [resultWidget];
  if (infusion) {
    const central = items.find(item => item.slot === 12);
    const surrounding = items.filter(item => item.slot !== 12);
    if (!central || surrounding.some(item => !componentFillOrder.includes(item.slot ?? -1))) return;
    surrounding.sort((a, b) => componentFillOrder.indexOf(a.slot!) - componentFillOrder.indexOf(b.slot!));
    add(central, 75, 63);
    let rotation = -90;
    const slice = Math.fround(360 / surrounding.length);
    for (const item of surrounding) {
      const angle = Math.fround(Math.fround(rotation / 180) * Math.PI);
      // Minecraft 1.7 MathHelper's 65536-entry float sine table, including
      // Java float arithmetic/truncation, rather than browser trigonometry.
      const tableValue = (cosine: boolean) => {
        const scaled = Math.fround(angle * Math.fround(10430.378));
        const index = Math.trunc(cosine ? Math.fround(scaled + 16384) : scaled) & 65535;
        return Math.fround(Math.sin(index * Math.PI * 2 / 65536));
      };
      add(item, 75 + Math.trunc(Math.fround(tableValue(true) * 40)),
        63 + Math.trunc(Math.fround(tableValue(false) * 40)));
      rotation = Math.fround(rotation + slice);
    }
    widgets.push({ kind: 'RunicMatrix', pos: [26.5 * 1.75, 20 * 1.75], size: [42 * 1.75, 42 * 1.75],
      texture: texture(207, 78, 42, 42) });
    const rows = Math.ceil(aspects.length / 7);
    let index = 0;
    for (let row = 0; row < rows; row++) {
      const columns = Math.floor((aspects.length + rows - row - 1) / rows);
      const offset = Math.trunc((100 - columns * 20) / 2);
      for (let column = 0; column < columns; column++) add(aspects[index++]!, 35 + column * 20 + offset, 130 + row * 20);
    }
  } else {
    if (items.some(item => !Number.isInteger(item.slot) || item.slot! < 0 || item.slot! > 8) || aspects.length > 6) return;
    for (const item of items) add(item, [47, 75, 103][item.slot! % 3]!, [38, 65, 92][Math.floor(item.slot! / 3)]!);
    const startX = 35 + Math.trunc((100 - aspects.length * 19) / 2);
    aspects.forEach((aspect, index) => add(aspect, startX + index * 19, 122));
    widgets.push({ kind: 'ArcaneGrid', pos: [20 * 1.75, 16 * 1.75], size: [52 * 1.75, 52 * 1.75], texture: texture(112, 15, 52, 52) },
      { kind: 'ArcaneWand', pos: [0, 52 * 1.25 * 1.75], size: [12 * 1.25 * 1.75, 12 * 1.25 * 1.75],
        texture: texture(68, 76, 12, 12), opacity: 0.4 });
  }
  const projected = { ...recipe, inputs, outputs: [{ ...recipe.outputs[0]!, slot: 0 }],
    layout: { ...recipe.layout, itemInputs: { columns: Math.max(inputs.length, 1), rows: 1 } } };
  const height = Math.max(142, ...positions.map(point => point[1] + 20));
  return { recipe: projected, profile: { id: infusion ? 'thaumcraft.infusion' : 'thaumcraft.arcane',
    name: recipe.type, frontend: 'AspectRecipeIndex 1.1.6', size: [166, height], slotFrames: false,
    itemInputs: positions.map(pos => ({ pos })), itemOutputs: [{ pos: [74, 4] }],
    fluidInputs: [], fluidOutputs: [], widgets } };
}
