#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { decodeFormat5 } from '../pack-builder/decoder';
import { argumentsMap, requiredArgument } from './lib';

const SPRITE_SIZE = 32;
const ATLAS_COLUMNS = 256;

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
const atlasImage = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (atlasImage.info.width !== ATLAS_COLUMNS * SPRITE_SIZE || atlasImage.info.channels !== 4) {
  throw new Error(
    `Unexpected atlas shape ${atlasImage.info.width}x${atlasImage.info.height}`
    + ` with ${atlasImage.info.channels} channels`
  );
}

function hasVisibleSprite(iconId: number): boolean {
  const x = (iconId % ATLAS_COLUMNS) * SPRITE_SIZE;
  const y = Math.floor(iconId / ATLAS_COLUMNS) * SPRITE_SIZE;
  for (let row = 0; row < SPRITE_SIZE; row++) {
    let alpha = ((y + row) * atlasImage.info.width + x) * 4 + 3;
    for (let pixel = 0; pixel < SPRITE_SIZE; pixel++, alpha += 4) {
      if (atlasImage.data[alpha] !== 0) return true;
    }
  }
  return false;
}

function spriteAudit(items: typeof repository.items): {
  total: number;
  visible: number;
  transparent: number;
} {
  const visible = items.filter((item) => hasVisibleSprite(item.iconId)).length;
  return { total: items.length, visible, transparent: items.length - visible };
}

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

const ironOre = repository.items.find(
  (item) => item.id === 'i:gregtech:gt.blockores2:32'
);
if (!ironOre) throw new Error('Could not find the representative GregTech Iron Ore');
const ironOreDictionaries = repository.oreDictionaries.filter(
  (dictionary) => dictionary.itemIds.includes(ironOre.id)
);
for (const expected of ['o:oreIron', 'o:oreAnyIron']) {
  if (!ironOreDictionaries.some((dictionary) => dictionary.id === expected)) {
    throw new Error(`Iron Ore is missing named dictionary ${expected}`);
  }
}
const anonymousIronGroup = repository.ingredientGroups.find(
  (group) => group.itemIds.includes(ironOre.id)
);
if (!anonymousIronGroup) throw new Error('Could not find an anonymous recipe group containing Iron Ore');
const anonymousIronRecipe = repository.recipes.find(
  (recipe) => recipe.inputs.some((input) =>
    input.kind === 'itemGroup' && input.goodsId === anonymousIronGroup.id)
);
if (!anonymousIronRecipe) {
  throw new Error('Could not find a recipe referencing the anonymous Iron Ore group');
}

const recipeIds = new Set(turbines.flatMap((item) => item.productionRecipeIds));
const recipes = repository.recipes.filter((recipe) => recipeIds.has(recipe.id));
if (recipes.length < 4) {
  throw new Error(`Expected at least four turbine production recipes, found ${recipes.length}`);
}

const searchableGtTools = repository.items.filter(
  (item) =>
    item.searchable
    && item.mod.toLowerCase() === 'gregtech'
    && item.internalName === 'gt.metatool.01'
);
const wrenchNames = ['Wrench (LV)', 'Wrench (MV)', 'Wrench (HV)'];
const gtToolSpriteAudit = spriteAudit(searchableGtTools);
const wrenchSpriteAudit = Object.fromEntries(
  wrenchNames.map((name) => [name, spriteAudit(searchableGtTools.filter((item) => item.name === name))])
);
if (
  gtToolSpriteAudit.transparent > 0
  || Object.values(wrenchSpriteAudit).some((audit) => audit.transparent > 0)
) {
  throw new Error('GT tool sprite audit found transparent retained variants');
}

const fixture = {
  schemaVersion: 3,
  source: {
    formatVersion: repository.formatVersion,
    dataSha256: sha256(data),
    atlasSha256: sha256(atlas)
  },
  counts: {
    items: repository.items.length,
    fluids: repository.fluids.length,
    recipes: repository.recipes.length,
    searchableGtTools: searchableGtTools.length
  },
  spriteAudit: {
    searchableGtTools: gtToolSpriteAudit,
    wrenches: wrenchSpriteAudit
  },
  ichoriumBlade,
  turbines,
  comparisonTurbine,
  effectTooltipItem,
  ironOre,
  ironOreDictionaries,
  anonymousIronGroup,
  anonymousIronRecipe,
  recipes
};
await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: outputPath, counts: fixture.counts }, null, 2));
