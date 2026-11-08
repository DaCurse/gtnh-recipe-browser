import { getContext, setContext } from 'svelte';
import type { DatasetRepository } from './dataset';
import type { CatalogEntry } from './types';

type EntrySource = Pick<DatasetRepository, 'entryFor'>;
const sourceContext = Symbol('catalog-entry-source');

export function provideCatalogEntrySource(source: () => EntrySource | null): void {
  setContext(sourceContext, source);
}

/** One readiness policy for selected-item details and every floating tooltip. */
export function useCatalogEntry(id: () => string | undefined, delay = 0) {
  const getSource = getContext<(() => EntrySource | null) | undefined>(sourceContext);
  const source = $derived(getSource?.());
  const entryId = $derived(id());
  let result = $state.raw<{ id: string; source: EntrySource; entry?: CatalogEntry; error?: string }>();
  let attempt = $state(0);
  const active = $derived(Boolean(source && entryId && !entryId.startsWith('special:')));
  const current = $derived(result && result.id === entryId && result.source === source ? result : undefined);
  $effect(() => {
    void attempt;
    const repository = source;
    const requestedId = entryId;
    if (!repository || !requestedId || requestedId.startsWith('special:')) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const entry = await repository.entryFor(requestedId, controller.signal);
        if (!controller.signal.aborted) result = { id: requestedId, source: repository, entry: entry ? { ...entry } : undefined };
      } catch (error) {
        if (!controller.signal.aborted) result = { id: requestedId, source: repository,
          error: error instanceof Error ? error.message : String(error) };
      }
    };
    const timer = delay > 0 ? setTimeout(() => { void load(); }, delay) : undefined;
    if (timer === undefined) void load();
    return () => { clearTimeout(timer); controller.abort(); };
  });
  return {
    get entry() { return current?.entry; },
    get active() { return active; },
    get loading() { return active && !current; },
    get error() { return current?.error ?? ''; },
    retry() { result = undefined; attempt += 1; }
  };
}
