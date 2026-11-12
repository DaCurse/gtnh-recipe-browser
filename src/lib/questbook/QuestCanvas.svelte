<script lang="ts">
  import QuestIcon from './QuestIcon.svelte';
  import { questbook } from './state.svelte';
  import { placementVisible, questBounds, questEdges } from './layout';
  import { plainQuestText } from './text';
  import type { QuestChapter } from './types';
  import type { QuestRepository } from './repository';
  let { chapter, repository, preview, focusQuest, activate, clearPreview, pointerKind }: {
    chapter: QuestChapter; repository: QuestRepository;
    preview: (id: string, event: PointerEvent) => void; focusQuest: (id: string, event: FocusEvent) => void;
    activate: (id: string, event: MouseEvent) => void; clearPreview: () => void; pointerKind: (event: PointerEvent) => void;
  } = $props();
  let element: HTMLDivElement;
  let width = $state(0), height = $state(0);
  let camera = $state({ x: 0, y: 0, zoom: 1 });
  let initialized = $state(false), dragging = $state(false);
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let suppressClickUntil = 0;
  const bounds = $derived(questBounds(chapter));
  const edges = $derived(questEdges(chapter, repository.quests));
  $effect(() => {
    if (!width || !height || initialized) return;
    camera = questbook.cameras.get(chapter.id) ?? fitted(); initialized = true;
  });
  $effect(() => { if (initialized) questbook.cameras.set(chapter.id, { ...camera }); });
  function fitted() {
    const zoom = Math.max(.15, Math.min(2, (width - 48) / bounds.width, (height - 48) / bounds.height));
    return { zoom, x: (width - bounds.width * zoom) / 2 - bounds.minX * zoom, y: (height - bounds.height * zoom) / 2 - bounds.minY * zoom };
  }
  function zoomTo(next: number, x = width / 2, y = height / 2) {
    const zoom = Math.max(.15, Math.min(4, next));
    camera = { x: x - (x - camera.x) * zoom / camera.zoom, y: y - (y - camera.y) * zoom / camera.zoom, zoom };
    clearPreview();
  }
  function wheelZoom(node: HTMLElement) {
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomTo(camera.zoom * Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top);
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', wheel) };
  }
  function down(event: PointerEvent) {
    pointerKind(event);
    if (event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    if (pointers.size > 1) { dragging = true; clearPreview(); }
  }
  function move(event: PointerEvent) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    const previous = [...pointers.values()].map(p => ({ ...p }));
    if (!dragging && Math.hypot(event.clientX - point.startX, event.clientY - point.startY) <= 10) return;
    dragging = true; clearPreview();
    element.setPointerCapture(event.pointerId);
    const dx = event.clientX - point.x, dy = event.clientY - point.y;
    point.x = event.clientX; point.y = event.clientY;
    const current = [...pointers.values()];
    if (current.length === 2) {
      const before = Math.hypot(previous[0].x - previous[1].x, previous[0].y - previous[1].y);
      const after = Math.hypot(current[0].x - current[1].x, current[0].y - current[1].y);
      const rect = element.getBoundingClientRect();
      const x = (current[0].x + current[1].x) / 2 - rect.left, y = (current[0].y + current[1].y) / 2 - rect.top;
      if (before > 0) zoomTo(camera.zoom * after / before, x, y);
      camera = { ...camera, x: camera.x + dx / 2, y: camera.y + dy / 2 };
    } else camera = { ...camera, x: camera.x + dx, y: camera.y + dy };
  }
  function up(event: PointerEvent) {
    if (dragging) suppressClickUntil = Date.now() + 500;
    pointers.delete(event.pointerId);
    if (!pointers.size) dragging = false;
  }
  function key(event: KeyboardEvent) {
    const moves: Record<string, [number, number]> = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
    const delta = moves[event.key];
    if (delta) { event.preventDefault(); camera = { ...camera, x: camera.x + delta[0], y: camera.y + delta[1] }; clearPreview(); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(camera.zoom * 1.25); }
    if (event.key === '-') { event.preventDefault(); zoomTo(camera.zoom / 1.25); }
    if (event.key === '0') { event.preventDefault(); camera = fitted(); clearPreview(); }
  }
</script>
<section class="quest-canvas-area" aria-label={`${plainQuestText(chapter.name)} quest layout`}>
  <div class="canvas-tools">
    <button class="mc-button" aria-label="Zoom out" onclick={() => zoomTo(camera.zoom / 1.25)}>−</button>
    <span>{Math.round(camera.zoom * 100)}%</span>
    <button class="mc-button" aria-label="Zoom in" onclick={() => zoomTo(camera.zoom * 1.25)}>+</button>
    <button class="mc-button" onclick={() => { camera = fitted(); clearPreview(); }}>Fit</button>
    <small><i></i>Direct <i class="implicit"></i>Implicit</small>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (The map implements pan/zoom keyboard controls and contains native quest buttons.) -->
  <div class="quest-canvas" class:dragging bind:this={element} bind:clientWidth={width} bind:clientHeight={height}
    role="application" tabindex="0" aria-label="Quest map. Drag to pan, scroll or pinch to zoom. Arrow keys pan; plus and minus zoom; zero fits."
    use:wheelZoom onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}>
    <div class="quest-world" style:transform={`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}>
      <svg class="quest-connections" aria-hidden="true" width={bounds.width} height={bounds.height} viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} style:left={`${bounds.minX}px`} style:top={`${bounds.minY}px`}>
        {#each edges as edge (edge.id)}
          <g class:implicit={edge.type === 'implicit'} transform={`translate(${edge.x},${edge.y}) rotate(${edge.angle})`}>
            <line x1="0" y1="0" x2={edge.length} y2="0" stroke-width={edge.width} />
            <path d={edge.arrows} />
          </g>
        {/each}
      </svg>
      {#each chapter.quests as placement (placement.id)}
        {@const quest = repository.quests.get(placement.id)!}
        {#if placementVisible(placement, camera.x, camera.y, camera.zoom, width, height)}
          <button class="quest-node" class:main-quest={quest.main} class:secret={quest.secret} data-quest={quest.id}
            aria-label={`${plainQuestText(quest.name)}${quest.secret ? ' (Secret quest)' : ''}`} style:left={`${placement.x}px`} style:top={`${placement.y}px`}
            style:width={`${placement.width}px`} style:height={`${placement.height}px`}
            style:--quest-frame={`url('${import.meta.env.BASE_URL}quests/assets/quest-${quest.main ? 'main' : 'normal'}-${placement.width}x${placement.height}.png')`}
            onpointerenter={event => { if (!dragging) preview(quest.id, event); }} onpointermove={event => { if (!dragging) preview(quest.id, event); }}
            onpointerleave={event => { if (event.pointerType !== 'touch') clearPreview(); }}
            onfocus={event => focusQuest(quest.id, event)} onblur={clearPreview}
            oncontextmenu={event => event.preventDefault()}
            onclick={event => { if (Date.now() > suppressClickUntil) activate(quest.id, event); }}>
            <QuestIcon entry={repository.items.get(quest.icon.goodsId)} entries={repository.items} size={Math.max(8, Math.min(placement.width, placement.height) - 8)} renderScale={camera.zoom > 2 ? 4 : 2} />
            {#if quest.secret}<img class="secret-mark" src={`${import.meta.env.BASE_URL}quests/assets/secret-eye.png`} alt="" aria-hidden="true" draggable="false" />{/if}
          </button>
        {/if}
      {/each}
    </div>
  </div>
  <p class="canvas-hint">Drag to pan · Scroll or pinch to zoom</p>
</section>
<style>
  .quest-canvas-area { display:flex; flex:1; flex-direction:column; min-height:0; }
  .canvas-tools { display:flex; gap:6px; align-items:center; padding:8px 14px; border-bottom:1px solid #373a3e; color:#a3a7ac; font-size:12px; }
  .canvas-tools button { min-width:34px; min-height:32px; } .canvas-tools>span { min-width:42px; text-align:center; }
  small { margin-left:auto; display:flex; align-items:center; gap:5px; font-size:11px; } i { width:14px; height:3px; background:#58a94a; } i.implicit { background:#777; margin-left:8px; }
  .quest-canvas { flex:1; min-height:240px; overflow:hidden; position:relative; cursor:grab; touch-action:none; user-select:none; outline-offset:-3px; }
  .quest-canvas.dragging { cursor:grabbing; } .quest-world { position:absolute; left:0; top:0; transform-origin:0 0; }
  .quest-connections { position:absolute; overflow:visible; pointer-events:none; } line { stroke:#58a94a; } .implicit line { stroke:#777; } path { fill:#000; opacity:.25; }
  .quest-node { position:absolute; display:grid; place-items:center; padding:0; border:0; background:transparent; cursor:pointer; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
  .quest-node::before { content:''; position:absolute; inset:0; background-image:var(--quest-frame); background-size:100% 100%; image-rendering:pixelated; filter:brightness(.5); pointer-events:none; }
  .quest-node :global(.quest-icon) { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }
  .quest-node:hover,.quest-node:focus-visible { filter:brightness(1.25); }
  .quest-node:focus-visible { outline:1px solid #d6dce8; outline-offset:2px; }
  .secret-mark { position:absolute; right:-5px; top:-7px; width:12px; height:12px; image-rendering:pixelated; filter:drop-shadow(1px 1px #000); }
  .canvas-hint { text-align:center; font-size:11px; color:#6f7780; margin:6px 0 8px; }
  @media(max-width:800px) { .canvas-tools { padding:6px 10px; } small { font-size:10px; } }
</style>
