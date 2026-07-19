import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFormat5, PackDecodeError } from '../tools/pack-builder/decoder';
import { fluidRecipeScope } from '../src/lib/fluidContainers';
import { productionFallbackDictionary } from '../src/lib/oreDictionary';

function words(...values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeInt32LE(value, index * 4));
  return buffer;
}

describe('format-v5 decoder rejection', () => {
  it('rejects input which is not gzip data', () => {
    expect(() => decodeFormat5(Buffer.from('not gzip'))).toThrow(/decompress/i);
  });

  it('rejects unsupported versions before following pointers', () => {
    expect(() => decodeFormat5(gzipSync(words(4, 0, 0, 0, 0, 0, 0, 0)))).toThrow(
      new PackDecodeError('Unsupported data format 4; required 5')
    );
  });

  it('rejects truncated root data', () => {
    expect(() => decodeFormat5(gzipSync(words(5)))).toThrow(/truncated/i);
  });

  it('rejects invalid root pointers', () => {
    expect(() => decodeFormat5(gzipSync(words(5, 99, 99, 99, 99, 99, 99, 99)))).toThrow(/invalid pointer/i);
  });
});

const realDataPath = 'tests/fixtures/shadowtheage-v5-2.8.0/data.bin';
const realAtlasPath = 'tests/fixtures/shadowtheage-v5-2.8.0/atlas.webp';
describe.skipIf(!existsSync(realDataPath))('pinned real format-v5 dataset', () => {
  const repository = decodeFormat5(readFileSync(realDataPath));

  it('decodes the pinned 2.8.0-v5 repository completely', () => {
    expect(repository.formatVersion).toBe(5);
    expect(repository.items.filter((item) => item.searchable)).toHaveLength(41_091);
    expect(repository.fluids).toHaveLength(1_542);
    expect(repository.oreDictionaries).toHaveLength(625);
    expect(repository.recipeTypes).toHaveLength(154);
    expect(repository.recipes).toHaveLength(190_080);
    expect(Object.keys(repository.obsoleteRecipeRemaps)).toHaveLength(7_183);
  });

  it('matches the recorded immutable source hashes', () => {
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    expect(digest(realDataPath)).toBe('b0ff8d63f3104e979628c64e650cab17bf0b442e01bdb00c1d8f54c458a3eccc');
    expect(digest(realAtlasPath)).toBe('fa05550ce9657ce49d4512b4aab7fe76d684b70745b0bc7b744c9ae0d6eb6ef5');
  });

  it('preserves the actual shaped and shapeless crafting dimensions', () => {
    const shaped = repository.recipeTypes.find((type) => type.name === 'Crafting (Shaped)');
    const shapeless = repository.recipeTypes.find((type) => type.name === 'Crafting (Shapeless)');
    expect(shaped?.dimensions.itemInputs).toEqual({ columns: 3, rows: 3 });
    expect(shaped?.shapeless).toBe(false);
    expect(shapeless?.dimensions.itemInputs).toEqual({ columns: 3, rows: 3 });
    expect(shapeless?.shapeless).toBe(true);
  });

  it('retains non-searchable crafter goods needed by recipe tabs', () => {
    const hidden = repository.items.filter((item) => !item.searchable);
    expect(hidden.length).toBeGreaterThan(0);
    expect(repository.recipeTypes.some((type) => type.defaultCrafter && hidden.some((item) => item.id === type.defaultCrafter?.id))).toBe(true);
  });

  it('preserves Creosote Oil semi-fluid fuel metadata', () => {
    const creosote = repository.fluids.find((fluid) => fluid.name === 'Creosote Oil');
    const semiFluidType = repository.recipeTypes.find((type) => type.name === 'Semifluid Generator Fuels');
    const fuelRecipe = repository.recipes.find((recipe) =>
      recipe.recipeTypeId === semiFluidType?.id &&
      recipe.inputs.some((input) => input.goodsId === creosote?.id));
    expect(fuelRecipe?.gt?.metadata).toContainEqual({ key: 'fuel_value', value: 48 });
  });

  it('preserves fluid containers and their shared recipe directions', () => {
    const creosote = repository.fluids.find((fluid) => fluid.id === 'f:Railcraft:creosote')!;
    const cell = repository.items.find(
      (item) => item.id === 'i:Railcraft:fluid.creosote.cell:0'
    )!;
    const emptyCellId = 'i:IC2:itemCellEmpty:0';
    const goods = new Map(
      [...repository.items, ...repository.fluids].map((entry) => [entry.id, entry])
    );
    const fluidScope = fluidRecipeScope(creosote.id, goods)!;
    const containerScope = fluidRecipeScope(cell.id, goods)!;

    expect(cell.container).toEqual({
      fluidId: creosote.id,
      amount: 1_000,
      emptyItemId: emptyCellId
    });
    expect(containerScope.memberIds).toEqual(fluidScope.memberIds);
    expect(fluidScope.memberIds.has(emptyCellId)).toBe(false);

    const members = [...fluidScope.memberIds].map((id) => goods.get(id)!);
    const production = new Set(members.flatMap((entry) => entry.productionRecipeIds));
    const usages = new Set(members.flatMap((entry) => entry.usageRecipeIds));
    expect(production.size).toBe(463);
    expect(usages.size).toBe(167);
    expect(production.size).toBeGreaterThan(creosote.productionRecipeIds.length);
    expect(usages.size).toBeGreaterThan(creosote.usageRecipeIds.length);
  });

  it('retains ore-dictionary members and indexes their interchangeable usages', () => {
    const dustIron = repository.oreDictionaries.find((ore) => ore.id === 'o:dustIron');
    const oreRecipe = repository.recipes.find((recipe) =>
      recipe.inputs.some((input) => input.kind === 'oreDict' && input.goodsId === dustIron?.id));
    expect(dustIron?.itemIds.length).toBeGreaterThan(1);
    expect(oreRecipe).toBeDefined();
    for (const memberId of dustIron!.itemIds) {
      expect(repository.items.find((item) => item.id === memberId)?.usageRecipeIds).toContain(oreRecipe!.id);
    }
  });

  it('preserves the Ichorium ore alias needed to recover indirect production', () => {
    const thaumicIchorium = repository.items.find(
      (item) => item.id === 'i:ThaumicTinkerer:kamiResource:2'
    );
    const gregTechIchorium = repository.items.find(
      (item) => item.id === 'i:gregtech:gt.metaitem.01:11978'
    );
    const dictionary = repository.oreDictionaries.find((ore) => ore.id === 'o:ingotIchorium');

    expect(thaumicIchorium?.productionRecipeIds).toHaveLength(0);
    expect(dictionary?.itemIds).toEqual(expect.arrayContaining([
      thaumicIchorium!.id,
      gregTechIchorium!.id
    ]));
    expect(gregTechIchorium?.productionRecipeIds.length).toBeGreaterThan(0);

    const fallback = productionFallbackDictionary(
      thaumicIchorium!.id,
      repository.oreDictionaries,
      (itemId) =>
        (repository.items.find((item) => item.id === itemId)?.productionRecipeIds.length ?? 0) > 0
    );
    const recoveredRecipes = new Set(fallback?.itemIds.flatMap((itemId) =>
      repository.items.find((item) => item.id === itemId)?.productionRecipeIds ?? []));
    expect(fallback?.id).toBe('o:ingotIchorium');
    expect(recoveredRecipes.size).toBe(35);
  });
});
