import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalogSearchDocument } from '../src/lib/search/catalogSearch';

// Exercise the worker protocol: sorting must happen before slicing result pages.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe('catalogue search ordering', () => {
  it('uses the selected browse order for filtered pages and invalidates cached matches when changed', async () => {
    const scope = {
      postMessage: vi.fn(),
      onmessage: undefined as undefined | ((event: MessageEvent) => void),
    };
    vi.stubGlobal('self', scope);
    await import('../src/workers/search.worker');
    const send = (data: unknown) => scope.onmessage!({ data } as MessageEvent);
    const documents = [1, 2, 3].map((index) =>
      buildCatalogSearchDocument({
        id: `i:test:item:${index}`,
        name: `Matching ${index}`,
        mod: 'test',
        kind: 'item',
        numericId: index,
        members: [{ id: `i:test:item:${index}`, name: `Matching ${index}`, mod: 'test' }],
      }),
    );
    send({ type: 'init', generation: 1 });
    send({ type: 'appendDocuments', generation: 1, documents, completed: 3, total: 3 });
    send({ type: 'finish', generation: 1 });
    send({ type: 'order', generation: 1, ids: documents.map((d) => d.id).reverse() });
    send({ type: 'search', generation: 1, id: 1, query: 'matching', offset: 0, limit: 2 });
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ids: ['i:test:item:3', 'i:test:item:2'], total: 3 }),
    );
    send({ type: 'search', generation: 1, id: 2, query: 'matching', offset: 2, limit: 2 });
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ids: ['i:test:item:1'] }),
    );
    send({ type: 'order', generation: 1, ids: documents.map((d) => d.id) });
    send({ type: 'search', generation: 1, id: 3, query: 'matching', offset: 0, limit: 2 });
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ids: ['i:test:item:1', 'i:test:item:2'] }),
    );
    send({ type: 'order', generation: 0, ids: documents.map((d) => d.id).reverse() });
    send({ type: 'search', generation: 1, id: 4, query: 'matching', offset: 0, limit: 1 });
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ids: ['i:test:item:1'] }),
    );
  });
});
