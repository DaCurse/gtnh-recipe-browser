import { describe, expect, it } from 'vitest';
import { createSpecialContextEntry } from '../src/lib/specialContext';
import type { CatalogEntry } from '../src/lib/types';

const source: CatalogEntry = {
  id: 'i:test:source:0',
  name: 'Tiberium Ore',
  mod: 'Test',
  kind: 'item',
  tooltip: [],
  color: '#9a6',
  glyph: 'T'
};

describe('global special context item', () => {
  it('makes the active special category visible as a faux catalog item', () => {
    const entry = createSpecialContextEntry(
      source,
      { id: 'meteor-ritual', label: 'Meteor Rituals', serviceIconId: 'service:meteor' },
      { label: 'Meteor Rituals', goodsId: 'i:test:meteor:0' }
    );

    expect(entry).toMatchObject({
      id: 'special:meteor-ritual',
      name: 'All Meteor Rituals',
      mod: 'NEI Special Data',
      kind: 'item',
      tooltipLayout: 'compact'
    });
    expect(entry.tooltip[0]).toContain('all meteor rituals');
  });
});
