import { describe, expect, it } from 'vitest';
import { fluidRecipeScope } from '../src/lib/fluidContainers';

const goods = new Map([
  ['f:creosote', {
    id: 'f:creosote',
    kind: 'fluid' as const,
    containerItemIds: ['i:creosote-cell', 'i:creosote-bucket']
  }],
  ['i:creosote-cell', {
    id: 'i:creosote-cell',
    kind: 'item' as const,
    container: { fluidId: 'f:creosote', amount: 1_000, emptyItemId: 'i:empty-cell' }
  }],
  ['i:creosote-bucket', {
    id: 'i:creosote-bucket',
    kind: 'item' as const,
    container: { fluidId: 'f:creosote', amount: 1_000, emptyItemId: 'i:bucket' }
  }],
  ['i:empty-cell', { id: 'i:empty-cell', kind: 'item' as const }],
  ['i:bucket', { id: 'i:bucket', kind: 'item' as const }],
  ['i:unrelated', { id: 'i:unrelated', kind: 'item' as const }]
]);

describe('ShadowTheAge-compatible fluid-container lookup', () => {
  it('unions the fluid and every filled container', () => {
    const scope = fluidRecipeScope('f:creosote', goods);
    expect([...scope!.memberIds]).toEqual([
      'f:creosote',
      'i:creosote-cell',
      'i:creosote-bucket'
    ]);
  });

  it('redirects a filled container to the same fluid scope and retains flow metadata', () => {
    const scope = fluidRecipeScope('i:creosote-cell', goods);
    expect(scope?.fluidId).toBe('f:creosote');
    expect(scope?.memberIds).toEqual(new Set([
      'f:creosote',
      'i:creosote-cell',
      'i:creosote-bucket'
    ]));
    expect(scope?.selectedContainer).toEqual({
      fluidId: 'f:creosote',
      amount: 1_000,
      emptyItemId: 'i:empty-cell'
    });
  });

  it('does not treat empty containers or ordinary items as fluid lookup targets', () => {
    expect(fluidRecipeScope('i:empty-cell', goods)).toBeNull();
    expect(fluidRecipeScope('i:unrelated', goods)).toBeNull();
  });
});
