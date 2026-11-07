import { describe, expect, it, vi } from 'vitest';
import { DatasetRepository } from '../src/lib/dataset';
import type { CatalogEntry } from '../src/lib/types';

const entry = (id: string, kind: CatalogEntry['kind']): CatalogEntry => ({
  id, kind, name: id, mod: 'fixture', tooltip: [], color: '#fff', glyph: 'x'
});
function partition(kind: 'groups' | 'details') {
  const ids = Array.from({ length: 32 }, (_, index) => `${kind}-${index}`);
  const entries = new Map(ids.map((id) => [id, entry(id, kind === 'groups' ? 'oreDict' : 'item')]));
  entries.set('member', entry('member', 'item'));
  const records = ids.map((id, index) => ({ id, numericId: index, itemIds: ['member'] }));
  let release!: () => void;
  const gate = new Promise<typeof records>((resolve) => { release = () => resolve(records); });
  const repository: DatasetRepository = Object.create(DatasetRepository.prototype);
  Object.assign(repository, {
    manifest: { formatVersion: 7, goodsDetailShards: [{ id: 'details', prefix: '' }], ingredientGroupShards: [{ id: 'groups', prefix: '' }] },
    entriesById: entries,
    goodsIds: new Set(kind === 'details' ? ids : ['member']),
    goodsDetails: new Map(),
    additionalMachineCapabilities: new Map(),
    ingredientGroups: new Map(kind === 'groups' ? ids.map((id) => [id, { id, itemIds: [] }]) : []),
    hydratedGroups: new Set(),
    detailShard: vi.fn(() => gate), groupShard: vi.fn(() => gate)
  });
  return { repository, ids, entries, release };
}

describe('concurrent partition hydration', () => {
  for (const kind of ['groups', 'details'] as const) {
    it(`applies a ${kind} partition once when many lookups wait on the same load`, async () => {
      const fixture = partition(kind);
      const writes = vi.spyOn(fixture.entries, 'set');
      const cancelled = new AbortController();
      const abandoned = fixture.repository.entryFor(fixture.ids[0]!, cancelled.signal);
      const rejected = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
      const lookups = fixture.ids.map((id) => fixture.repository.entryFor(id));
      cancelled.abort();
      await rejected;
      fixture.release();
      const loaded = await Promise.all(lookups);
      expect(writes).toHaveBeenCalledTimes(fixture.ids.length);
      expect(loaded.map((value) => value?.id)).toEqual(fixture.ids);
      for (let i = 0; i < loaded.length; i++) {
        if (kind === 'groups') expect(loaded[i]?.members).toEqual(['member']);
        else expect(loaded[i]?.numericId).toBe(i);
      }
      await fixture.repository.entryFor(fixture.ids[0]!);
      expect(writes).toHaveBeenCalledTimes(fixture.ids.length);
    });
  }
});
