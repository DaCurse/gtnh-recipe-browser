import type {
  OreProcessingStage,
  SpecialGoods,
  SpecialProcessingEdge,
  SpecialProcessingNode
} from './specialData';

export interface OreGraphNode extends SpecialProcessingNode {
  kind: 'source' | 'machine' | 'result' | 'probability' | 'reagent' | string;
  width: number;
  height: number;
  rank: number;
  x: number;
  y: number;
}

export interface OreGraphEdge extends SpecialProcessingEdge {
  fromNode: OreGraphNode;
  toNode: OreGraphNode;
  points: Array<{ x: number; y: number }>;
}

export interface OreGraphLayout {
  nodes: OreGraphNode[];
  edges: OreGraphEdge[];
  width: number;
  height: number;
  ranks: number[];
}

export interface OreGraphOptions {
  horizontalGap?: number;
  verticalGap?: number;
  margin?: number;
  defaultNodeWidth?: number;
  defaultNodeHeight?: number;
}

const DEFAULT_OPTIONS: Required<OreGraphOptions> = {
  horizontalGap: 38,
  verticalGap: 22,
  margin: 28,
  defaultNodeWidth: 142,
  defaultNodeHeight: 72
};

function stableNodes(
  nodes: readonly SpecialProcessingNode[],
  options: Required<OreGraphOptions>
): OreGraphNode[] {
  return nodes.map((node, index) => ({
    ...node,
    kind: node.kind ?? 'machine',
    width: Math.max(56, node.width ?? options.defaultNodeWidth),
    height: Math.max(42, node.height ?? options.defaultNodeHeight),
    rank: Number.isInteger(node.rank) && (node.rank as number) >= 0 ? node.rank as number : index,
    x: 0,
    y: 0
  }));
}

/**
 * Convert stage-shaped exporter data into semantic graph nodes and edges.
 * The layout does not inspect pixels or sprite dimensions, making it stable
 * when an atlas is regenerated.
 */
export function stagesToOreGraph(
  stages: readonly OreProcessingStage[],
  source?: SpecialGoods,
  result?: SpecialGoods
): { nodes: SpecialProcessingNode[]; edges: SpecialProcessingEdge[] } {
  const nodes: SpecialProcessingNode[] = [];
  const edges: SpecialProcessingEdge[] = [];
  let previous: string | undefined;
  if (source) {
    nodes.push({
      id: `source:${source.goodsId}`,
      label: source.label ?? source.goodsId,
      kind: 'source',
      goodsId: source.goodsId,
      rank: 0
    });
    previous = nodes[0]!.id;
  }
  stages.forEach((stage, index) => {
    const stageId = stage.id || `stage:${index}`;
    const machineId = stage.machineId ?? stageId;
    nodes.push({
      id: stageId,
      label: stage.machine,
      kind: stage.kind === 'chemicalBath' ? 'chemicalBath' : stage.kind === 'sifter' ? 'sifter' : 'machine',
      machineId,
      rank: stage.rank ?? index + (source ? 1 : 0),
      branch: stage.branches?.[0]
    });
    if (previous) {
      edges.push({ from: previous, to: stageId, branch: stage.branches?.[0] });
    }
    const inputIds = (stage.inputs ?? []).map((input, inputIndex) => {
      const id = `${stageId}:input:${inputIndex}:${input.goodsId}`;
      nodes.push({
        id,
        label: input.label ?? input.goodsId,
        kind: input.role === 'reagent' ? 'reagent' : 'source',
        goodsId: input.goodsId,
        rank: Math.max(0, (stage.rank ?? index + 1) - 1),
        branch: stage.branches?.[inputIndex]
      });
      edges.push({ from: id, to: stageId, branch: stage.branches?.[inputIndex] });
      return id;
    });
    void inputIds;
    const outputIds = (stage.outputs ?? []).map((output, outputIndex) => {
      const id = `${stageId}:output:${outputIndex}:${output.goodsId}`;
      nodes.push({
        id,
        label: output.label ?? output.goodsId,
        kind: 'result',
        goodsId: output.goodsId,
        rank: (stage.rank ?? index) + 1,
        branch: stage.branches?.[outputIndex],
        width: output.role === 'sifter' ? 116 : undefined
      });
      edges.push({
        from: stageId,
        to: id,
        chance: output.chance,
        branch: stage.branches?.[outputIndex]
      });
      return id;
    });
    previous = outputIds[0] ?? stageId;
  });
  if (result) {
    const id = `result:${result.goodsId}`;
    nodes.push({ id, label: result.label ?? result.goodsId, kind: 'result', goodsId: result.goodsId });
    if (previous) edges.push({ from: previous, to: id });
  }
  return { nodes, edges };
}

function assignRanks(nodes: OreGraphNode[], edges: readonly SpecialProcessingEdge[]): number[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!byId.has(edge.from) || !byId.has(edge.to)) return;
    if (edge.from === edge.to) return;
    const parents = incoming.get(edge.to) ?? [];
    parents.push(edge.from);
    incoming.set(edge.to, parents);
  });
  const visiting = new Set<string>();
  const resolved = new Map<string, number>();
  const visit = (id: string): number => {
    const old = resolved.get(id);
    if (old !== undefined) return old;
    const node = byId.get(id);
    if (!node) return 0;
    if (visiting.has(id)) return node.rank;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const rank = parents.length === 0
      ? node.rank
      : Math.max(node.rank, ...parents.map((parent) => visit(parent) + 1));
    visiting.delete(id);
    resolved.set(id, rank);
    node.rank = rank;
    return rank;
  };
  nodes.forEach((node) => visit(node.id));
  return [...new Set(nodes.map((node) => node.rank))].sort((a, b) => a - b);
}

/**
 * Deterministic rank layout with subtree-width-like spacing.  Each rank is a
 * discrete channel; nodes are centered around the rank's widest sibling
 * stack, preventing overlap while leaving an explicit orthogonal route.
 */
export function layoutOreProcessingGraph(
  input: { nodes: readonly SpecialProcessingNode[]; edges: readonly SpecialProcessingEdge[] },
  suppliedOptions: OreGraphOptions = {}
): OreGraphLayout {
  const options = { ...DEFAULT_OPTIONS, ...suppliedOptions };
  const nodes = stableNodes(input.nodes, options);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ranks = assignRanks(nodes, input.edges);
  const groups = new Map<number, OreGraphNode[]>();
  for (const rank of ranks) groups.set(rank, []);
  nodes.forEach((node) => (groups.get(node.rank) ?? groups.set(node.rank, []).get(node.rank)!).push(node));
  let maxHeight = 0;
  let maxWidth = 0;
  for (const rank of ranks) {
    const group = groups.get(rank)!;
    const stackHeight = group.reduce((total, node) => total + node.height, 0)
      + Math.max(0, group.length - 1) * options.verticalGap;
    maxHeight = Math.max(maxHeight, stackHeight);
    maxWidth = Math.max(maxWidth, group.reduce((width, node) => Math.max(width, node.width), 0));
  }
  const xByRank = new Map<number, number>();
  let x = options.margin;
  for (const rank of ranks) {
    const width = Math.max(maxWidth, ...(groups.get(rank) ?? []).map((node) => node.width));
    xByRank.set(rank, x);
    x += width + options.horizontalGap;
  }
  for (const rank of ranks) {
    const group = groups.get(rank)!;
    const stackHeight = group.reduce((total, node) => total + node.height, 0)
      + Math.max(0, group.length - 1) * options.verticalGap;
    let y = options.margin + (maxHeight - stackHeight) / 2;
    // Source/result order is stable by semantic kind then original order.
    group.sort((a, b) => a.id.localeCompare(b.id));
    for (const node of group) {
      node.x = xByRank.get(rank)! + (maxWidth - node.width) / 2;
      node.y = y;
      y += node.height + options.verticalGap;
    }
  }
  const edges = input.edges.flatMap((edge): OreGraphEdge[] => {
    const fromNode = byId.get(edge.from);
    const toNode = byId.get(edge.to);
    if (!fromNode || !toNode) return [];
    const start = { x: fromNode.x + fromNode.width, y: fromNode.y + fromNode.height / 2 };
    const end = { x: toNode.x, y: toNode.y + toNode.height / 2 };
    const channelX = start.x + Math.max(12, (end.x - start.x) / 2);
    return [{
      ...edge,
      fromNode,
      toNode,
      points: [start, { x: channelX, y: start.y }, { x: channelX, y: end.y }, end]
    }];
  });
  const width = Math.max(
    options.margin * 2,
    ...nodes.map((node) => node.x + node.width + options.margin)
  );
  const height = Math.max(
    options.margin * 2,
    ...nodes.map((node) => node.y + node.height + options.margin)
  );
  return { nodes, edges, width, height, ranks };
}
