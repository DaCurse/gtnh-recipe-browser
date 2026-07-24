import { describe, expect, it } from 'vitest';
import {
  itemListUrl,
  recipeViewFromUrl,
  recipeViewUrlValue
} from '../src/lib/navigation';

describe('item-list navigation', () => {
  it('removes item selection without discarding unrelated query state', () => {
    const url = itemListUrl(
      'https://example.test/browser/?item=i%3Agregtech%3Aafsu&view=recipes&version=2.8.0#catalog'
    );

    expect(url.href).toBe('https://example.test/browser/?version=2.8.0#catalog');
  });

  it('is stable when the item list is already open', () => {
    expect(itemListUrl('https://example.test/browser/?version=2.8.0').href)
      .toBe('https://example.test/browser/?version=2.8.0');
  });
});

describe('recipe-view navigation', () => {
  it('round-trips every supported view through the URL representation', () => {
    expect(recipeViewFromUrl(recipeViewUrlValue('recipes'))).toBe('recipes');
    expect(recipeViewFromUrl(recipeViewUrlValue('usages'))).toBe('usages');
    expect(recipeViewFromUrl(recipeViewUrlValue('machineUsages'))).toBe('machineUsages');
  });

  it('falls back to recipes for missing or unknown URL values', () => {
    expect(recipeViewFromUrl(null)).toBe('recipes');
    expect(recipeViewFromUrl('unknown')).toBe('recipes');
  });
});
