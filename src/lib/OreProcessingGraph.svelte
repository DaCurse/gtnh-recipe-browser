<script lang="ts">
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import type { RecipeView } from './types';
  import {
    clampOreGraphPan,
    layoutOreProcessingGraph,
    stagesToOreGraph,
    type OreGraphLayout
  } from './oreProcessingGraph';
  import type {
    OreProcessingSpecialPayload,
    SpecialRecord,
    SpecialResolver
  } from './specialData';

  let { record, resolve, navigate }: {
    record: SpecialRecord;
    resolve: SpecialResolver;
    navigate: (id: string, view: RecipeView) => void;
  } = $props();

  let viewport: HTMLDivElement;
  let layout = $state<OreGraphLayout>({ nodes: [], edges: [], width: 0, height: 0, ranks: [] });
  let panX = $state(0);
  let panY = $state(0);
  let dragging = $state(false);
  let dragStarted = $state(false);
  let pointerId = $state<number>();
  let startPointerX = 0;
  let startPointerY = 0;
  let startPanX = 0;
  let startPanY = 0;
  let tooltipNodeId = $state('');
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  const payload = $derived(record.payload as OreProcessingSpecialPayload);

  function graphForPayload(value: OreProcessingSpecialPayload): {
    nodes: Array<{ id: string; label: string; kind?: string; goodsId?: string; rank?: number; branch?: string }>;
    edges: Array<{ from: string; to: string; chance?: number; label?: string; branch?: string }>;
  } {
    const raw = value as unknown as Record<string, unknown>;
    const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const nodes = rawNodes.map((candidate, index) => {
      const node = candidate as Record<string, unknown>;
      const rank = typeof node.rank === 'number' ? node.rank : index;
      return {
        id: String(node.id ?? `node:${index}`),
        label: String(node.label ?? node.goodsId ?? node.id ?? `Node ${index + 1}`),
        goodsId: typeof node.goodsId === 'string' ? node.goodsId : undefined,
        rank,
        kind: typeof node.kind === 'string'
          ? node.kind
          : rank === 0
            ? 'source'
            : 'result'
      };
    });
    const known = new Set(nodes.map((node) => node.id));
    const edges: Array<{ from: string; to: string; chance?: number; label?: string; branch?: string }> = [];
    const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
    rawEdges.forEach((candidate, index) => {
      if (typeof candidate !== 'object' || candidate === null) return;
      const edge = candidate as Record<string, unknown>;
      const from = String(edge.from ?? '');
      const to = String(edge.to ?? '');
      if (!from || !to) return;
      edges.push({
        from,
        to,
        chance: typeof edge.chance === 'number'
          ? edge.chance
          : typeof edge.probability === 'number'
            ? edge.probability
            : undefined,
        label: typeof edge.label === 'string' ? edge.label : typeof edge.machine === 'string' ? edge.machine : undefined,
        branch: typeof edge.branch === 'string' ? edge.branch : undefined
      });
      if (Array.isArray(edge.outputs)) edge.outputs.forEach((output, outputIndex) => {
        const id = `${from}:${to}:output:${index}:${outputIndex}`;
        if (!known.has(id)) {
          known.add(id);
          const outputLabel = String(output);
          nodes.push({ id, label: outputLabel, goodsId: undefined, kind: outputLabel.toLocaleLowerCase().startsWith('grid:') ? 'sifter' : 'result', rank: (nodes.find((node) => node.id === to)?.rank ?? 0) + 1 });
        }
        edges.push({ from: to, to: id, label: typeof edge.machine === 'string' ? edge.machine : undefined });
      });
    });
    const rawStages = Array.isArray(raw.stages) ? raw.stages : [];
    rawStages.forEach((stage, index) => {
      const label = typeof stage === 'string'
        ? stage
        : typeof stage === 'object' && stage !== null
          ? String((stage as Record<string, unknown>).machine ?? (stage as Record<string, unknown>).id ?? `Stage ${index + 1}`)
          : `Stage ${index + 1}`;
      const id = `stage:${label}:${index}`;
      if (known.has(id)) return;
      known.add(id);
      const kind = label.toLocaleLowerCase().includes('chemical') ? 'chemicalBath' : label.toLocaleLowerCase().includes('sift') ? 'sifter' : 'machine';
      nodes.push({ id, label, goodsId: undefined, kind, rank: index + 1 });
    });
    return { nodes, edges };
  }

  $effect(() => {
    const rawPayload = payload as unknown as Record<string, unknown>;
    const graph = Array.isArray(rawPayload.nodes) && rawPayload.nodes.length
      ? graphForPayload(payload)
      : stagesToOreGraph(
        (Array.isArray(rawPayload.stages) ? rawPayload.stages : []).map((stage, index) => typeof stage === 'string'
          ? { id: `stage:${index}`, machine: stage }
          : stage as OreProcessingSpecialPayload['stages'][number]),
        payload.source,
        payload.result
      );
    layout = layoutOreProcessingGraph(graph);
    panX = 0;
    panY = 0;
  });

  function clampPan(nextX: number, nextY: number): [number, number] {
    if (!viewport) return [nextX, nextY];
    return clampOreGraphPan(nextX, nextY, layout.width, layout.height, viewport.clientWidth, viewport.clientHeight);
  }

  function startPan(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerId = event.pointerId;
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    startPanX = panX;
    startPanY = panY;
    dragging = true;
    dragStarted = false;
  }

  function movePan(event: PointerEvent) {
    if (!dragging || pointerId !== event.pointerId) return;
    const dx = event.clientX - startPointerX;
    const dy = event.clientY - startPointerY;
    if (!dragStarted && Math.hypot(dx, dy) < 7) return;
    dragStarted = true;
    if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
    [panX, panY] = clampPan(startPanX + dx, startPanY + dy);
    event.preventDefault();
  }

  function finishPan(event: PointerEvent) {
    if (!dragging || pointerId !== event.pointerId) return;
    dragging = false;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    pointerId = undefined;
  }

  function nodeEntry(node: OreGraphLayout['nodes'][number]) {
    return node.goodsId ? resolve(node.goodsId) : node.machineId ? resolve(node.machineId) : undefined;
  }

  function inspectNode(node: OreGraphLayout['nodes'][number], view: RecipeView) {
    const id = node.goodsId ?? node.machineId;
    if (id && resolve(id)) navigate(id, view);
  }

  function showNodeTooltip(event: PointerEvent, node: OreGraphLayout['nodes'][number]) {
    if (event.pointerType === 'touch') return;
    if (!nodeEntry(node)) return;
    tooltipNodeId = node.id;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function moveNodeTooltip(event: PointerEvent) {
    if (!tooltipNodeId || event.pointerType === 'touch') return;
    tooltipX = event.clientX;
    tooltipY = event.clientY;
  }

  function hideNodeTooltip() {
    tooltipNodeId = '';
  }

  function path(edge: OreGraphLayout['edges'][number]): string {
    return edge.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  }
</script>

<section class="ore-graph-card" aria-label="GregTech ore processing graph">
  <div class="ore-graph-head">
    <div><b>Semantic ore processing</b><small>Drag to pan · item click: Recipes · right-click: Usages</small></div>
    <span>{layout.nodes.length} nodes · {layout.edges.length} routes</span>
  </div>
  <div
    class:dragging
    class="ore-graph-viewport"
    bind:this={viewport}
    onpointerdown={startPan}
    onpointermove={movePan}
    onpointerup={finishPan}
    onpointercancel={finishPan}
    onpointerleave={(event) => {
      if (event.pointerType === 'mouse') finishPan(event);
    }}
    role="application"
    aria-label="Drag to pan ore processing diagram"
  >
    <div class="ore-graph-canvas" style:width={`${layout.width}px`} style:height={`${layout.height}px`} style:transform={`translate(${panX}px,${panY}px)`}>
      <svg class="ore-graph-routes" width={layout.width} height={layout.height} aria-hidden="true">
        {#each layout.edges as edge (`${edge.from}:${edge.to}:${edge.branch ?? ''}`)}
          <path class:chemical={edge.branch?.toLocaleLowerCase().includes('chemical') || edge.label?.toLocaleLowerCase().includes('chemical')} d={path(edge)}></path>
          {#if edge.chance !== undefined}
            {@const mid = edge.points[Math.floor(edge.points.length / 2)]!}
            <text x={mid.x + 4} y={mid.y - 5}>{Math.round((edge.chance <= 1 ? edge.chance * 100 : edge.chance) * 100) / 100}%</text>
          {:else if edge.label}
            {@const mid = edge.points[Math.floor(edge.points.length / 2)]!}
            <text class="machine-label" x={mid.x + 4} y={mid.y - 5}>{edge.label}</text>
          {/if}
        {/each}
      </svg>
      {#each layout.nodes as node (node.id)}
        {@const entry = nodeEntry(node)}
        <div
          class:source={node.kind === 'source'}
          class:machine={node.kind === 'machine' || node.kind === 'chemicalBath' || node.kind === 'sifter'}
          class:chemical={node.kind === 'chemicalBath'}
          class:sifter={node.kind === 'sifter'}
          class:result={node.kind === 'result'}
          class:reagent={node.kind === 'reagent'}
          class="ore-graph-node"
          style:left={`${node.x}px`}
          style:top={`${node.y}px`}
          style:width={`${node.width}px`}
          style:height={`${node.height}px`}
        >
          {#if entry}
            <button
              class="node-goods"
              onclick={(event) => {
                if (dragStarted) { event.preventDefault(); return; }
                inspectNode(node, 'recipes');
              }}
              onpointerenter={(event) => showNodeTooltip(event, node)}
              onpointermove={moveNodeTooltip}
              onpointerleave={hideNodeTooltip}
              onfocus={(event) => {
                if (nodeEntry(node)) {
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  tooltipNodeId = node.id;
                  tooltipX = rect.right;
                  tooltipY = rect.bottom;
                }
              }}
              onblur={hideNodeTooltip}
              oncontextmenu={(event) => {
                event.preventDefault();
                if (!dragStarted) inspectNode(node, 'usages');
              }}
              aria-label={`${node.label}: left-click Recipes, right-click Usages`}
            >
              <ItemIcon entry={entry} size={42} crisp={false} />
              <span>{node.label}</span>
            </button>
          {:else}
            <div class="node-machine">
              <span class="machine-glyph">{node.kind === 'chemicalBath' ? '⚗' : node.kind === 'sifter' ? '▦' : '⚙'}</span>
              <span>{node.label}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>

{#if tooltipNodeId}
  {@const tooltipNode = layout.nodes.find((node) => node.id === tooltipNodeId)}
  {@const tooltipEntry = tooltipNode ? nodeEntry(tooltipNode) : undefined}
  {#if tooltipEntry}
    <FloatingCatalogTooltip entry={tooltipEntry} x={tooltipX} y={tooltipY} action="Left-click: Recipes · Right-click: Usages" />
  {/if}
{/if}

<style>
  .ore-graph-card { min-width:0; border:1px solid #4a4e53; border-radius:9px; overflow:hidden; background:#808286; box-shadow:inset 0 1px #ffffff16,0 8px 24px #0003; }
  .ore-graph-head { min-height:54px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 13px; border-bottom:1px solid #55595e; background:#24272b; color:#e4e7e9; }.ore-graph-head b,.ore-graph-head small { display:block; }.ore-graph-head b { font-size:13px; }.ore-graph-head small { margin-top:3px; color:#969ba0; font-size:10px; }.ore-graph-head>span { color:#aeb3b8; font-size:10px; white-space:nowrap; }
  .ore-graph-viewport { position:relative; width:100%; min-height:320px; max-height:620px; overflow:hidden; cursor:grab; touch-action:none; }.ore-graph-viewport.dragging { cursor:grabbing; }
  .ore-graph-canvas { position:relative; transform-origin:0 0; will-change:transform; }.ore-graph-routes { position:absolute; inset:0; z-index:0; overflow:visible; }.ore-graph-routes path { fill:none; stroke:#303338; stroke-width:5; stroke-linecap:round; stroke-linejoin:miter; }.ore-graph-routes path.chemical { stroke:#4e6e73; }.ore-graph-routes text { fill:#ffff55; font:11px Minecraft,monospace; text-shadow:2px 2px #342c34; }.ore-graph-routes text.machine-label { fill:#d0d4d8; font:9px ui-sans-serif,system-ui,sans-serif; text-shadow:1px 1px #17181b; }
  .ore-graph-node { position:absolute; z-index:1; display:grid; place-items:center; padding:5px; border:2px solid #4d5257; border-radius:7px; background:#292c30; box-shadow:0 3px 8px #0007; }.ore-graph-node.source { border-color:#65707a; background:#313840; }.ore-graph-node.machine { border-color:#686e73; background:#34383c; }.ore-graph-node.result { border-color:#7a7e55; background:#3c3d30; }.ore-graph-node.reagent { border-color:#667b4f; background:#323a2d; }.ore-graph-node.chemical { border-color:#77a4aa; background:#30494d; }.ore-graph-node.sifter { border-color:#b2a269; background:#4a4330; }
  .node-goods,.node-machine { width:100%; height:100%; display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; padding:0; border:0; background:none; color:#e4e7e9; font-size:10px; text-align:left; }.node-goods { cursor:pointer; }.node-goods:hover { filter:brightness(1.14); }.node-goods>span,.node-machine>span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:normal; }.machine-glyph { flex:0 0 auto; color:#d5d8da; font-size:25px; }.node-machine { flex-direction:column; text-align:center; }
  @media (max-width:620px) { .ore-graph-viewport { min-height:300px; }.ore-graph-head { align-items:flex-start; flex-direction:column; }.ore-graph-head>span { align-self:flex-end; }.ore-graph-canvas { transform-origin:0 0; } }
</style>
