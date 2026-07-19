import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFormat5 } from '../tools/pack-builder/decoder';
import { fluidRecipeScope } from '../src/lib/fluidContainers';
import { parseMinecraftHtml } from '../src/lib/minecraftText';
import { formatCircuitConflicts, formatGtMetadata, voltageTierName } from '../src/lib/recipeMetadata';
import {
  boundedPage,
  ingredientsByGridSlot,
  propagateOreMachineCapabilities,
  recipeCrafterId,
  recipeTypeIconId
} from '../src/lib/recipePresentation';

const fixturePath = 'tests/fixtures/shadowtheage-v5-2.8.0/data.bin';

describe.skipIf(!existsSync(fixturePath))('pinned ShadowTheAge recipe parity', () => {
  const repository = decodeFormat5(readFileSync(fixturePath));
  const recipesById = new Map(repository.recipes.map((candidate) => [candidate.id, candidate]));
  const recipe = (id: string) => recipesById.get(id)!;
  const recipeType = (name: string) =>
    repository.recipeTypes.find((candidate) => candidate.name === name)!;

  it('preserves shaped gaps and shapeless ore inputs in 3 by 3 crafting grids', () => {
    const shaped = recipeType('Crafting (Shaped)');
    const shapedRecipe = recipe('r~--PzugyTN0GPCW6XZZee4A==');
    const shapeless = recipeType('Crafting (Shapeless)');
    const shapelessRecipe = recipe('r~--OsrpuyNROByseobOdD8A==');

    expect(shaped.dimensions.itemInputs).toEqual({ columns: 3, rows: 3 });
    expect(shaped.shapeless).toBe(false);
    expect(shapedRecipe.inputs.map((input) => input.slot)).toEqual([1, 3, 4, 5, 7]);
    expect(ingredientsByGridSlot(shapedRecipe.inputs, shaped.dimensions.itemInputs).size).toBe(5);

    expect(shapeless.dimensions.itemInputs).toEqual({ columns: 3, rows: 3 });
    expect(shapeless.shapeless).toBe(true);
    expect(shapelessRecipe.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'oreDict', goodsId: 'o:cropPear', slot: 1 })
    ]));
  });

  it('propagates crafting machine usage through craftingTableWood', () => {
    const crafting = recipeType('Crafting (Shaped)');
    const craftingTables = repository.oreDictionaries.find(
      (dictionary) => dictionary.id === 'o:craftingTableWood'
    )!;
    const canonical = crafting.defaultCrafter!.id;
    const alternate = craftingTables.itemIds.find((id) => id !== canonical)!;
    const capabilities = propagateOreMachineCapabilities(new Map([
      [canonical, [{
        recipeTypeId: crafting.id,
        recipeTypeName: crafting.name,
        recipeShards: ['crafting-shaped']
      }]]
    ]), [craftingTables]);

    expect(craftingTables.itemIds).toContain(canonical);
    expect(capabilities.get(alternate)?.[0].recipeTypeId).toBe(crafting.id);
    expect(capabilities.get(craftingTables.id)?.[0].recipeTypeName).toBe('Crafting (Shaped)');
  });

  it('matches GT single-block grids, tiered crafters, fluids, duration, and power', () => {
    const assembler = recipeType('Assembler');
    const assembled = recipe('r~7GBeWOBhOXWbAKAKIypUiQ==');

    expect(assembler.dimensions).toEqual({
      itemInputs: { columns: 3, rows: 3 },
      fluidInputs: { columns: 1, rows: 1 },
      itemOutputs: { columns: 1, rows: 1 },
      fluidOutputs: { columns: 0, rows: 0 }
    });
    expect(assembled.inputs).toContainEqual(expect.objectContaining({
      kind: 'fluid',
      goodsId: 'f:gregtech:molten.solderingalloy',
      amount: 576,
      slot: 0
    }));
    expect(assembled.gt).toEqual(expect.objectContaining({
      voltage: 480,
      durationTicks: 600,
      amperage: 1,
      voltageTier: 2
    }));
    expect(voltageTierName(assembled.gt!.voltageTier)).toBe('HV');
    expect(assembled.gt!.durationTicks / 20).toBe(30);
    expect(assembled.gt!.voltage * assembled.gt!.amperage).toBe(480);
    expect(assembled.gt!.voltage * assembled.gt!.amperage * assembled.gt!.durationTicks)
      .toBe(288_000);
    expect(recipeCrafterId(assembler, assembled.gt!.voltageTier))
      .toBe(assembler.singleblocks[2].id);
    expect(recipeTypeIconId(assembler)).toBe(assembler.defaultCrafter!.id);
  });

  it('preserves multiblock fluid-output layouts and default crafter icons', () => {
    const tower = recipeType('Distillation Tower');
    const distillation = recipe('r~-aHYn7whMwOUpmNsP3tTrg==');

    expect(tower.singleblocks).toHaveLength(0);
    expect(tower.multiblocks.length).toBeGreaterThan(1);
    expect(tower.dimensions.fluidOutputs).toEqual({ columns: 3, rows: 4 });
    expect(distillation.inputs).toContainEqual(expect.objectContaining({
      kind: 'fluid',
      amount: 10_000,
      slot: 0
    }));
    expect(distillation.outputs.filter((output) => output.kind === 'fluid').map((output) => output.slot))
      .toEqual([0, 1, 2]);
    expect(recipeCrafterId(tower, distillation.gt!.voltageTier))
      .toBe(tower.defaultCrafter!.id);
  });

  it('retains output chances while respecting declared grids and service slots', () => {
    const centrifuge = recipeType('Multiblock Centrifuge');
    const chanceRecipe = recipe('r~--35gLRBOGyMGVmxgd9J1Q==');
    const overflowRecipe = recipe('r~4YLSCkSdP1y_AKN4gfqoOQ==');

    expect(chanceRecipe.outputs[1]).toEqual(expect.objectContaining({
      slot: 1,
      probability: 0.11
    }));
    expect(overflowRecipe.outputs.some((output) => output.slot >= 6)).toBe(true);
    expect(ingredientsByGridSlot(overflowRecipe.outputs, centrifuge.dimensions.itemOutputs).size)
      .toBeLessThan(overflowRecipe.outputs.length);
    expect(repository.serviceItemIds).toEqual([
      'i:questbook:ItemQuestBook:0',
      'i:minecraft:anvil:0'
    ]);
  });

  it('matches heat, fuel, and circuit metadata wording', () => {
    const blast = recipe('r~--l7UvQdPwieyDfV6NjffQ==');
    const heat = blast.gt!.metadata.find((metadata) => metadata.key === 'coil_heat')!;
    const creosote = repository.fluids.find((fluid) => fluid.name === 'Creosote Oil')!;
    const semiFluid = recipeType('Semifluid Generator Fuels');
    const fuel = repository.recipes.find((candidate) =>
      candidate.recipeTypeId === semiFluid.id &&
      candidate.inputs.some((input) => input.goodsId === creosote.id))!;
    const fuelValue = fuel.gt!.metadata.find((metadata) => metadata.key === 'fuel_value')!;

    expect(formatGtMetadata(heat, {
      recipeType: 'Blast Furnace',
      voltageTier: blast.gt!.voltageTier
    })).toBe('Heat: 5400K (HSS-G)');
    expect(formatCircuitConflicts(blast.gt!.circuitConflicts))
      .toBe('Recipe conflicts on circuit #1');
    expect(formatGtMetadata(fuelValue)).toBe('Fuel value: 48 EU/L');
  });

  it('matches fluid-container unions without including empty containers', () => {
    const goods = new Map(
      [...repository.items, ...repository.fluids].map((entry) => [entry.id, entry])
    );
    const fluid = repository.fluids.find((entry) => entry.id === 'f:Railcraft:creosote')!;
    const container = repository.items.find(
      (entry) => entry.id === 'i:Railcraft:fluid.creosote.cell:0'
    )!;
    const scope = fluidRecipeScope(container.id, goods)!;

    expect(scope.fluidId).toBe(fluid.id);
    expect(scope.selectedContainer).toEqual({
      fluidId: fluid.id,
      amount: 1_000,
      emptyItemId: 'i:IC2:itemCellEmpty:0'
    });
    expect(scope.memberIds.has('i:IC2:itemCellEmpty:0')).toBe(false);
    expect(scope.memberIds.size).toBe(11);
  });

  it('keeps the real 2,000-plus Charcoal collection bounded for rendering', () => {
    const charcoal = repository.items.find((item) => item.id === 'i:minecraft:coal:1')!;
    const recipes = charcoal.productionRecipeIds.map((id) => recipe(id));

    expect(recipes).toHaveLength(2_254);
    expect(boundedPage(recipes, 0, 20)).toHaveLength(20);
    expect(boundedPage(recipes, 112, 20)).toHaveLength(14);
  });

  it('retains multiline and colored tooltip formatting from the pinned exporter', () => {
    const bloodPack = repository.items.find(
      (item) => item.id === 'i:AWWayofTime:itemBloodPack:0'
    )!;
    const boundPickaxe = repository.items.find(
      (item) => item.id === 'i:AWWayofTime:boundPickaxe:0'
    )!;

    expect(parseMinecraftHtml(bloodPack.tooltip).lines).toEqual([
      { segments: [{ text: 'This pack really chafes...', formats: [] }] },
      { segments: [{ text: 'Provides electrical protection.', formats: ['d'] }] },
      { segments: [{ text: 'Protection: 5', formats: [] }] }
    ]);
    expect(parseMinecraftHtml(boundPickaxe.tooltip).plainText)
      .toBe('The Souls of the Damned\ndo not like stone...\n\n+10 Attack Damage');
  });
});
