import { onMount, untrack } from 'svelte';
import { toRecipeSearchCatalogEntry, toRecipeSearchRecord } from './recipeSearch';
import {
  specialLabel,
  specialRepository,
  specialSearchText,
  type SpecialLoadProgress,
  type SpecialRecord,
  type SpecialViewType
} from './specialData';
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
  recipeCatalogIndexed = $state(0);
  recipeCatalogTotal = $state(0);
  recipePage = $state(0);
  recipeQuery = $state('');
  recipeFilter = $state('');
  type = $state('');
  specialType = $state('');
  specialRecords = $state<SpecialRecord[]>([]);
  specialLoading = $state(false);
  specialError = $state('');
  specialLoadedShards = $state(0);
  specialTotalShards = $state(0);
  specialPage = $state(0);
  specialQuery = $state('');
  specialFilter = $state('');
  readonly recipePageSize = 20;
  readonly specialPageSize = 20;

  private loadedRecipeCounts = $state<Record<string, number>>({});
  private loadedSpecialCounts = $state<Record<string, number>>({});
  private recipeDebouncePending = $state(false);
  private recipeWorkerPending = $state(false);
  private recipeSearchIds = $state<string[]>([]);
  private recipeSearchTotalValue = $state(0);
  private recipeSearchGeneration = $state(0);
  private recipeIndexRevision = $state(0);
  private recipeSearchReady = $state(false);
  private recipeWorkerMounted = $state(false);
  private recipeSearchWorker: Worker | null = null;
  private recipeCatalogDatasetId = '';
  private recipeAbortController: AbortController | null = null;
  private recipeRequest = 0;
  private recipeSearchRequest = 0;
  private specialAbortController: AbortController | null = null;
  private specialRequest = 0;
  private specialCache = new Map<string, SpecialRecord[]>();

  constructor(private readonly context: RecipeBrowserContext) {
    $effect(() => {
      const selected = this.context.selected();
      const mode = this.context.mode();
      void selected.id;
      void mode;
      void this.type;
      void this.recipeFilter;
      void this.specialType;
      void this.specialFilter;
      this.recipePage = 0;
      this.specialPage = 0;
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
      const nextQuery = this.specialQuery;
      const timeout = window.setTimeout(() => {
        this.specialFilter = nextQuery;
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
      const active = this.context.active();
      if (!this.recipeWorkerMounted || !active) return;
      if (this.recipeSearchReady && this.recipeCatalogDatasetId === repository.datasetId) return;
      untrack(() => {
        this.loadedRecipeCounts = {};
        void this.initializeRecipeSearch(repository.entries);
      });
    });

    $effect(() => {
      const repository = this.context.repository();
      const selected = this.context.selected();
      const mode = this.context.mode();
      const active = this.context.active();
      if (!active || !this.recipeSearchReady) {
        this.recipeAbortController?.abort();
        this.specialAbortController?.abort();
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

  get specialTypes(): SpecialViewType[] {
    const repository = specialRepository(this.context.repository());
    const serviceIcons = new Map((repository.specialServiceIcons ?? []).map((icon) => [icon.id, icon]));
    return [...(repository.specialViewTypes ?? [])]
      .map((viewType) => ({
        ...viewType,
        iconId: viewType.iconId
          ?? (viewType.serviceIconId ? serviceIcons.get(viewType.serviceIconId)?.goodsId : undefined),
        glyph: viewType.glyph
          ?? serviceIcons.get(viewType.serviceIconId ?? '')?.label.slice(0, 1)
      }))
      .filter((viewType) => viewType.id.length > 0)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
  }

  get specialTypeLabel(): string {
    const selected = this.specialTypes.find((viewType) => viewType.id === this.specialType);
    return selected ? specialLabel(selected) : 'special data';
  }

  get visibleSpecialRecords(): SpecialRecord[] {
    const terms = this.specialFilter.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length === 0
      ? this.specialRecords
      : this.specialRecords.filter((record) => {
        const text = specialSearchText(record);
        return terms.every((term) => text.includes(term));
      });
    return filtered.slice(this.specialPage * this.specialPageSize, (this.specialPage + 1) * this.specialPageSize);
  }

  get specialSearchTotal(): number {
    const terms = this.specialFilter.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.specialRecords.length;
    return this.specialRecords.filter((record) => {
      const text = specialSearchText(record);
      return terms.every((term) => text.includes(term));
    }).length;
  }

  get specialPageCount(): number {
    return Math.max(1, Math.ceil(this.specialSearchTotal / this.specialPageSize));
  }

  get specialSearchPending(): boolean {
    return this.specialQuery !== this.specialFilter;
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

  get recipePreparing(): boolean {
    return this.context.active() && this.recipeWorkerMounted && !this.recipeSearchReady;
  }

  get modeLabel(): string {
    const mode = this.context.mode();
    return mode === 'machineUsages' ? 'machine usages' : mode;
  }

  get showingSpecial(): boolean {
    return this.specialType.length > 0 && this.specialTypes.some((viewType) => viewType.id === this.specialType);
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

  specialCount(view: RecipeView, viewType = this.specialType): number | undefined {
    if (!viewType) return undefined;
    const selected = this.context.selected();
    const declared = selected as CatalogEntry & {
      specialProductionCount?: number;
      specialUsageCount?: number;
    };
    const declaredCount = view === 'recipes'
      ? declared.specialProductionCount
      : view === 'usages'
        ? declared.specialUsageCount
        : undefined;
    return this.loadedSpecialCounts[`${selected.id}:${view}:${viewType}`] ?? declaredCount;
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

  setSpecialPage(nextPage: number) {
    this.specialPage = Math.max(0, Math.min(nextPage, this.specialPageCount - 1));
    requestAnimationFrame(() => {
      document.querySelector('.recipe-search-block, .recipe-list')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      });
    });
  }

  selectRecipeType(type: string) {
    this.specialType = '';
    this.type = type;
    this.recipePage = 0;
    this.specialPage = 0;
    this.specialQuery = '';
    this.specialFilter = '';
  }

  selectSpecialType(type: string) {
    if (!this.specialTypes.some((viewType) => viewType.id === type)) return;
    this.specialType = type;
    this.type = '';
    this.specialPage = 0;
    this.specialQuery = '';
    this.specialFilter = '';
    void this.refresh();
  }

  async refresh() {
    const repository = this.context.repository();
    const selected = this.context.selected();
    const mode = this.context.mode();
    this.recipeAbortController?.abort();
    this.specialAbortController?.abort();
    const controller = new AbortController();
    this.recipeAbortController = controller;
    const request = ++this.recipeRequest;
    const specialRequest = ++this.specialRequest;
    const entryId = selected.id;
    const view = mode;
    const specialType = this.specialTypes.some((viewType) => viewType.id === this.specialType)
      ? this.specialType
      : '';
    this.specialType = specialType;
    this.allRecipes = [];
    this.specialRecords = [];
    this.type = '';
    this.recipeQuery = '';
    this.recipeFilter = '';
    this.recipePage = 0;
    this.resetRecipeSearch();
    this.recipeError = '';
    this.specialError = '';
    this.recipeLoading = true;
    this.specialLoading = false;
    this.recipeLoadedShards = 0;
    this.recipeTotalShards = 0;
    this.specialLoadedShards = 0;
    this.specialTotalShards = 0;
    try {
      if (specialType) {
        this.recipeLoading = false;
        this.specialLoading = true;
        const specialController = new AbortController();
        this.specialAbortController = specialController;
        const cacheKey = `${repository.datasetId}:${entryId}:${view}:${specialType}`;
        const specialRepo = specialRepository(repository);
        const loader = specialRepo.specialFor ?? specialRepo.specialRecordsFor;
        if (!loader) {
          this.specialRecords = [];
          this.loadedSpecialCounts = {
            ...this.loadedSpecialCounts,
            [`${entryId}:${view}:${specialType}`]: 0
          };
        } else {
          const cached = this.specialCache.get(cacheKey);
          const loaded = cached ?? await loader.call(
            specialRepo,
            entryId,
            view,
            specialType,
            (progress) => this.applySpecialProgress(progress, specialRequest, entryId, view, specialType),
            specialController.signal
          );
          if (specialRequest !== this.specialRequest || request !== this.recipeRequest) return;
          const ordered = [...loaded].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
          this.specialCache.set(cacheKey, ordered);
          this.specialRecords = ordered;
          this.loadedSpecialCounts = {
            ...this.loadedSpecialCounts,
            [`${entryId}:${view}:${specialType}`]: ordered.length
          };
          this.specialTotalShards = Math.max(this.specialTotalShards, 1);
          this.specialLoadedShards = this.specialTotalShards;
        }
        return;
      }
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
        this.specialRecords = [];
        this.resetRecipeSearch();
        if (specialType) this.specialError = error instanceof Error ? error.message : String(error);
        else this.recipeError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === this.recipeRequest) {
        this.recipeLoading = false;
        this.specialLoading = false;
      }
    }
  }

  private applySpecialProgress(
    progress: SpecialLoadProgress,
    request: number,
    entryId: string,
    view: RecipeView,
    viewType: string
  ) {
    if (request !== this.specialRequest) return;
    this.specialLoadedShards = progress.loadedShards;
    this.specialTotalShards = progress.totalShards;
    if (progress.batch.length === 0) return;
    const next = [...this.specialRecords, ...progress.batch]
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
    this.specialRecords = next;
    this.loadedSpecialCounts = {
      ...this.loadedSpecialCounts,
      [`${entryId}:${view}:${viewType}`]: next.length
    };
  }

  private async initializeRecipeSearch(catalog: CatalogEntry[]) {
    const generation = ++this.recipeSearchGeneration;
    this.recipeIndexRevision += 1;
    this.recipeSearchIds = [];
    this.recipeSearchTotalValue = 0;
    this.recipeWorkerPending = false;
    this.recipeSearchReady = false;
    this.recipeCatalogDatasetId = this.context.repository().datasetId;
    this.recipeCatalogIndexed = 0;
    this.recipeCatalogTotal = catalog.length;
    this.recipeSearchWorker?.postMessage({
      type: 'init',
      generation
    });
    for (let start = 0; start < catalog.length; start += 2_000) {
      if (
        generation !== this.recipeSearchGeneration
        || !this.recipeSearchWorker
        || !this.context.active()
      ) return;
      const end = Math.min(start + 2_000, catalog.length);
      this.recipeSearchWorker.postMessage({
        type: 'appendCatalog',
        generation,
        catalog: catalog.slice(start, end).map(toRecipeSearchCatalogEntry)
      });
      this.recipeCatalogIndexed = end;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (generation === this.recipeSearchGeneration) {
      this.recipeSearchWorker?.postMessage({ type: 'finishCatalog', generation });
    }
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
    worker.onmessage = (event: MessageEvent<
      | { type: 'catalogReady'; generation: number }
      | {
          type: 'results';
          generation: number;
          id: number;
          total: number;
          ids: string[];
        }
    >) => {
      if (event.data.type === 'catalogReady') {
        if (event.data.generation === this.recipeSearchGeneration) {
          this.recipeSearchReady = true;
        }
        return;
      }
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
    this.recipeWorkerMounted = true;
    return () => {
      worker.terminate();
      this.recipeSearchWorker = null;
      this.recipeCatalogDatasetId = '';
      this.recipeWorkerMounted = false;
      this.recipeSearchReady = false;
      this.recipeAbortController?.abort();
      this.recipeAbortController = null;
      this.specialAbortController?.abort();
      this.specialAbortController = null;
    };
  }
}
