#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { decodeFormat5 } from '../pack-builder/decoder';

const [leftData, leftAtlas, rightData, rightAtlas] = process.argv.slice(2);
if (!leftData || !leftAtlas || !rightData || !rightAtlas) {
  throw new Error('Usage: tsx tools/pack-analysis/compare-icon-pixels.ts <left-data> <left-atlas> <right-data> <right-atlas>');
}
const load = async (dataPath: string, atlasPath: string) => {
  const repository = decodeFormat5(await readFile(dataPath));
  const atlas = await sharp(await readFile(atlasPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const owners = new Map<string, number>();
  for (const entry of [...repository.items, ...repository.fluids]) owners.set(entry.id, entry.iconId);
  for (const type of repository.recipeTypes) {
    for (const crafter of [...type.singleblocks, ...type.multiblocks, ...(type.defaultCrafter ? [type.defaultCrafter] : [])]) {
      if (!owners.has(crafter.id)) owners.set(crafter.id, crafter.iconId);
    }
  }
  return { ...atlas, owners };
};
const extract = (atlas: Awaited<ReturnType<typeof load>>, iconId: number) => {
  const result = Buffer.alloc(32 * 32 * 4);
  const x = iconId % 256 * 32;
  const y = Math.floor(iconId / 256) * 32;
  for (let row = 0; row < 32; row++) {
    const start = ((y + row) * atlas.info.width + x) * 4;
    atlas.data.copy(result, row * 128, start, start + 128);
  }
  for (let i = 0; i < result.length; i += 4) if (result[i + 3] === 0) result.fill(0, i, i + 3);
  return result;
};
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const quantiles = (values: number[]) => {
  values.sort((a, b) => a - b);
  const at = (fraction: number) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
  return { min: at(0), p25: at(.25), median: at(.5), p75: at(.75), p90: at(.9), p95: at(.95), p99: at(.99), max: at(1) };
};
const left = await load(leftData, leftAtlas);
const right = await load(rightData, rightAtlas);
const common = [...right.owners].filter(([id]) => left.owners.has(id));
let exact = 0;
const quantizedExact = new Map([1, 2, 3, 4].map((bits) => [bits, 0]));
const mae: number[] = [];
const changedChannels: number[] = [];
const thresholds = new Map([.1, .25, .5, 1, 2, 4, 8, 16].map((value) => [value, 0]));
const alphaMae: number[] = [];
const maximumDifference: number[] = [];
const leftHashes = new Set<string>();
const rightHashes = new Set<string>();
for (const [id, rightIcon] of common) {
  const a = extract(left, left.owners.get(id)!);
  const b = extract(right, rightIcon);
  const ah = digest(a);
  const bh = digest(b);
  leftHashes.add(ah);
  rightHashes.add(bh);
  if (ah === bh) exact++;
  for (const bits of quantizedExact.keys()) {
    const mask = 255 << bits & 255;
    const qa = Buffer.from(a);
    const qb = Buffer.from(b);
    for (let index = 0; index < qa.length; index++) {
      qa[index] = qa[index]! & mask;
      qb[index] = qb[index]! & mask;
    }
    if (qa.equals(qb)) quantizedExact.set(bits, quantizedExact.get(bits)! + 1);
  }
  let difference = 0;
  let changed = 0;
  let alphaDifference = 0;
  let maximum = 0;
  for (let index = 0; index < a.length; index++) {
    const channelDifference = Math.abs(a[index]! - b[index]!);
    difference += channelDifference;
    maximum = Math.max(maximum, channelDifference);
    if (a[index] !== b[index]) changed++;
    if (index % 4 === 3) alphaDifference += Math.abs(a[index]! - b[index]!);
  }
  const mean = difference / a.length;
  mae.push(mean);
  for (const threshold of thresholds.keys()) if (mean <= threshold) thresholds.set(threshold, thresholds.get(threshold)! + 1);
  alphaMae.push(alphaDifference / 1024);
  maximumDifference.push(maximum);
  changedChannels.push(changed / a.length);
}
console.log(JSON.stringify({
  commonOwners: common.length,
  exactOwners: exact,
  exactPercent: exact / common.length * 100,
  exactAfterClearingLowBits: Object.fromEntries([...quantizedExact].map(([bits, count]) => [bits, {
    count, percent: count / common.length * 100
  }])),
  ownerMeanAbsoluteChannelDifference: quantiles(mae),
  ownersWithinMae: Object.fromEntries([...thresholds].map(([threshold, count]) => [threshold, { count, percent: count / common.length * 100 }])),
  ownerAlphaMeanAbsoluteDifference: quantiles(alphaMae),
  ownerMaximumChannelDifference: quantiles(maximumDifference),
  ownerChangedChannelFraction: quantiles(changedChannels),
  uniqueLeftSprites: leftHashes.size,
  uniqueRightSprites: rightHashes.size,
  uniqueSpriteHashesSharedIgnoringOwner: [...leftHashes].filter((hash) => rightHashes.has(hash)).length
}, null, 2));
