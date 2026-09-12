import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import {
  assertSharedLayoutExtension,
  buildSharedLayout,
  extendSharedLayout,
  groupSharedRecords,
  sharedLogicalId,
  sharedPartitionPrefix,
  sharedRepository,
  sharedPrefixLayout,
  type SharedRecord
} from '../tools/pack-builder/sharedLayout';
import type { DecodedRepository, DecodedRecipe, DecodedRecipeType } from '../tools/pack-builder/model';

function recipe(id: string): DecodedRecipe {
  return {
    id,
    searchMask: [],
    recipeTypeId: 'recipeType:0:fixture:Test',
    inputs: [],
    outputs: [],
    gt: null
  };
}

const type: DecodedRecipeType = {
  id: 'recipeType:0:fixture:Test',
  order: 0,
  name: 'Test',
  category: 'fixture',
  dimensions: {
    itemInputs: { columns: 1, rows: 1 },
    fluidInputs: { columns: 1, rows: 1 },
    itemOutputs: { columns: 1, rows: 1 },
    fluidOutputs: { columns: 1, rows: 1 }
  },
  shapeless: false,
  singleblocks: [],
  multiblocks: [],
  defaultCrafter: null
};

function repository(recipes: DecodedRecipe[]): DecodedRepository {
  return {
    formatVersion: 5,
    items: [],
    fluids: [],
    oreDictionaries: [],
    ingredientGroups: [],
    recipeTypes: [type],
    recipes,
    serviceItemIds: [],
    obsoleteRecipeRemaps: {}
  };
}

function record(id: string, value: unknown): SharedRecord {
  return { id, namespace: 'fixture', value };
}

function blobHash(records: readonly SharedRecord[], prefix: string): string {
  const bytes = gzipSync(encode({
    schemaVersion: 5,
    kind: 'records',
    logicalId: sharedLogicalId('fixture', 'fixture', prefix),
    records: records.slice().sort((left, right) => left.id.localeCompare(right.id)).map((entry) => entry.value)
  }), { level: 9 });
  return createHash('sha256').update(bytes).digest('hex');
}

describe('shared format partition layout', () => {
  it('keeps unrelated prefix blobs stable across insertion, deletion, modification, and reorder', () => {
    const prefixes = Array.from({ length: 16 }, (_, index) => index.toString(16));
    const original = [record('a', { value: 'a' }), record('b', { value: 'b' }), record('c', { value: 'c' })];
    const reordered = [original[2]!, original[0]!, original[1]!];
    const inserted = [...original, record('inserted', { value: 'new' })];
    const modified = original.map((entry) => entry.id === 'b'
      ? record(entry.id, { value: 'changed' })
      : entry);
    const removed = original.filter((entry) => entry.id !== 'b');
    const hashByPrefix = (values: readonly SharedRecord[]) => new Map(
      [...groupSharedRecords(values, prefixes)].map(([prefix, bucket]) => [prefix, blobHash(bucket, prefix)])
    );
    const prefixOf = (id: string) => sharedPartitionPrefix('fixture', id, 1);
    const before = hashByPrefix(original);
    const afterReorder = hashByPrefix(reordered);
    expect(afterReorder).toEqual(before);
    const modifiedPrefix = prefixOf('b');
    for (const [prefix, hash] of before) {
      if (prefix !== modifiedPrefix) expect(hashByPrefix(modified).get(prefix)).toBe(hash);
    }
    expect(hashByPrefix(modified).get(modifiedPrefix)).not.toBe(before.get(modifiedPrefix));

    const removedPrefix = prefixOf('b');
    for (const [prefix, hash] of before) {
      if (prefix !== removedPrefix) expect(hashByPrefix(removed).get(prefix)).toBe(hash);
    }
    if (original.filter((entry) => prefixOf(entry.id) === removedPrefix).length === 1) {
      expect(hashByPrefix(removed).has(removedPrefix)).toBe(false);
    } else {
      expect(hashByPrefix(removed).get(removedPrefix)).not.toBe(before.get(removedPrefix));
    }

    const insertedPrefix = prefixOf('inserted');
    for (const [prefix, hash] of before) {
      if (prefix !== insertedPrefix) expect(hashByPrefix(inserted).get(prefix)).toBe(hash);
    }
    if (before.has(insertedPrefix)) {
      expect(hashByPrefix(inserted).get(insertedPrefix)).not.toBe(before.get(insertedPrefix));
    } else {
      expect(hashByPrefix(inserted).has(insertedPrefix)).toBe(true);
    }
  });

  it('normalizes ordering while making recipe type IDs independent of presentation order', () => {
    const normalized = sharedRepository(repository([recipe('r-1')])) as DecodedRepository;
    expect(normalized.recipeTypes[0]?.id).toBe('recipeType:fixture:Test');
    expect(normalized.recipes[0]?.recipeTypeId).toBe('recipeType:fixture:Test');
  });

  it('extends a published layout without deleting old leaves or icon assignments', () => {
    const first = repository([recipe('r-1')]);
    const second = repository([recipe('r-1'), recipe('r-2')]);
    const initial = buildSharedLayout([first], [undefined], {
      recipes: 1024,
      goods: 1024,
      goodsMetadata: 1024,
      special: 1024,
      oreDictionaries: 1024
    });
    const extended = extendSharedLayout(initial, [second], [undefined]);
    for (const prefix of initial.recipeTypes['recipeType:fixture:Test'] ?? []) {
      expect(extended.recipeTypes['recipeType:fixture:Test']).toContain(prefix);
    }
    expect(extended.iconOwners.slice(0, initial.iconOwners.length)).toEqual(initial.iconOwners);
  });

  it('keeps an oversized singleton explicit instead of inventing unstable partitions', () => {
    const huge = recipe('huge');
    huge.searchMask = Array.from({ length: 10_000 }, (_, index) => index);
    const layout = buildSharedLayout([repository([huge])], [undefined], {
      recipes: 1024,
      goods: 1024,
      goodsMetadata: 1024,
      special: 1024,
      oreDictionaries: 1024
    });
    const typeId = 'recipeType:fixture:Test';
    expect(layout.recipeTypes[typeId]).toEqual(['']);
    expect(layout.oversizedSingletons).toEqual([
      expect.objectContaining({ namespace: typeId, prefix: '', estimatedBytes: expect.any(Number) })
    ]);
  });

  it('retains a published parent when a later dataset forces descendant splits', () => {
    const padded = (id: string, offset: number): DecodedRecipe => {
      const value = recipe(id);
      value.searchMask = Array.from({ length: 2_000 }, (_, index) =>
        (index * 2_654_435_761 + offset) >>> 0
      );
      return value;
    };
    const first = buildSharedLayout([repository([padded('r-1', 1)])], [undefined], {
      recipes: 1024,
      goods: 1024,
      goodsMetadata: 1024,
      special: 1024,
      oreDictionaries: 1024
    });
    expect(first.recipeTypes['recipeType:fixture:Test']).toEqual(['']);

    const extended = extendSharedLayout(
      first,
      [repository([padded('r-1', 1), padded('r-2', 2)])],
      [undefined]
    );
    const prefixes = extended.recipeTypes['recipeType:fixture:Test']!;
    expect(prefixes).toContain('');
    expect(prefixes.some((prefix) => prefix.length > 0)).toBe(true);
    expect(extended.oversizedSingletons).toEqual(expect.arrayContaining([
      expect.objectContaining({ namespace: 'recipeType:fixture:Test', prefix: '' })
    ]));

    const shrunk = extendSharedLayout(first, [repository([])], [undefined]);
    expect(shrunk.recipeTypes['recipeType:fixture:Test']).toEqual(first.recipeTypes['recipeType:fixture:Test']);
  });

  it('rejects published-prefix removal or target changes while allowing descendants', () => {
    const full = buildSharedLayout([repository([recipe('r-1')])], [undefined], {
      recipes: 1024,
      goods: 1024,
      goodsMetadata: 1024,
      special: 1024,
      oreDictionaries: 1024
    });
    const previous = sharedPrefixLayout(full);
    const extended = {
      ...previous,
      goods: [...previous.goods, 'a'],
      recipeTypes: {
        ...previous.recipeTypes,
        'recipeType:fixture:Test': [...previous.recipeTypes['recipeType:fixture:Test']!, 'a']
      }
    };
    expect(() => assertSharedLayoutExtension(previous, extended)).not.toThrow();
    expect(() => assertSharedLayoutExtension(extended, extended)).not.toThrow();
    expect(() => assertSharedLayoutExtension(
      previous,
      { ...extended, goods: extended.goods.slice(1) }
    )).toThrow(/removed goods prefix/);
    expect(() => assertSharedLayoutExtension(
      previous,
      { ...extended, targets: { ...extended.targets, goods: 2048 } }
    )).toThrow(/target goods changed/);
    expect(() => assertSharedLayoutExtension(
      {
        ...previous,
        goods: ['a', 'b']
      },
      {
        ...previous,
        goods: ['', 'a', 'b']
      }
    )).toThrow(/introduced goods ancestor root/);
    expect(() => assertSharedLayoutExtension(
      {
        ...previous,
        recipeTypes: { fixture: ['a', 'b'] }
      },
      {
        ...previous,
        recipeTypes: { fixture: ['', 'a', 'b'] }
      }
    )).toThrow(/introduced recipeTypes\.fixture ancestor root/);
  });
});
