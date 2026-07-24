#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeFormat5 } from '../pack-builder/decoder';
import { argumentsMap, requiredArgument } from './lib';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const args = argumentsMap(process.argv.slice(2));
const dataPath = resolve(requiredArgument(args, 'data'));
const atlasPath = resolve(requiredArgument(args, 'atlas'));
const outputPath = resolve(requiredArgument(args, 'output'));
const data = await readFile(dataPath);
const atlas = await readFile(atlasPath);
const repository = decodeFormat5(data);

const ichoriumBlade = repository.items.find(
  (item) =>
    item.mod.toLowerCase() === 'gregtech'
    && item.internalName === 'gt.metaitem.02'
    && item.damage === 16978
    && item.name.toLowerCase().includes('ichorium')
);
if (!ichoriumBlade) throw new Error('Could not find the representative Ichorium turbine blade');

const turbines = repository.items.filter(
  (item) =>
    item.mod.toLowerCase() === 'gregtech'
    && item.internalName === 'gt.metatool.01'
    && [170, 172, 174, 176].includes(item.damage)
    && (item.tooltip ?? '').toLowerCase().includes('ichorium')
);
if (turbines.length !== 4) {
  throw new Error(`Expected four Ichorium turbine sizes, found ${turbines.length}`);
}
const comparisonTurbine = repository.items.find(
  (item) =>
    item.mod.toLowerCase() === 'gregtech'
    && item.internalName === 'gt.metatool.01'
    && item.damage === 170
    && (item.tooltip ?? '').includes('Steel:')
);
if (!comparisonTurbine) throw new Error('Could not find a second real small-turbine variant');

const effectTooltipItem = repository.items.find(
  (item) =>
    item.internalName === 'alchemyFlask'
    && item.nbt !== null
    && (item.tooltip ?? '').includes('Flight (7:06)')
);
if (!effectTooltipItem) {
  throw new Error('Could not find a representative item whose final tooltip line is a potion effect');
}

const recipeIds = new Set(turbines.flatMap((item) => item.productionRecipeIds));
const recipes = repository.recipes.filter((recipe) => recipeIds.has(recipe.id));
if (recipes.length < 4) {
  throw new Error(`Expected at least four turbine production recipes, found ${recipes.length}`);
}

const fixture = {
  schemaVersion: 1,
  source: {
    formatVersion: repository.formatVersion,
    dataSha256: sha256(data),
    atlasSha256: sha256(atlas)
  },
  counts: {
    items: repository.items.length,
    fluids: repository.fluids.length,
    recipes: repository.recipes.length,
    searchableGtTools: repository.items.filter(
      (item) =>
        item.searchable
        && item.mod.toLowerCase() === 'gregtech'
        && item.internalName === 'gt.metatool.01'
    ).length
  },
  ichoriumBlade,
  turbines,
  comparisonTurbine,
  effectTooltipItem,
  recipes
};
await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: outputPath, counts: fixture.counts }, null, 2));
