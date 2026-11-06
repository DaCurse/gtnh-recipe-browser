import type { ProgressDirection, UiWidget } from './machineUi';

// GTNEIDefaultHandler.PROGRESSBAR_CYCLE_TICKS = 200, at 20 ticks/second.
export const RECIPE_ANIMATION_MS = 10_000;

export function progressClip(direction: ProgressDirection, value: number, imageSize: number): string {
  const bounded = Math.max(0, Math.min(1, value));
  const progress = direction === 'CIRCULAR_CW' || bounded === 1 ? bounded : Math.floor(bounded * imageSize) / imageSize;
  const remaining = Number(((1-progress)*100).toFixed(5));
  switch (direction) {
    case 'LEFT': return `inset(0 0 0 ${remaining}%)`;
    case 'UP': return `inset(${remaining}% 0 0 0)`;
    case 'DOWN': return `inset(0 0 ${remaining}% 0)`;
    case 'CIRCULAR_CW': {
      // ModularUI fills four rectangular quadrants: BL up, TL right, TR
      // down, BR left. A radial/conic wipe would cut its pixels differently.
      const quarter = Math.min(3, Math.floor(progress*4));
      const part = Math.floor(Math.min(1, progress*4-quarter)*imageSize)/imageSize;
      const extent = Number((part*50).toFixed(5));
      if (quarter === 0) return `inset(${100-extent}% 50% 0 0)`;
      if (quarter === 1) return `polygon(0 100%,50% 100%,50% 50%,${extent}% 50%,${extent}% 0,0 0)`;
      if (quarter === 2) return `polygon(0 100%,50% 100%,50% ${extent}%,100% ${extent}%,100% 0,0 0)`;
      return `polygon(0 100%,50% 100%,50% 50%,${100-extent}% 50%,${100-extent}% 100%,100% 100%,100% 0,0 0)`;
    }
    default: return `inset(0 ${remaining}% 0 0)`;
  }
}

export function recipeProgressFrames(widget: UiWidget): Keyframe[] {
  const points = widget.progress ?? [[0,0],[1,1]];
  const frames: Keyframe[] = [];
  let segment = 0;
  for (let tick = 0; tick <= 200; tick++) {
    const offset = tick/200;
    while (segment < points.length-2 && offset > points[segment+1]![0]) segment++;
    const [start,value] = points[segment]!;
    const [end,next] = points[Math.min(segment+1, points.length-1)]!;
    const progress = value + (next-value) * (end === start ? 0 : (offset-start)/(end-start));
    const clipPath = progressClip(widget.direction ?? 'RIGHT', progress, Math.max(1, widget.imageSize ?? widget.size[0]));
    if (tick === 200 || frames.at(-1)?.clipPath !== clipPath) frames.push({ offset, clipPath, easing:'steps(1, end)' });
  }
  return frames;
}
