import type { Action } from 'svelte/action';

/** Interior right-swipe navigation. Leave the OS/browser's edge gesture alone,
 * and let vertical scrolling and horizontal controls keep their own gestures. */
export const swipeBack: Action<HTMLElement, () => void> = (node, initialBack) => {
  let back = initialBack;
  let start: { id: number; x: number; y: number; time: number; distance: number } | undefined;
  let animation: Animation | undefined;
  let destroyed = false;
  let suppressClick = false;
  const previousTransform = node.style.transform,
    previousTouchAction = node.style.touchAction;
  const mobile = matchMedia('(max-width:800px)');
  const syncTouchAction = () => {
    node.style.touchAction = mobile.matches ? 'pan-y pinch-zoom' : previousTouchAction;
  };
  syncTouchAction();
  mobile.addEventListener('change', syncTouchAction);
  const reset = () => {
    node.style.transform = previousTransform;
    start = undefined;
  };
  const settle = (commit: boolean) => {
    const distance = start?.distance ?? 0;
    start = undefined;
    if (!distance) return;
    suppressClick = true;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    animation = node.animate(
      [
        { transform: `translateX(${distance}px)` },
        { transform: commit ? 'translateX(100%)' : previousTransform || 'translateX(0)' },
      ],
      { duration: reduced ? 0 : 140, easing: 'ease-out' },
    );
    void animation.finished
      .then(() => {
        if (!destroyed) {
          reset();
          if (commit) back();
        }
      })
      .catch(() => {});
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || innerWidth > 800) return;
    suppressClick = false;
    if (!event.isPrimary || start) {
      settle(false);
      return;
    }
    if (
      event.clientX < 24 ||
      !(event.target instanceof Element) ||
      event.target.closest(
        'button,a,input,select,textarea,dialog,[contenteditable="true"],[role="slider"]',
      )
    )
      return;
    for (
      let element: Element | null = event.target;
      element && element !== node;
      element = element.parentElement
    ) {
      if (
        element.scrollWidth > element.clientWidth + 2 &&
        /auto|scroll/.test(getComputedStyle(element).overflowX)
      )
        return;
    }
    animation?.cancel();
    start = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      distance: 0,
    };
  };
  const move = (event: PointerEvent) => {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x,
      dy = Math.abs(event.clientY - start.y);
    if (!start.distance && ((dy > 12 && dy > dx) || dx < -12)) {
      reset();
      return;
    }
    if (dx > 12 && dx > dy * 2) {
      start.distance = Math.min(dx, innerWidth);
      node.style.transform = `translateX(${start.distance}px)`;
    }
  };
  const up = (event: PointerEvent) => {
    if (!start || start.id !== event.pointerId) return;
    settle(
      start.distance >= Math.min(100, innerWidth * 0.23) && performance.now() - start.time < 1000,
    );
    start = undefined;
  };
  const cancel = () => settle(false);
  const click = (event: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', click, true);
  return {
    update(next) {
      back = next;
    },
    destroy() {
      destroyed = true;
      animation?.cancel();
      reset();
      node.style.touchAction = previousTouchAction;
      mobile.removeEventListener('change', syncTouchAction);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('click', click, true);
    },
  };
};
