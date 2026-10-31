/** Dataset-derived incidence graph. Nodes keep exact IDs, including NBT and fluid identity. */
export type ChainRecipe = [shard: number, record: number, inputs: number[], outputs: number[], tools: number[]];
export interface ChainGraph {
  schemaVersion: 1;
  datasetId: string;
  manifestSha256: string;
  ids: string[];
  groups: Array<[number, number[]]>;
  shards: string[];
  recipes: ChainRecipe[];
}
export interface ChainReference { shardId: string; record: number }
export interface ChainPath { targetId: string; status: 'found' | 'not-found' | 'proof-limit'; steps: ChainReference[] }
export interface ChainProgress { visited: number; recipes: number }

export function validateChainGraph(value: unknown, datasetId: string, manifestSha256: string): ChainGraph {
  const graph = value as ChainGraph;
  if (!graph || graph.schemaVersion !== 1 || graph.datasetId !== datasetId || graph.manifestSha256 !== manifestSha256
    || !Array.isArray(graph.ids) || !graph.ids.every((id) => typeof id === 'string')
    || new Set(graph.ids).size !== graph.ids.length || !Array.isArray(graph.shards)
    || !graph.shards.every((id) => typeof id === 'string') || new Set(graph.shards).size !== graph.shards.length
    || !Array.isArray(graph.groups) || !Array.isArray(graph.recipes)) throw new Error('Invalid recipe chain index identity');
  const node = (id: unknown) => Number.isSafeInteger(id) && Number(id) >= 0 && Number(id) < graph.ids.length;
  const nodes = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.every(node);
  const groups = new Set<number>();
  for (const group of graph.groups) {
    if (!Array.isArray(group) || group.length !== 2 || !node(group[0]) || !nodes(group[1]) || groups.has(group[0])) throw new Error('Invalid chain ingredient group');
    groups.add(group[0]);
  }
  if (graph.groups.some(([, members]) => members.some((id) => groups.has(id)))) throw new Error('Nested chain ingredient group');
  for (const recipe of graph.recipes) {
    if (!Array.isArray(recipe) || recipe.length !== 5 || !Number.isSafeInteger(recipe[0]) || recipe[0] < 0 || recipe[0] >= graph.shards.length
      || !Number.isSafeInteger(recipe[1]) || recipe[1] < 0 || !nodes(recipe[2]) || !nodes(recipe[3]) || !nodes(recipe[4])) throw new Error('Invalid chain recipe reference');
  }
  return graph;
}

/** Reachability, not a quantity/energy planner. Never invents edges between material forms. */
export class RecipeChainGraph {
  private readonly lookup: Map<string, number>;
  private readonly members: Map<number, number[]>;
  private readonly memberOf = new Map<number, number[]>();
  private readonly consumers = new Map<number, number[]>();
  constructor(private readonly graph: ChainGraph) {
    this.lookup = new Map(graph.ids.map((id, index) => [id, index]));
    this.members = new Map(graph.groups);
    for (const [group, members] of graph.groups) for (const member of members) {
      const groups = this.memberOf.get(member) ?? []; groups.push(group); this.memberOf.set(member, groups);
    }
    graph.recipes.forEach((recipe, index) => {
      if (!recipe[2].length || !recipe[3].length) return;
      for (const input of new Set([...recipe[2], ...recipe[4]])) {
        const recipes = this.consumers.get(input) ?? []; recipes.push(index); this.consumers.set(input, recipes);
      }
    });
  }

  async search(inputs: string[], outputs: string[], options: { maxDepth: number; allowExtras: boolean },
    signal?: AbortSignal, onProgress?: (progress: ChainProgress) => void): Promise<ChainPath[]> {
    const maxDepth = Math.max(1, Math.min(32, Math.floor(options.maxDepth) || 12));
    const depth = new Int16Array(this.graph.ids.length).fill(-1);
    const via = new Int32Array(this.graph.ids.length).fill(-1);
    const representative = new Int32Array(this.graph.ids.length).fill(-1);
    const fired = new Uint8Array(this.graph.recipes.length);
    const trigger = new Int32Array(this.graph.recipes.length).fill(-1);
    const queue: number[] = [];
    let considered = 0;
    const mark = (id: number, level: number, recipe: number, actual = id) => {
      if (depth[id]! >= 0) return;
      depth[id] = level; via[id] = recipe; representative[id] = actual; queue.push(id);
    };
    const publish = (id: number, level: number, recipe: number) => {
      // A produced group can yield its alternatives. Merely accepting an item
      // in a group must never freely convert it into the group's other members.
      for (const member of this.members.get(id) ?? [id]) {
        mark(member, level, recipe);
        for (const group of this.memberOf.get(member) ?? []) mark(group, level, recipe, member);
      }
    };
    for (const id of inputs) { const node = this.lookup.get(id); if (node !== undefined) publish(node, 0, -1); }
    const targets = outputs.map((id) => this.lookup.get(id));
    const active = () => { if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError'); };
    for (let head = 0; head < queue.length; head++) {
      active();
      if (targets.every((id) => id !== undefined && depth[id]! >= 0)) break;
      const current = queue[head]!;
      if (depth[current]! >= maxDepth) continue;
      for (const index of this.consumers.get(current) ?? []) {
        if (fired[index]) continue;
        considered++;
        const recipe = this.graph.recipes[index]!;
        if (options.allowExtras) {
          if (!recipe[2].includes(current)) continue; // Tools/circuits are not conversion sources.
        } else if (![...recipe[2], ...recipe[4]].every((id) => depth[id]! >= 0 && depth[id]! <= depth[current]!)) continue;
        fired[index] = 1; trigger[index] = current;
        for (const output of recipe[3]) publish(output, depth[current]! + 1, index);
      }
      if (head % 2048 === 0) {
        onProgress?.({ visited: head + 1, recipes: considered });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    active();
    onProgress?.({ visited: queue.length, recipes: considered });
    return outputs.map((targetId, targetIndex) => {
      const target = targets[targetIndex];
      if (target === undefined || depth[target]! < 0) return { targetId, status: 'not-found', steps: [] };
      const steps = new Set<number>();
      const visit = (node: number): boolean => {
        const index = via[node]!;
        if (index < 0 || steps.has(index)) return true;
        if (steps.size >= 128) return false;
        const recipe = this.graph.recipes[index]!;
        const dependencies = options.allowExtras ? [trigger[index]!] : [...recipe[2], ...recipe[4]];
        for (const input of dependencies) {
          const actual = representative[input]!;
          if (!visit(actual < 0 ? input : actual)) return false;
        }
        steps.add(index);
        return steps.size <= 128;
      };
      if (!visit(target)) return { targetId, status: 'proof-limit', steps: [] };
      return { targetId, status: 'found', steps: [...steps].map((index) => {
        const recipe = this.graph.recipes[index]!;
        return { shardId: this.graph.shards[recipe[0]]!, record: recipe[1] };
      }) };
    });
  }
}
