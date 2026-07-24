import { onMount, untrack } from 'svelte';
import { toRecipeSearchCatalogEntry, toRecipeSearchRecord } from './recipeSearch';
import type { DatasetRepository } from './dataset';
import type { CatalogEntry, Recipe, RecipeView } from './types';

interface RecipeBrowserContext {
  repository: () => DatasetRepository;
  selected: () => CatalogEntry;
  mode: () => RecipeView;
  active: () => boolean;
}

export class RecipeBrowserState {
  allRecipes = $state<Recipe[]>([]);
  recipeLoading = $state(false);
  recipeError = $state('');
  recipeLoadedShards = $state(0);
  recipeTotalShards = $state(0);
  recipePage = $state(0);
  recipeQuery = $state('');
  recipeFilter = $state('');
  type = $state('');
  readonly recipePageSize = 20;

  private loadedRecipeCounts = $state<Record<string, number>>({});
  private recipeDebouncePending = $state(false);
  private recipeWorkerPending = $state(false);
  private recipeSearchIds = $state<string[]>([]);
  private recipeSearchTotalValue = $state(0);
  private recipeSearchGeneration = $state(0);
  private recipeIndexRevision = $state(0);
  private recipeSearchReady = $state(false);
  private recipeSearchWorker: Worker | null = null;
  private recipeAbortController: AbortController | null = null;
  private recipeRequest = 0;
  private recipeSearchRequest = 0;

  constructor(private readonly context: RecipeBrowserContext) {
    $effect(() => {
      const selected = this.context.selected();
      const mode = this.context.mode();
      void selected.id;
      void mode;
      void this.type;
      void this.recipeFilter;
      this.recipePage = 0;
    });

    $effect(() => {
      const nextQuery = this.recipeQuery;
      this.recipeDebouncePending = nextQuery !== this.recipeFilter;
      const timeout = window.setTimeout(() => {
        this.recipeFilter = nextQuery;
        this.recipeDebouncePending = false;
      }, nextQuery ? 100 : 0);
      return () => window.clearTimeout(timeout);
    });

    $effect(() => {
      const generation = this.recipeSearchGeneration;
      void this.recipeIndexRevision;
      const query = this.recipeFilter;
      const recipeType = this.type;
      const page = this.recipePage;
      const active = this.context.active();
      if (!active || !this.recipeSearchReady || !this.recipeSearchWorker || !recipeType) {
        this.recipeWorkerPending = false;
        return;
      }
      const request = ++this.recipeSearchRequest;
      this.recipeWorkerPending = true;
      this.recipeSearchWorker.postMessage({
        type: 'search',
        generation,
        id: request,
        query,
        recipeType,
        offset: page * this.recipePageSize,
        limit: this.recipePageSize
      });
    });

    $effect(() => {
      const repository = this.context.repository();
      if (!this.recipeSearchReady) return;
      untrack(() => {
        this.loadedRecipeCounts = {};
        this.initializeRecipeSearch(repository.entries);
      });
    });

    $effect(() => {
      const repository = this.context.repository();
      const selected = this.context.selected();
      const mode = this.context.mode();
      const active = this.context.active();
      if (!active || !this.recipeSearchReady) {
        this.recipeAbortController?.abort();
        return;
      }
      void repository;
      void selected.id;
      void mode;
      untrack(() => void this.refresh());
    });

    onMount(() => this.mountWorker());
  }

  get related(): Recipe[] {
    return this.allRecipes;
  }

  get types(): string[] {
    return [...new Set(this.related.map((recipe) => recipe.type))];
  }

  get visibleRecipes(): Recipe[] {
    const recipeById = new Map(this.related.map((recipe) => [recipe.id, recipe]));
    return this.recipeSearchIds
      .map((id) => recipeById.get(id))
      .filter((recipe): recipe is Recipe => recipe !== undefined);
  }

  get recipeSearchTotal(): number {
    return this.recipeSearchTotalValue;
  }

  get recipePageCount(): number {
    return Math.max(1, Math.ceil(this.recipeSearchTotal / this.recipePageSize));
  }

  get recipeSearchPending(): boolean {
    return this.recipeDebouncePending || this.recipeWorkerPending;
  }

  get modeLabel(): string {
    const mode = this.context.mode();
    return mode === 'machineUsages' ? 'machine usages' : mode;
  }

  recipeCount(view: RecipeView): number | undefined {
    const selected = this.context.selected();
    const declared = view === 'recipes'
      ? selected.productionCount
      : view === 'usages'
        ? selected.usageCount
        : undefined;
    return this.loadedRecipeCounts[`${selected.id}:${view}`] ?? declared;
  }

  setPage(nextPage: number) {
    this.recipePage = Math.max(0, Math.min(nextPage, this.recipePageCount - 1));
    requestAnimationFrame(() => {
      document.querySelector('.recipe-search-block, .recipe-list')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      });
    });
  }

  async refresh() {
    const repository = this.context.repository();
    const selected = this.context.selected();
    const mode = this.context.mode();
    this.recipeAbortController?.abort();
    const controller = new AbortController();
    this.recipeAbortController = controller;
    const request = ++this.recipeRequest;
    const entryId = selected.id;
    const view = mode;
    this.allRecipes = [];
    this.type = '';
    this.recipeQuery = '';
    this.recipeFilter = '';
    this.recipePage = 0;
    this.resetRecipeSearch();
    this.recipeError = '';
    this.recipeLoading = true;
    this.recipeLoadedShards = 0;
    this.recipeTotalShards = 0;
    try {
      const loaded = await repository.recipesFor(entryId, view, ({
        loadedShards,
        totalShards,
        batch
      }) => {
        if (request !== this.recipeRequest) return;
        this.recipeLoadedShards = loadedShards;
        this.recipeTotalShards = totalShards;
        if (batch.length > 0) {
          const next = [...this.allRecipes, ...batch]
            .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
          this.allRecipes = next;
          this.appendRecipeSearch(batch);
          this.loadedRecipeCounts = {
            ...this.loadedRecipeCounts,
            [`${entryId}:${view}`]: next.length
          };
          if (!this.type) this.type = next[0]?.type ?? '';
        }
      }, controller.signal);
      if (request === this.recipeRequest) {
        this.allRecipes = loaded;
        this.loadedRecipeCounts = {
          ...this.loadedRecipeCounts,
          [`${entryId}:${view}`]: loaded.length
        };
        if (!this.type) this.type = loaded[0]?.type ?? '';
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Unable to load recipes', error);
      if (request === this.recipeRequest) {
        this.allRecipes = [];
        this.resetRecipeSearch();
        this.recipeError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === this.recipeRequest) this.recipeLoading = false;
    }
  }

  private initializeRecipeSearch(catalog: CatalogEntry[]) {
    this.recipeSearchGeneration += 1;
    this.recipeIndexRevision += 1;
    this.recipeSearchIds = [];
    this.recipeSearchTotalValue = 0;
    this.recipeWorkerPending = false;
    this.recipeSearchWorker?.postMessage({
      type: 'init',
      generation: this.recipeSearchGeneration,
      catalog: catalog.map(toRecipeSearchCatalogEntry)
    });
  }

  private resetRecipeSearch() {
    this.recipeSearchGeneration += 1;
    this.recipeIndexRevision += 1;
    this.recipeSearchIds = [];
    this.recipeSearchTotalValue = 0;
    this.recipeWorkerPending = false;
    this.recipeSearchWorker?.postMessage({
      type: 'reset',
      generation: this.recipeSearchGeneration
    });
  }

  private appendRecipeSearch(batch: Recipe[]) {
    if (batch.length === 0) return;
    this.recipeSearchWorker?.postMessage({
      type: 'append',
      generation: this.recipeSearchGeneration,
      recipes: batch.map(toRecipeSearchRecord)
    });
    this.recipeIndexRevision += 1;
  }

  private mountWorker(): () => void {
    const worker = new Worker(
      new URL('../workers/recipeSearch.worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.recipeSearchWorker = worker;
    worker.onmessage = (event: MessageEvent<{
      type: 'results';
      generation: number;
      id: number;
      total: number;
      ids: string[];
    }>) => {
      if (
        event.data.type !== 'results'
        || event.data.generation !== this.recipeSearchGeneration
        || event.data.id !== this.recipeSearchRequest
      ) return;
      this.recipeSearchIds = event.data.ids;
      this.recipeSearchTotalValue = event.data.total;
      this.recipeWorkerPending = false;
    };
    worker.onerror = (event) => {
      console.error('Recipe search worker failed', event);
      this.recipeSearchReady = false;
      this.recipeWorkerPending = false;
      this.recipeError = 'Recipe filtering could not start. Reload the page to retry.';
    };
    this.recipeSearchReady = true;
    return () => {
      worker.terminate();
      this.recipeSearchWorker = null;
      this.recipeSearchReady = false;
      this.recipeAbortController?.abort();
      this.recipeAbortController = null;
    };
  }
}
