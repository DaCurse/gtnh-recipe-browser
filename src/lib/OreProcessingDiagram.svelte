<script lang="ts">
  import { ItemTouch, openItemActions } from './itemTouch.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import { oreCycle } from './oreCycle';
  import { oreArrowRects, oreLineRect, oreSceneBounds, type OreScene, type OreComponent } from './oreDiagram';
  import { machineUiAsset, RECIPE_UI_SCALE } from './machineUi';
  import type { CatalogEntry, RecipeView } from './types';
  import type { SpecialResolver } from './specialData';
  let { scene, resolve, navigate }: {
    scene: OreScene; resolve: SpecialResolver; navigate: (id: string, view: RecipeView) => void;
  } = $props();
  const scale = RECIPE_UI_SCALE;
  const touch = new ItemTouch();
  const bounds = $derived(oreSceneBounds(scene));
  let tooltip = $state<{ entry: CatalogEntry; notes: string[]; machine: boolean }>();
  let x = $state(0), y = $state(0);
  function show(event: PointerEvent | FocusEvent, entry: CatalogEntry, notes: string[], machine = false) {
    if (event instanceof PointerEvent) {
      if (event.pointerType === 'touch') return;
      x = event.clientX; y = event.clientY;
    } else {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); x = rect.right; y = rect.bottom;
    }
    tooltip = { entry, notes, machine };
  }
  function move(event: PointerEvent) { if (tooltip) { x = event.clientX; y = event.clientY; } }
  function amount(component: OreComponent, fluid: boolean) {
    if (component.amount === undefined || (component.amount === 1 && !fluid)) return '';
    return `${component.amount}${fluid ? 'L' : ''}`;
  }
</script>

<section class="native-ore-diagram" aria-label="Ore processing diagram">
  <div class="diagram-scroll">
    <div class="diagram-canvas" style:width={`${bounds.width * scale}px`} style:height={`${bounds.height * scale}px`}>
      <svg class="diagram-background" viewBox={`0 0 ${bounds.width} ${bounds.height}`} aria-hidden="true">
        {#each scene.paths as path, index (index)}
          <rect class="diagram-segment" {...oreLineRect(path.a, path.b)} />
          {#if path.arrow}
            {#each oreArrowRects(path.a, path.b) as rect, index (index)}<rect class="diagram-arrowhead" {...rect} />{/each}
          {/if}
        {/each}
        {#each scene.slots as slot, index (index)}
          <image href={machineUiAsset(slot.size === 26 ? 'ore-slot-big.png' : 'ore-slot.png')}
            x={slot.pos[0] - slot.size / 2} y={slot.pos[1] - slot.size / 2} width={slot.size} height={slot.size}>
            <title>{slot.notes.join(' · ')}</title>
          </image>
        {/each}
      </svg>
      {#each scene.groups as group, index (index)}
        {@const frozen = touch.frozen(`group:${index}`)}
        {@const component = (frozen ? group.components.find((component) => component.id === frozen.id) : undefined) ?? group.components[$oreCycle % group.components.length]!}
        {@const entry = frozen ?? resolve(component.id)}
        {#if entry}
          <button class="diagram-item" data-goods-id={component.id} aria-label={entry.name}
            use:touch.action={{ key: `group:${index}`, entry, activate: (item) => navigate(item.id, 'recipes'),
              navigate, notes: [...group.notes, ...component.notes], clearHover: () => tooltip = undefined }}
            style:left={`${(group.pos[0] - 9) * scale}px`} style:top={`${(group.pos[1] - 9) * scale}px`}
            style:width={`${18 * scale}px`} style:height={`${18 * scale}px`}
            onpointerenter={event => show(event, entry, [...group.notes, ...component.notes])}
            onpointermove={move} onpointerleave={() => tooltip = undefined}
            onfocus={event => show(event, entry, [...group.notes, ...component.notes])} onblur={() => tooltip = undefined}
            onclick={() => navigate(component.id, 'recipes')}
            oncontextmenu={event => { event.preventDefault(); navigate(component.id, 'usages'); }}>
            <ItemIcon {entry} size={18 * scale} frame={false} />
            {#if amount(component, entry.kind === 'fluid')}
              <span class="diagram-amount" class:fluid={entry.kind === 'fluid'} style:font-size={`${Math.max(9, (component.amount! >= 100 ? 3.375 : 6.75) * scale)}px`}>{amount(component, entry.kind === 'fluid')}</span>
            {/if}
            {#if component.info}<span class="diagram-info" style:font-size={`${Math.max(9, 3.375 * scale)}px`}>{component.info}</span>{/if}
          </button>
        {/if}
      {/each}
      {#each scene.labels as label, index (index)}
        {@const entry = resolve(label.id)}
        {#if entry}
          <button class="diagram-item diagram-machine" aria-label={label.notes.join(' · ') || entry.name}
            use:touch.action={{ key: `machine:${index}`, entry, activate: (item) => navigate(item.id, 'machineUsages'),
              hold: (item) => openItemActions(item, (id, view) => navigate(id, view === 'usages' ? 'machineUsages' : view), 'Machine Usages'),
              notes: label.notes, clearHover: () => tooltip = undefined }}
            style:left={`${(label.pos[0] - 9) * scale}px`} style:top={`${(label.pos[1] - 9) * scale}px`}
            style:width={`${18 * scale}px`} style:height={`${18 * scale}px`}
            onpointerenter={event => show(event, entry, label.notes, true)} onpointermove={move} onpointerleave={() => tooltip = undefined}
            onfocus={event => show(event, entry, label.notes, true)} onblur={() => tooltip = undefined}
            onclick={() => navigate(label.id, 'machineUsages')}
            oncontextmenu={event => { event.preventDefault(); navigate(label.id, 'recipes'); }}>
            <ItemIcon {entry} size={18 * scale} frame={false} />
          </button>
        {/if}
      {/each}
    </div>
  </div>
</section>
{#if tooltip}
  <FloatingCatalogTooltip entry={tooltip.entry} {x} {y} notes={tooltip.notes}
    action={tooltip.machine ? 'Click: Machine usages · Right-click: Recipes' : 'Left-click: Recipes · Right-click: Usages'} />
{/if}

<style>
  .diagram-scroll { max-width:100%; overflow-x:auto; scrollbar-width:thin; }
  .diagram-canvas { position:relative; margin:auto; }
  .diagram-background { position:absolute; inset:0; width:100%; height:100%; image-rendering:pixelated; pointer-events:none; }
  .diagram-background rect { fill:#bfbfbf; shape-rendering:crispEdges; }
  .diagram-item { position:absolute; isolation:isolate; padding:0; border:0; background:none; cursor:pointer; }
  .diagram-item:hover,.diagram-item:focus-visible { background:#ffffff15; }
  .diagram-item:focus-visible { outline:1px solid #bfbfbf; }
  .diagram-amount,.diagram-info { position:absolute; z-index:1; pointer-events:none; font-family:Minecraft,monospace; line-height:1; color:white; text-shadow:1px 1px #222; white-space:nowrap; }
  .diagram-amount { right:1px; bottom:1px; }
  .diagram-amount.fluid { right:auto; left:1px; }
  .diagram-info { top:1px; left:1px; color:#ffff55; }
</style>
