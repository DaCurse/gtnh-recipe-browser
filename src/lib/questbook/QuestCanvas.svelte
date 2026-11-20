<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { trackEvent } from '../analytics';
  import QuestIcon from './QuestIcon.svelte';
  import { questbook } from './state.svelte';
  import { focusedQuestCamera, placementVisible, questBounds, questEdges } from './layout';
  import { plainQuestText } from './text';
  import type { QuestChapter } from './types';
  import type { QuestRepository } from './repository';
  let {
    chapter,
    repository,
    preview,
    focusQuest,
    activate,
    clearPreview,
    pointerKind,
  }: {
    chapter: QuestChapter;
    repository: QuestRepository;
    preview: (id: string, event: PointerEvent) => void;
    focusQuest: (id: string, event: FocusEvent) => void;
    activate: (id: string, event: MouseEvent) => void;
    clearPreview: () => void;
    pointerKind: (event: PointerEvent) => void;
  } = $props();
  let container: HTMLElement;
  let fullscreenRoot: HTMLElement;
  let manualFullscreen = $state(false);
  let landscape = $state(false);
  let landscapeDismissed = $state(false);
  const fullscreen = $derived(manualFullscreen || (landscape && !landscapeDismissed));
  async function toggleFullscreen() {
    clearPreview();
    const entering = !fullscreen;
    manualFullscreen = entering;
    landscapeDismissed = !entering;
    trackEvent('quest_map_fullscreen', { enabled: entering, trigger: 'button' });
    fullscreenRoot = container.closest<HTMLElement>('.app-shell') ?? container;
    if (!entering && document.fullscreenElement === fullscreenRoot) await document.exitFullscreen();
    else if (entering && fullscreenRoot.requestFullscreen) {
      try {
        await fullscreenRoot.requestFullscreen();
      } catch {
        /* Full-viewport layout works without browser fullscreen support. */
      }
    }
  }
  onMount(() => {
    const orientation = window.matchMedia(
      '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)',
    );
    const changed = () => {
      landscape = orientation.matches;
      landscapeDismissed = false;
      clearPreview();
      if (landscape) trackEvent('quest_map_fullscreen', { enabled: true, trigger: 'landscape' });
    };
    const fullscreenChanged = () => {
      if (!document.fullscreenElement && manualFullscreen) {
        manualFullscreen = false;
        landscapeDismissed = true;
      }
    };
    changed();
    orientation.addEventListener('change', changed);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    return () => {
      orientation.removeEventListener('change', changed);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      if (document.fullscreenElement === fullscreenRoot)
        void document.exitFullscreen().catch(() => {});
    };
  });
  let element: HTMLDivElement;
  let width = $state(0),
    height = $state(0);
  let camera = $state({ x: 0, y: 0, zoom: 1 });
  let initialized = $state(false),
    dragging = $state(false);
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let suppressClickUntil = 0;
  const bounds = $derived(questBounds(chapter));
  const edges = $derived(questEdges(chapter, repository.quests));
  let previousWidth = 0,
    previousHeight = 0;
  $effect(() => {
    if (!width || !height) return;
    if (!initialized) {
      camera = questbook.cameras.get(chapter.id) ?? fitted();
      initialized = true;
    } else if (previousWidth && previousHeight) {
      untrack(() => {
        camera = {
          ...camera,
          x: camera.x + (width - previousWidth) / 2,
          y: camera.y + (height - previousHeight) / 2,
        };
      });
    }
    previousWidth = width;
    previousHeight = height;
  });
  $effect(() => {
    if (initialized) questbook.cameras.set(chapter.id, { ...camera });
  });
  let highlighted = $state('');
  $effect(() => {
    const request = questbook.focusRequest;
    if (!request || request.chapterId !== chapter.id || !width || !height) return;
    const placement = chapter.quests.find((placement) => placement.id === request.id);
    if (!placement) return;
    camera = focusedQuestCamera(placement, width, height);
    highlighted = request.id;
    questbook.focusRequest = undefined;
  });
  $effect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => (highlighted = ''), 3500);
    return () => clearTimeout(timer);
  });
  function fitted() {
    const zoom = Math.max(
      0.15,
      Math.min(2, (width - 48) / bounds.width, (height - 48) / bounds.height),
    );
    return {
      zoom,
      x: (width - bounds.width * zoom) / 2 - bounds.minX * zoom,
      y: (height - bounds.height * zoom) / 2 - bounds.minY * zoom,
    };
  }
  function zoomTo(next: number, x = width / 2, y = height / 2) {
    const zoom = Math.max(0.15, Math.min(4, next));
    camera = {
      x: x - ((x - camera.x) * zoom) / camera.zoom,
      y: y - ((y - camera.y) * zoom) / camera.zoom,
      zoom,
    };
    clearPreview();
  }
  function wheelZoom(node: HTMLElement) {
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomTo(
        camera.zoom * Math.exp(-event.deltaY * 0.002),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', wheel) };
  }
  function down(event: PointerEvent) {
    pointerKind(event);
    if (event.button !== 0) return;
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    if (pointers.size > 1) {
      dragging = true;
      clearPreview();
    }
  }
  function move(event: PointerEvent) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    const previous = [...pointers.values()].map((p) => ({ ...p }));
    if (!dragging && Math.hypot(event.clientX - point.startX, event.clientY - point.startY) <= 10)
      return;
    dragging = true;
    clearPreview();
    element.setPointerCapture(event.pointerId);
    const dx = event.clientX - point.x,
      dy = event.clientY - point.y;
    point.x = event.clientX;
    point.y = event.clientY;
    const current = [...pointers.values()];
    if (current.length === 2) {
      const before = Math.hypot(previous[0].x - previous[1].x, previous[0].y - previous[1].y);
      const after = Math.hypot(current[0].x - current[1].x, current[0].y - current[1].y);
      const rect = element.getBoundingClientRect();
      const x = (current[0].x + current[1].x) / 2 - rect.left,
        y = (current[0].y + current[1].y) / 2 - rect.top;
      if (before > 0) zoomTo((camera.zoom * after) / before, x, y);
      camera = { ...camera, x: camera.x + dx / 2, y: camera.y + dy / 2 };
    } else camera = { ...camera, x: camera.x + dx, y: camera.y + dy };
  }
  function up(event: PointerEvent) {
    if (dragging) suppressClickUntil = Date.now() + 500;
    pointers.delete(event.pointerId);
    if (!pointers.size) dragging = false;
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && fullscreen) {
      void toggleFullscreen();
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [48, 0],
      ArrowRight: [-48, 0],
      ArrowUp: [0, 48],
      ArrowDown: [0, -48],
    };
    const delta = moves[event.key];
    if (delta) {
      event.preventDefault();
      camera = { ...camera, x: camera.x + delta[0], y: camera.y + delta[1] };
      clearPreview();
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomTo(camera.zoom * 1.25);
    }
    if (event.key === '-') {
      event.preventDefault();
      zoomTo(camera.zoom / 1.25);
    }
    if (event.key === '0') {
      event.preventDefault();
      camera = fitted();
      clearPreview();
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && fullscreen && event.target !== element) void toggleFullscreen();
  }}
/>

<section
  class="quest-canvas-area"
  class:fullscreen
  bind:this={container}
  aria-label={`${plainQuestText(chapter.name)} quest layout`}
>
  <div class="canvas-tools" role="group" aria-label="Quest map controls">
    <button
      class="mc-button map-control"
      title="Zoom out"
      aria-label="Zoom out"
      onclick={() => zoomTo(camera.zoom / 1.25)}
      ><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg></button
    >
    <button
      class="mc-button map-control"
      title="Zoom in"
      aria-label="Zoom in"
      onclick={() => zoomTo(camera.zoom * 1.25)}
      ><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4v12" /></svg></button
    >
    <button
      class="mc-button map-control"
      title={`Fit chapter · ${Math.round(camera.zoom * 100)}%`}
      aria-label="Fit chapter"
      onclick={() => {
        camera = fitted();
        clearPreview();
      }}
      ><svg viewBox="0 0 20 20" aria-hidden="true"
        ><path d="M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4M7 10h6m-3-3v6" /></svg
      ></button
    >
    <button
      class="mc-button map-control"
      title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      aria-pressed={fullscreen}
      onclick={toggleFullscreen}
      ><svg viewBox="0 0 20 20" aria-hidden="true"
        ><path
          d={fullscreen
            ? 'M3 7h4V3m6 0v4h4m0 6h-4v4m-6 0v-4H3'
            : 'M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4'}
        /></svg
      ></button
    >
  </div>
  <small class="canvas-legend"><i></i>Direct <i class="implicit"></i>Implicit</small>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (The map implements pan/zoom keyboard controls and contains native quest buttons.) -->
  <div
    class="quest-canvas"
    class:dragging
    bind:this={element}
    bind:clientWidth={width}
    bind:clientHeight={height}
    role="application"
    tabindex="0"
    aria-label="Quest map. Drag to pan, scroll or pinch to zoom. Arrow keys pan; plus and minus zoom; zero fits."
    use:wheelZoom
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
  >
    <div
      class="quest-world"
      style:transform={`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}
    >
      <svg
        class="quest-connections"
        aria-hidden="true"
        width={bounds.width}
        height={bounds.height}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        style:left={`${bounds.minX}px`}
        style:top={`${bounds.minY}px`}
      >
        {#each edges as edge (edge.id)}
          <g
            class:implicit={edge.type === 'implicit'}
            transform={`translate(${edge.x},${edge.y}) rotate(${edge.angle})`}
          >
            <line x1="0" y1="0" x2={edge.length} y2="0" stroke-width={edge.width} />
            <path d={edge.arrows} />
          </g>
        {/each}
      </svg>
      {#each chapter.quests as placement (placement.id)}
        {@const quest = repository.quests.get(placement.id)!}
        {#if placementVisible(placement, camera.x, camera.y, camera.zoom, width, height)}
          <button
            class="quest-node"
            class:main-quest={quest.main}
            class:secret={quest.secret}
            class:located={highlighted === quest.id}
            data-quest={quest.id}
            aria-label={`${plainQuestText(quest.name)}${quest.secret ? ' (Secret quest)' : ''}`}
            style:left={`${placement.x}px`}
            style:top={`${placement.y}px`}
            style:width={`${placement.width}px`}
            style:height={`${placement.height}px`}
            style:--quest-frame={`url('${new URL(`${import.meta.env.BASE_URL}quests/assets/quest-${quest.main ? 'main' : 'normal'}-${placement.width}x${placement.height}.png`, location.href).href}')`}
            style:--quest-highlight-frame={`url('${new URL(`${import.meta.env.BASE_URL}quests/assets/quest-${quest.main ? 'main' : 'normal'}-highlight-${placement.width}x${placement.height}.png`, location.href).href}')`}
            onpointerenter={(event) => {
              if (!dragging) preview(quest.id, event);
            }}
            onpointermove={(event) => {
              if (!dragging) preview(quest.id, event);
            }}
            onpointerleave={(event) => {
              if (event.pointerType !== 'touch') clearPreview();
            }}
            onfocus={(event) => focusQuest(quest.id, event)}
            onblur={clearPreview}
            oncontextmenu={(event) => event.preventDefault()}
            onclick={(event) => {
              if (Date.now() > suppressClickUntil) activate(quest.id, event);
            }}
          >
            <QuestIcon
              entry={repository.items.get(quest.icon.goodsId)}
              entries={repository.items}
              size={Math.max(8, Math.min(placement.width, placement.height) - 8)}
              renderScale={camera.zoom > 2 ? 4 : 2}
            />
            {#if quest.secret}<img
                class="secret-mark"
                src={`${import.meta.env.BASE_URL}quests/assets/secret-eye.png`}
                alt=""
                aria-hidden="true"
                draggable="false"
              />{/if}
          </button>
        {/if}
      {/each}
    </div>
  </div>
  <p class="canvas-hint">Drag to pan · Scroll or pinch to zoom</p>
</section>

<style>
  .quest-canvas-area {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    position: relative;
    overflow: hidden;
    background-color: #111214;
    background-image: var(--page-background);
  }
  .quest-canvas-area.fullscreen {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100dvh;
    z-index: 30;
  }
  .canvas-tools {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    display: flex;
    gap: 3px;
    align-items: center;
  }
  .canvas-tools svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .canvas-legend {
    position: absolute;
    left: 10px;
    bottom: 8px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 6px;
    background: #111214cc;
    border-radius: 2px;
    color: #9b9fa5;
    font-size: 10px;
    pointer-events: none;
  }
  i {
    width: 14px;
    height: 3px;
    background: #58a94a;
  }
  i.implicit {
    height: 2.25px;
    background: #777;
    margin-left: 8px;
  }
  .quest-canvas {
    flex: 1;
    min-height: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
    cursor: grab;
    touch-action: none;
    user-select: none;
    outline-offset: -3px;
  }
  .quest-canvas.dragging {
    cursor: grabbing;
  }
  .quest-world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .quest-connections {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }
  line {
    stroke: #58a94a;
  }
  .implicit line {
    stroke: #777;
  }
  .quest-connections path {
    fill: #000;
    opacity: 0.25;
  }
  .quest-node {
    position: absolute;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .quest-node::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: var(--quest-frame);
    background-size: 100% 100%;
    image-rendering: pixelated;
    filter: brightness(0.5);
    pointer-events: none;
  }
  .quest-node.located::before {
    background-image: var(--quest-highlight-frame);
    animation: quest-locate-pulse 700ms ease-in-out 5;
    filter: brightness(1);
  }
  @keyframes quest-locate-pulse {
    0%,
    100% {
      filter: brightness(1);
    }
    50% {
      filter: brightness(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .quest-node.located::before {
      animation: none;
    }
  }
  .quest-node :global(.quest-icon) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .quest-node:hover,
  .quest-node:focus-visible {
    filter: brightness(1.25);
  }
  .quest-node:focus-visible {
    outline: 1px solid #d6dce8;
    outline-offset: 2px;
  }
  .secret-mark {
    position: absolute;
    right: -5px;
    top: -7px;
    width: 12px;
    height: 12px;
    image-rendering: pixelated;
    filter: drop-shadow(1px 1px #000);
  }
  .canvas-hint {
    position: absolute;
    right: 10px;
    bottom: 8px;
    z-index: 2;
    margin: 0;
    padding: 4px 6px;
    color: #858c94;
    background: #111214cc;
    font-size: 10px;
    pointer-events: none;
  }
  @media (max-width: 600px), (max-height: 500px) {
    .canvas-hint {
      display: none;
    }
  }
</style>
