import type { ChainGraph, ChainPath, ChainProgress } from './recipeChain';

interface Label {
  node: number;
  path: number[];
  known: Set<number>;
  borrowed: Set<number>;
  active: boolean;
}

/** Keep alternative histories: the same intermediate can have different borrowed ingredients. */
export async function searchWithExtras(
  graph: ChainGraph,
  index: {
    members: Map<number, number[]>;
    memberOf: Map<number, number[]>;
    consumers: Map<number, number[]>;
  },
  inputs: string[],
  outputs: string[],
  maxDepth: number,
  routeLimit: number,
  signal?: AbortSignal,
  onProgress?: (progress: ChainProgress) => void,
): Promise<ChainPath[]> {
  const breadth = Math.max(1, routeLimit / 10);
  const workLimit = Math.floor(3_000_000 * breadth);
  const processedLimit = Math.floor(20_000 * breadth);
  const historyLimit = Math.min(100, routeLimit * 2);
  const equivalentLimit = routeLimit;
  const frontierLimit = Math.min(24_000, Math.floor(12_000 * breadth));
  const lookup = new Map(graph.ids.map((id, node) => [id, node]));
  const expand = (node: number) => index.members.get(node) ?? [node];
  const accepts = (slot: number, available: Set<number>) =>
    expand(slot).some((node) => available.has(node));
  const subset = (a: Set<number>, b: Set<number>) =>
    a.size <= b.size && [...a].every((node) => b.has(node));
  const outgoing = new Map<number, number[]>();
  const consumers = (node: number) => {
    let result = outgoing.get(node);
    if (!result) {
      result = [
        ...new Set(
          [node, ...(index.memberOf.get(node) ?? [])].flatMap(
            (id) => index.consumers.get(id) ?? [],
          ),
        ),
      ].filter((recipe) =>
        graph.recipes[recipe]![2].some(
          (slot) => slot === node || index.memberOf.get(node)?.includes(slot),
        ),
      );
      outgoing.set(node, result);
    }
    return result;
  };
  let work = 0,
    generated = 0,
    limited = false;
  const active = () => {
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
  };
  const pause = async () => {
    active();
    onProgress?.({ visited: generated, recipes: work });
    await new Promise((resolve) => setTimeout(resolve, 0));
    active();
  };
  const seeds = new Set(
    inputs.flatMap((id) => {
      const node = lookup.get(id);
      return node === undefined ? [] : expand(node);
    }),
  );
  const labels: Label[] = [];
  const atNode = new Map<number, Label[]>();
  const found = new Map<number, Label[]>();
  const targets = outputs.map((id) => lookup.get(id));
  for (const node of seeds) {
    const label: Label = { node, path: [], known: seeds, borrowed: new Set(), active: true };
    labels.push(label);
    generated++;
    atNode.set(node, [label]);
    if (targets.includes(node)) found.set(node, [label]);
  }
  const producers = new Map<number, number[]>();
  graph.recipes.forEach((recipe, recipeIndex) => {
    for (const node of recipe[3]) {
      const list = producers.get(node) ?? [];
      list.push(recipeIndex);
      producers.set(node, list);
    }
  });
  const distance = new Int16Array(graph.ids.length).fill(-1),
    reverse: number[] = [];
  const reverseMark = (node: number, hops: number) => {
    if (distance[node]! >= 0) return;
    distance[node] = hops;
    for (const member of expand(node)) {
      if (member !== node && distance[member]! >= 0) continue;
      distance[member] = hops;
      reverse.push(member);
    }
  };
  for (const target of targets) if (target !== undefined) reverseMark(target, 0);
  for (let head = 0; head < reverse.length; head++) {
    active();
    const current = reverse[head]!;
    if (distance[current]! >= maxDepth) continue;
    const recipes = new Set(
      [current, ...(index.memberOf.get(current) ?? [])].flatMap(
        (node) => producers.get(node) ?? [],
      ),
    );
    for (const recipe of recipes)
      for (const input of graph.recipes[recipe]![2]) reverseMark(input, distance[current]! + 1);
    if (head % 2048 === 0) await pause();
  }
  // Best-first exploration prefers shorter, less externally supplied proofs.
  const frontier: Array<{ label: Label; score: number }> = [];
  const push = (label: Label) => {
    const item = {
      label,
      score: label.path.length + distance[label.node]! + 2 * Math.sqrt(label.borrowed.size),
    };
    let child = frontier.length;
    frontier.push(item);
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (frontier[parent]!.score <= item.score) break;
      frontier[child] = frontier[parent]!;
      child = parent;
    }
    frontier[child] = item;
  };
  const pop = () => {
    const first = frontier[0]!.label,
      last = frontier.pop()!;
    if (frontier.length) {
      let parent = 0;
      while (parent * 2 + 1 < frontier.length) {
        let child = parent * 2 + 1;
        if (child + 1 < frontier.length && frontier[child + 1]!.score < frontier[child]!.score)
          child++;
        if (frontier[child]!.score >= last.score) break;
        frontier[parent] = frontier[child]!;
        parent = child;
      }
      frontier[parent] = last;
    }
    return first;
  };
  for (const label of labels) if (distance[label.node]! >= 0) push(label);
  const closures = new Map<string, Uint8Array>();
  // Counterfactual check: if the extras alone can make the target, this route
  // has not demonstrated a conversion from the supplied source. Tools need not
  // be balanced here; they must not make a borrowed material look source-derived.
  const extraClosure = async (
    borrowed: Set<number>,
    proof: number[],
  ): Promise<Uint8Array | null> => {
    const allowed = new Set(proof);
    const key = [...borrowed].sort((a, b) => a - b).join(',') + ':' + proof.join(',');
    const cached = closures.get(key);
    if (cached) return cached;
    const available = new Uint8Array(graph.ids.length);
    const fired = new Uint8Array(graph.recipes.length);
    const queue: number[] = [];
    const mark = (node: number) => {
      if (!available[node]) {
        available[node] = 1;
        queue.push(node);
      }
      for (const group of index.memberOf.get(node) ?? []) available[group] = 1;
    };
    for (const node of borrowed) mark(node);
    for (let head = 0; head < queue.length; head++) {
      for (const recipeIndex of consumers(queue[head]!)) {
        if (++work > workLimit) {
          limited = true;
          return null;
        }
        if (work % 4096 === 0) await pause();
        if (fired[recipeIndex]) continue;
        const recipe = graph.recipes[recipeIndex]!;
        // Test this proof's reactions plus unary processing/form changes.
        // An unrelated multi-reactant synthesis elsewhere in the entire pack
        // must not invalidate a real source-dependent refining procedure.
        if (
          !recipe[2].length ||
          (recipe[2].length > 1 && !allowed.has(recipeIndex)) ||
          !recipe[2].every((node) => available[node])
        )
          continue;
        fired[recipeIndex] = 1;
        for (const output of recipe[3]) for (const node of expand(output)) mark(node);
      }
    }
    if (closures.size >= 16) closures.delete(closures.keys().next().value!);
    closures.set(key, available);
    return available;
  };
  let processed = 0;
  search: while (frontier.length) {
    active();
    if (
      targets.every(
        (node) =>
          node !== undefined && ((found.get(node)?.length ?? 0) >= routeLimit || seeds.has(node)),
      )
    )
      break;
    const label = pop();
    processed++;
    if (
      !label.active ||
      label.path.length >= maxDepth ||
      distance[label.node]! < 0 ||
      label.path.length + distance[label.node]! > maxDepth
    )
      continue;
    // A proof can process a sibling byproduct before joining both branches.
    const direct = consumers(label.node);
    const nextRecipes = new Set(direct);
    // Only open a sibling branch when it supplies a co-input of the current
    // frontier. Reprocessing every known upstream material creates factorial
    // permutations of unrelated steps before useful refinery joins are reached.
    const needed = new Set(
      direct
        .flatMap((recipe) => graph.recipes[recipe]![2])
        .filter((slot) => !accepts(slot, label.known)),
    );
    for (const slot of needed)
      for (const member of expand(slot)) {
        for (const candidate of producers.get(member) ?? []) {
          const recipe = graph.recipes[candidate]!;
          if (recipe[2].some((input) => accepts(input, label.known))) nextRecipes.add(candidate);
        }
      }
    for (const recipeIndex of nextRecipes) {
      if (++work > workLimit || processed >= processedLimit) {
        limited = true;
        break search;
      }
      if (work % 1024 === 0) await pause();
      if (label.path.includes(recipeIndex)) continue;
      const recipe = graph.recipes[recipeIndex]!;
      const borrowed = new Set(label.borrowed);
      for (const input of recipe[2]) {
        if (!accepts(input, label.known)) for (const node of expand(input)) borrowed.add(node);
      }
      const produced = [...new Set(recipe[3].flatMap(expand))].filter(
        (node) => !borrowed.has(node),
      );
      if (!produced.length) continue;
      const known = new Set([...label.known, ...produced]);
      for (const node of produced) {
        if (
          seeds.has(node) ||
          label.known.has(node) ||
          distance[node]! < 0 ||
          label.path.length + 1 + distance[node]! > maxDepth
        )
          continue;
        const next: Label = {
          node,
          known,
          borrowed,
          path: [...label.path, recipeIndex],
          active: true,
        };
        const alternatives = atNode.get(node) ?? [];
        if (targets.includes(node) && (found.get(node)?.length ?? 0) < routeLimit) {
          const independent = await extraClosure(borrowed, next.path);
          if (!independent) break search;
          if (independent[node]) continue;
          const routes = found.get(node) ?? [];
          if (!routes.some((old) => old.path.join(',') === next.path.join(','))) routes.push(next);
          found.set(node, routes);
        }
        // Retain several equivalent histories so alternatives can survive a
        // common intermediate, rather than silently collapsing to one route.
        const retained = alternatives.filter((old) => old.active);
        if (
          retained.filter(
            (old) =>
              old.path.length <= next.path.length &&
              subset(old.borrowed, borrowed) &&
              subset(known, old.known),
          ).length >= equivalentLimit
        ) {
          limited = true;
          continue;
        }
        if (retained.length >= historyLimit) {
          limited = true;
          retained.sort(
            (a, b) =>
              a.path.length +
              2 * Math.sqrt(a.borrowed.size) -
              b.path.length -
              2 * Math.sqrt(b.borrowed.size),
          );
          const worst = retained[retained.length - 1]!;
          if (
            worst.path.length + 2 * Math.sqrt(worst.borrowed.size) <=
            next.path.length + 2 * Math.sqrt(next.borrowed.size)
          )
            continue;
          worst.active = false;
          retained.pop();
        }
        retained.push(next);
        atNode.set(node, retained);
        generated++;
        push(next);
        if (frontier.length > frontierLimit) {
          limited = true;
          frontier.sort((a, b) => a.score - b.score);
          for (const discarded of frontier.splice(Math.floor(frontierLimit / 2)))
            discarded.label.active = false;
        }
      }
    }
    if (processed % 512 === 0) await pause();
  }
  active();
  onProgress?.({ visited: generated, recipes: work });
  return outputs.map((targetId, position) => {
    const node = targets[position],
      routes = node === undefined ? undefined : found.get(node);
    if (!routes?.length)
      return { targetId, status: limited ? 'search-limit' : 'not-found', steps: [] };
    routes.sort((a, b) => a.path.length - b.path.length || a.borrowed.size - b.borrowed.size);
    const references = routes.map((label) =>
      label.path.map((id) => {
        const recipe = graph.recipes[id]!;
        return { shardId: graph.shards[recipe[0]]!, record: recipe[1] };
      }),
    );
    return {
      targetId,
      status: 'found',
      steps: references[0]!,
      alternatives: references.slice(1),
      limited: limited || routes.length >= routeLimit,
    };
  });
}
