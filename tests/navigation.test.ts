import { describe, expect, it } from 'vitest';
import {
  itemListUrl,
  recipeViewFromUrl,
  recipeViewUrlValue,
  specialNavigationFromUrl,
  specialNavigationUrl
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

describe('special-view navigation', () => {
  it('round-trips item and global special scopes', () => {
    const global = specialNavigationUrl(
      'https://example.test/browser/?item=i%3Atest&view=recipes',
      'meteor-ritual',
      'all'
    );
    expect(global.searchParams.get('special')).toBe('meteor-ritual');
    expect(global.searchParams.get('special-scope')).toBe('all');
    expect(specialNavigationFromUrl(global)).toEqual({
      specialType: 'meteor-ritual',
      specialScope: 'all'
    });

    const item = specialNavigationUrl(global, 'meteor-ritual', 'item');
    expect(item.searchParams.has('special-scope')).toBe(false);
    expect(specialNavigationFromUrl(item).specialScope).toBe('item');
  });

  it('clears both special parameters when the special context ends', () => {
    const url = specialNavigationUrl(
      'https://example.test/browser/?special=meteor-ritual&special-scope=all',
      ''
    );
    expect(url.searchParams.has('special')).toBe(false);
    expect(url.searchParams.has('special-scope')).toBe(false);
    expect(specialNavigationFromUrl(url)).toEqual({ specialType: '', specialScope: 'item' });
  });
});
