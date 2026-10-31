import { untrack } from 'svelte';
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
  private worker?: Worker;
  private request = 0;
  private resolveController?: AbortController;
  private revision = $state(0);

  constructor(context: { repository: () => DatasetRepository; constraints: () => RecipeConstraints }) {
    $effect(() => {
      const repository = context.repository(); void this.revision;
      const controller = new AbortController();
      const worker = new Worker(new URL('../workers/recipeChain.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      untrack(() => { this.ready = false; this.loading = true; this.error = ''; this.paths = []; this.stage = 'Loading recipe graph…'; });
      worker.onerror = () => { this.error = 'The recipe chain worker could not run. Try again.'; this.loading = false; };
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (controller.signal.aborted) return;
        if (message.type === 'ready') { this.ready = true; return; }
        if (message.id !== undefined && message.id !== this.request) return;
        if (message.type === 'error') { this.error = message.message; this.loading = false; return; }
        if (message.type === 'progress') { this.visited = message.visited; return; }
        if (message.type !== 'results') return;
        const id = this.request;
        const resolveController = new AbortController(); this.resolveController = resolveController;
        this.stage = 'Loading route recipes…';
        void Promise.all((message.paths as ChainPath[]).map(async (path) => {
          const recipes = await repository.chainRecipes(path.steps, resolveController.signal);
          return { ...path, recipes, routes: [recipes, ...(path.alternatives ?? []).map(() => null)] };
        })).then((paths) => {
          if (controller.signal.aborted || resolveController.signal.aborted || id !== this.request) return;
          this.paths = paths; this.loading = false;
        }).catch((error: unknown) => {
          if (controller.signal.aborted || resolveController.signal.aborted || id !== this.request) return;
          this.error = error instanceof Error ? error.message : String(error); this.loading = false;
        });
      };
      void repository.chainIndex(controller.signal).then(({ bytes, manifestSha256 }) => {
        if (controller.signal.aborted) return;
        this.stage = 'Preparing recipe graph…';
        worker.postMessage({ type: 'init', datasetId: repository.datasetId, manifestSha256, bytes: bytes.buffer }, [bytes.buffer]);
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        this.error = error instanceof Error ? error.message : String(error); this.loading = false;
      });
      return () => { controller.abort(); this.resolveController?.abort(); worker.terminate(); this.request++; };
    });
    $effect(() => {
      if (!this.ready) return;
      const constraints = context.constraints();
      const maxDepth = this.maxDepth, allowExtras = this.allowExtras;
      untrack(() => {
        this.resolveController?.abort(); this.request++;
        this.paths = []; this.error = ''; this.loading = true; this.routeLoading = false; this.visited = 0; this.stage = 'Searching recipe chains…';
        try {
          this.worker?.postMessage({ type: 'search', id: this.request, inputs: [...constraints.inputs], outputs: [...constraints.outputs], maxDepth, allowExtras });
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
          this.loading = false;
        }
      });
      return () => { this.worker?.postMessage({ type: 'cancel' }); this.resolveController?.abort(); };
    });
  }
  async loadRoute(repository: DatasetRepository, targetId: string, index: number): Promise<boolean> {
    const path = this.paths.find((path) => path.targetId === targetId);
    if (!path) return false;
    if (path.routes[index]) return true;
    const references = [path.steps, ...(path.alternatives ?? [])][index];
    if (!references) return false;
    const request = this.request, controller = this.resolveController;
    this.routeLoading = true;
    try {
      const recipes = await repository.chainRecipes(references, controller?.signal);
      if (request !== this.request || controller?.signal.aborted) return false;
      this.paths = this.paths.map((current) => current !== path ? current : {
        ...current, routes: current.routes.map((route, routeIndex) => routeIndex === index ? recipes : route)
      });
      return true;
    } catch (error) {
      if (request === this.request && !controller?.signal.aborted) this.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally { if (request === this.request) this.routeLoading = false; }
  }
  retry() { this.revision += 1; }
}
