import { readable } from 'svelte/store';

/** A shared, deliberately slower ore-dictionary icon cycle for readable tooltips. */
export const oreCycle = readable(0, (set) => {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let index = 0;
  const timer = window.setInterval(() => set(++index), 1_200);
  return () => window.clearInterval(timer);
});
