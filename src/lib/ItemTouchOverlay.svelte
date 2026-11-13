<script lang="ts">
  import { onMount } from 'svelte';
  import FloatingCatalogTooltip from './FloatingCatalogTooltip.svelte';
  import ItemActionDialog from './ItemActionDialog.svelte';
  import {
    clearItemTouch,
    consumeItemTouchEvent,
    itemTouchState,
    loadItemTouchTutorial,
    resetItemTouchEvents,
  } from './itemTouch.svelte';

  const tutorialHint = $derived(
    [
      !itemTouchState.tutorial.opened ? 'Tap item again to open' : '',
      !itemTouchState.tutorial.held ? 'Hold for actions' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );

  onMount(() => {
    loadItemTouchTutorial();
    const outside = (event: PointerEvent) => {
      resetItemTouchEvents(event);
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        itemTouchState.session?.node.contains(target) ||
        (target instanceof Element && target.closest('.touch-tooltip'))
      )
        return;
      clearItemTouch();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.touch-tooltip')) return;
      clearItemTouch();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearItemTouch();
    };
    const leave = () => {
      clearItemTouch();
      itemTouchState.menu = undefined;
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('click', consumeItemTouchEvent, true);
    window.addEventListener('contextmenu', consumeItemTouchEvent, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('keydown', key);
    window.addEventListener('popstate', leave);
    window.addEventListener('resize', clearItemTouch);
    return () => {
      leave();
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('click', consumeItemTouchEvent, true);
      window.removeEventListener('contextmenu', consumeItemTouchEvent, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('popstate', leave);
      window.removeEventListener('resize', clearItemTouch);
    };
  });
</script>

{#if itemTouchState.session?.preview}
  <FloatingCatalogTooltip
    entry={itemTouchState.session.entry}
    x={itemTouchState.session.anchor.right}
    y={itemTouchState.session.anchor.bottom}
    anchor={itemTouchState.session.anchor}
    interactive
    notes={itemTouchState.session.notes}
    action={tutorialHint}
  />
{/if}
{#if itemTouchState.menu}
  <ItemActionDialog {...itemTouchState.menu} close={() => (itemTouchState.menu = undefined)} />
{/if}
