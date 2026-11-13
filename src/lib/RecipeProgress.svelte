<script lang="ts">
  import UiTexture from './UiTexture.svelte';
  import type { UiWidget } from './machineUi';
  import { recipeProgressFrames, RECIPE_ANIMATION_MS } from './recipeAnimation';
  let { widget }: { widget: UiWidget } = $props();
  let filled = $state<HTMLDivElement>();
  let animationState = $state('static');
  $effect(() => {
    if (!filled || !widget.filled) return;
    const element = filled;
    const frames = recipeProgressFrames(widget);
    if (!element.animate) {
      element.style.clipPath = String(frames[Math.floor(frames.length / 2)]!.clipPath);
      return;
    }
    const animation = element.animate(frames, {
      duration: RECIPE_ANIMATION_MS,
      iterations: Infinity,
    });
    animation.pause();
    let visible = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (reduced.matches) {
        animation.pause();
        animation.currentTime = RECIPE_ANIMATION_MS / 2;
        animationState = 'reduced-motion';
      } else if (!visible || document.hidden) {
        animation.pause();
        animationState = 'paused';
      } else {
        animation.play();
        // All bars, including an assembly line's split paths, share NEI's cycle.
        animation.startTime =
          Number(document.timeline.currentTime ?? 0) - (performance.now() % RECIPE_ANIMATION_MS);
        animationState = 'running';
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(element.parentElement ?? element);
    reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer.disconnect();
      animation.cancel();
      reduced.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  });
</script>

<div class="recipe-progress" aria-hidden="true" data-animation-state={animationState}>
  <UiTexture texture={widget.texture} />
  {#if widget.filled}<div class="filled" bind:this={filled}>
      <UiTexture texture={widget.filled} />
    </div>{/if}
</div>

<style>
  .recipe-progress {
    position: relative;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .filled {
    position: absolute;
    inset: 0;
    clip-path: inset(0 100% 0 0);
  }
</style>
