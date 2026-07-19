import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFormat5, PackDecodeError } from '../tools/pack-builder/decoder';

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
});
