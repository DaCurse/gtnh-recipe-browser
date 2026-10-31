import { untrack } from 'svelte';
import type { DatasetRepository } from './dataset';
import { matchesRecipeConstraints, type RecipeConstraints } from './recipeFinder';
import type { Recipe } from './types';

export class RecipeFinderState {
  recipes = $state.raw<Recipe[]>([]);
  loading = $state(false);
  error = $state('');
  loaded = $state(0);
  total = $state(0);
  page = $state(0);
  machine = $state('');
  private revision = $state(0);
  private cached?: { repository: DatasetRepository; constraints: RecipeConstraints; recipes: Recipe[] };

  constructor(context: { repository: () => DatasetRepository; constraints: () => RecipeConstraints; enabled?: () => boolean }) {
    $effect(() => {
      const repository = context.repository();
      const constraints = context.constraints();
      const enabled = context.enabled?.() ?? true;
      void this.revision;
      const controller = new AbortController();
      untrack(() => {
        this.recipes = [];
        this.page = 0;
        this.machine = '';
        this.error = '';
        this.loaded = this.total = 0;
        this.loading = enabled && constraints.inputs.length + constraints.outputs.length > 0;
        if (!this.loading) return;
        const cached = this.cached;
        if (cached?.repository === repository
          && cached.constraints.inputs.every((id) => constraints.inputs.includes(id))
          && cached.constraints.outputs.every((id) => constraints.outputs.includes(id))) {
          this.recipes = cached.recipes.filter((recipe) => matchesRecipeConstraints(recipe, constraints));
          this.loading = false;
          return;
        }
        void repository.findRecipes(constraints, (progress) => {
          if (controller.signal.aborted) return;
          this.loaded = progress.loadedShards;
          this.total = progress.totalShards;
          if (progress.batch.length) this.recipes = [...this.recipes, ...progress.batch].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
          );
        }, controller.signal).then((recipes) => {
          if (controller.signal.aborted) return;
          this.cached = { repository, constraints, recipes };
          this.recipes = recipes;
          this.loading = false;
        }).catch((error: unknown) => {
          if (controller.signal.aborted) return;
          this.error = error instanceof Error ? error.message : String(error);
          this.loading = false;
        });
      });
      return () => controller.abort();
    });
  }

  retry() { this.revision += 1; }
}
