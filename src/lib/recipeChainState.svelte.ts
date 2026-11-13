import { untrack } from 'svelte';
import { trackEvent } from './analytics';
import type { DatasetRepository } from './dataset';
import type { RecipeConstraints } from './recipeFinder';
import type { ChainPath } from './recipeChain';
import type { Recipe } from './types';

export class RecipeChainState {
  ready = $state(false);
  loading = $state(true);
  stage = $state('Loading recipe graph…');
  error = $state('');
  paths = $state.raw<Array<ChainPath & { recipes: Recipe[]; routes: Array<Recipe[] | null> }>>([]);
  allowExtras = $state(true);
  maxDepth = $state(12);
  visited = $state(0);
  routeLoading = $state(false);
  expanding = $state(false);
  routeLimit = $state(10);
  private completedLimit = 10;
  private searchRevision = $state(0);
  private searchKey = '';
  private requestedMore = false;
  private searchStarted = 0;
  private worker?: Worker;
  private request = 0;
  private resolveController?: AbortController;
  private revision = $state(0);

  constructor(context: {
    repository: () => DatasetRepository;
    constraints: () => RecipeConstraints;
    ingredientName?: (id: string) => string;
  }) {
    $effect(() => {
      const repository = context.repository();
      void this.revision;
      const controller = new AbortController();
      const worker = new Worker(new URL('../workers/recipeChain.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;
      untrack(() => {
        this.ready = false;
        this.loading = true;
        this.error = '';
        this.paths = [];
        this.stage = 'Loading recipe graph…';
      });
      worker.onerror = () => {
        if (controller.signal.aborted) return;
        this.error = 'The recipe chain worker could not run. Try again.';
        this.loading = false;
        this.expanding = false;
        this.routeLimit = this.completedLimit;
      };
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (controller.signal.aborted) return;
        if (message.type === 'ready') {
          this.ready = true;
          return;
        }
        if (message.id !== undefined && message.id !== this.request) return;
        if (message.type === 'error') {
          this.error = message.message;
          this.loading = false;
          this.expanding = false;
          this.routeLimit = this.completedLimit;
          return;
        }
        if (message.type === 'progress') {
          this.visited = message.visited;
          return;
        }
        if (message.type !== 'results') return;
        const id = this.request;
        const resolveController = new AbortController();
        this.resolveController = resolveController;
        this.stage = 'Loading route recipes…';
        const previous = this.expanding ? this.paths : [];
        void Promise.all(
          (message.paths as ChainPath[]).map(async (path) => {
            const old = previous.find((candidate) => candidate.targetId === path.targetId);
            const references = [
              ...(old?.status === 'found' ? [old.steps, ...(old.alternatives ?? [])] : []),
              ...(path.status === 'found' ? [path.steps, ...(path.alternatives ?? [])] : []),
            ];
            const unique = [
              ...new Map(references.map((route) => [JSON.stringify(route), route])).values(),
            ];
            const oldReferences = old ? [old.steps, ...(old.alternatives ?? [])] : [];
            const cache = new Map(
              oldReferences.map((route, index) => [JSON.stringify(route), old!.routes[index]]),
            );
            const first = unique[0] ?? [];
            const recipes =
              cache.get(JSON.stringify(first)) ??
              (await repository.chainRecipes(first, resolveController.signal));
            return {
              ...path,
              status: unique.length ? ('found' as const) : path.status,
              steps: first,
              alternatives: unique.slice(1),
              limited: path.limited || old?.limited,
              recipes,
              routes: [
                recipes,
                ...unique.slice(1).map((route) => cache.get(JSON.stringify(route)) ?? null),
              ],
            };
          }),
        )
          .then((paths) => {
            if (
              controller.signal.aborted ||
              resolveController.signal.aborted ||
              id !== this.request
            )
              return;
            trackEvent('chain_search_completed', {
              dataset_version: repository.gtnhVersion,
              target_count: paths.length,
              input_names: context
                .constraints()
                .inputs.map((id) => context.ingredientName?.(id) ?? 'Unknown ingredient')
                .join(' + ')
                .slice(0, 500),
              output_names: context
                .constraints()
                .outputs.map((id) => context.ingredientName?.(id) ?? 'Unknown ingredient')
                .join(' + ')
                .slice(0, 500),
              route_count: paths.reduce(
                (count, path) => count + (path.status === 'found' ? path.routes.length : 0),
                0,
              ),
              limited: paths.some(
                (path) =>
                  path.limited || path.status === 'search-limit' || path.status === 'proof-limit',
              ),
              max_depth: this.maxDepth,
              allow_extras: this.allowExtras,
              expanded: this.expanding,
              duration_ms: Math.round(performance.now() - this.searchStarted),
            });
            this.paths = paths;
            this.completedLimit = this.routeLimit;
            this.loading = false;
            this.expanding = false;
          })
          .catch((error: unknown) => {
            if (
              controller.signal.aborted ||
              resolveController.signal.aborted ||
              id !== this.request
            )
              return;
            this.error = error instanceof Error ? error.message : String(error);
            this.loading = false;
            this.expanding = false;
          });
      };
      void repository
        .chainIndex(controller.signal)
        .then(({ bytes, manifestSha256 }) => {
          if (controller.signal.aborted) return;
          this.stage = 'Preparing recipe graph…';
          worker.postMessage(
            { type: 'init', datasetId: repository.datasetId, manifestSha256, bytes: bytes.buffer },
            [bytes.buffer],
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          this.error = error instanceof Error ? error.message : String(error);
          this.loading = false;
          this.expanding = false;
        });
      return () => {
        controller.abort();
        this.resolveController?.abort();
        worker.terminate();
        this.request++;
      };
    });
    $effect(() => {
      if (!this.ready) return;
      const constraints = context.constraints();
      const maxDepth = this.maxDepth,
        allowExtras = this.allowExtras;
      void this.searchRevision;
      untrack(() => {
        const key = JSON.stringify([
          context.repository().datasetId,
          [...constraints.inputs],
          [...constraints.outputs],
          maxDepth,
          allowExtras,
        ]);
        const keepResults = this.requestedMore && key === this.searchKey && this.paths.length > 0;
        if (key !== this.searchKey) {
          this.routeLimit = 10;
          this.completedLimit = 10;
        }
        this.searchKey = key;
        this.requestedMore = false;
        this.expanding = keepResults;
        this.resolveController?.abort();
        this.request++;
        this.searchStarted = performance.now();
        if (!keepResults) this.paths = [];
        this.error = '';
        this.loading = true;
        this.routeLoading = false;
        this.visited = 0;
        this.stage = keepResults ? 'Searching more routes…' : 'Searching recipe chains…';
        try {
          this.worker?.postMessage({
            type: 'search',
            id: this.request,
            inputs: [...constraints.inputs],
            outputs: [...constraints.outputs],
            maxDepth,
            allowExtras,
            routeLimit: this.routeLimit,
          });
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
          this.loading = false;
        }
      });
      return () => {
        this.worker?.postMessage({ type: 'cancel' });
        this.resolveController?.abort();
      };
    });
  }
  searchMore() {
    if (this.loading || this.completedLimit >= 50) return;
    this.routeLimit = this.completedLimit < 25 ? 25 : 50;
    trackEvent('chain_more_requested', { requested_routes: this.routeLimit });
    this.requestedMore = true;
    this.searchRevision += 1;
  }
  cancelMore() {
    if (!this.expanding) return;
    trackEvent('chain_more_stopped', {
      duration_ms: Math.round(performance.now() - this.searchStarted),
    });
    this.request++;
    this.worker?.postMessage({ type: 'cancel' });
    this.resolveController?.abort();
    this.resolveController = new AbortController();
    this.loading = false;
    this.expanding = false;
    this.routeLoading = false;
    this.routeLimit = this.completedLimit;
  }
  async loadRoute(
    repository: DatasetRepository,
    targetId: string,
    index: number,
  ): Promise<boolean> {
    const path = this.paths.find((path) => path.targetId === targetId);
    if (!path) return false;
    if (path.routes[index]) {
      trackEvent('chain_route_viewed', { route_number: index + 1, cached: true });
      return true;
    }
    const references = [path.steps, ...(path.alternatives ?? [])][index];
    if (!references) return false;
    const request = this.request,
      controller = this.resolveController;
    this.routeLoading = true;
    try {
      const recipes = await repository.chainRecipes(references, controller?.signal);
      if (request !== this.request || controller?.signal.aborted) return false;
      this.paths = this.paths.map((current) =>
        current !== path
          ? current
          : {
              ...current,
              routes: current.routes.map((route, routeIndex) =>
                routeIndex === index ? recipes : route,
              ),
            },
      );
      trackEvent('chain_route_viewed', { route_number: index + 1, cached: false });
      return true;
    } catch (error) {
      if (request === this.request && !controller?.signal.aborted)
        this.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      if (request === this.request) this.routeLoading = false;
    }
  }
  retry() {
    this.revision += 1;
  }
}
