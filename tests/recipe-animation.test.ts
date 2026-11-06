import { describe, expect, it } from 'vitest';
import { progressClip, recipeProgressFrames, RECIPE_ANIMATION_MS } from '../src/lib/recipeAnimation';
import { machineUiProfiles } from '../src/lib/machineUi';

describe('native NEI progress animation', () => {
  it('clips source pixels in the declared fill direction and clamps split suppliers', () => {
    expect(progressClip('RIGHT', 0.28, 20)).toBe('inset(0 75% 0 0)');
    expect(progressClip('LEFT', 0.5, 20)).toBe('inset(0 0 0 50%)');
    expect(progressClip('UP', 0.5, 20)).toBe('inset(50% 0 0 0)');
    expect(progressClip('DOWN', 0.5, 20)).toBe('inset(0 0 50% 0)');
    expect(progressClip('RIGHT', -1, 20)).toBe('inset(0 100% 0 0)');
    expect(progressClip('RIGHT', 2, 20)).toBe('inset(0 0% 0 0)');
  });
  it('fills circular bars in ModularUI quadrants instead of a radial pie', () => {
    expect(progressClip('CIRCULAR_CW', 0.125, 20)).toBe('inset(75% 50% 0 0)');
    expect(progressClip('CIRCULAR_CW', 0.375, 20)).toContain('25% 50%');
    expect(progressClip('CIRCULAR_CW', 0.625, 20)).toContain('100% 25%');
  });
  it('keeps assembly line bars on one cycle with their source split timing', () => {
    const bars = machineUiProfiles.find(profile => profile.id === 'gt.recipe.fakeAssemblylineProcess')!.widgets.filter(widget => widget.filled);
    expect(RECIPE_ANIMATION_MS).toBe(10_000);
    expect(bars).toHaveLength(3);
    const first = recipeProgressFrames(bars[0]!);
    const second = recipeProgressFrames(bars[1]!);
    expect(first.find(frame => frame.clipPath === 'inset(0 0% 0 0)')!.offset).toBeLessThan(0.5);
    expect(second.find(frame => frame.clipPath !== 'inset(0 100% 0 0)')!.offset).toBeGreaterThan(0.5);
    expect(bars[2]!.direction).toBe('UP');
  });
});
