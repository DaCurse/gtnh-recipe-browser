#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { decodeFormat5 } from './decoder';
import {
  buildSharedLayout,
  DEFAULT_SHARED_LAYOUT_TARGETS,
  extendSharedLayout,
  type SharedLayoutTargets
} from './sharedLayout';
import {
  expandGtOreSpecialData
} from './specialOreAliases';
import { repairSpecialServiceIcons } from './specialServiceIcons';
import { parseBrowserNeiSpecial, type BrowserNeiSpecialData } from './special';

function values(name: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) result.push(process.argv[index + 1]!);
  }
  return result;
}

function value(name: string): string | undefined {
  return values(name)[0];
}

function target(name: keyof SharedLayoutTargets): number {
  const raw = value(`target-${name}`);
  if (!raw) return DEFAULT_SHARED_LAYOUT_TARGETS[name];
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1024) throw new Error(`Invalid --target-${name}`);
  return parsed;
}

const dataPaths = values('data');
if (dataPaths.length === 0) {
  console.error(`Usage: npm run shared-layout -- --data <data.bin> [--data <data.bin> ...]
  [--special-data <browser-nei-special.json>] [--output <layout.json>]
  [--existing-layout <published-layout.json>]
  [--target-recipes <bytes>] [--target-goods <bytes>] [--target-special <bytes>]
  [--target-goods-metadata <bytes>] [--target-ore-dictionaries <bytes>]`);
  process.exit(2);
}

const specialPaths = values('special-data');
const repositories = [];
const specialData: (BrowserNeiSpecialData | undefined)[] = [];
for (let index = 0; index < dataPaths.length; index++) {
  const repository = decodeFormat5(await readFile(dataPaths[index]!));
  repositories.push(repository);
  const specialPath = specialPaths[index];
  if (!specialPath) {
    specialData.push(undefined);
    continue;
  }
  let parsed = parseBrowserNeiSpecial(await readFile(specialPath));
  parsed = repairSpecialServiceIcons(parsed, repository);
  specialData.push(expandGtOreSpecialData(parsed, repository));
}

const existingLayout = value('existing-layout');
const layout = existingLayout
  ? extendSharedLayout(
    JSON.parse(await readFile(resolve(existingLayout), 'utf8')),
    repositories,
    specialData
  )
  : buildSharedLayout(repositories, specialData, {
    recipes: target('recipes'),
    goods: target('goods'),
    goodsMetadata: target('goodsMetadata'),
    special: target('special'),
    oreDictionaries: target('oreDictionaries')
  });
const output = value('output');
const text = `${JSON.stringify(layout, null, 2)}\n`;
if (output) {
  const outputPath = resolve(output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, text, { flag: 'wx' });
}
console.log(text);
