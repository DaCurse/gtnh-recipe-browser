import { describe, expect, it } from 'vitest';
import {
  catalogSearchFromUrl,
  catalogSearchUrl,
  itemListUrl,
  recipeFilterFromUrl,
  recipeFilterUrl,
  recipeViewFromUrl,
  recipeViewUrlValue,
  specialNavigationFromUrl,
  specialNavigationUrl
} from '../src/lib/navigation';

describe('catalog search navigation', () => {
  it('round-trips the sidebar filter through the shareable search parameter', () => {
    const url = catalogSearchUrl(
      'https://example.test/browser/?item=i%3Atest&view=recipes',
      'iron @gregtech'
    );

    expect(url.searchParams.get('search')).toBe('iron @gregtech');
    expect(catalogSearchFromUrl(url)).toBe('iron @gregtech');
  });

  it('removes the sidebar filter when it is cleared', () => {
    const url = catalogSearchUrl(
      'https://example.test/browser/?search=iron&version=2.9.0',
      '  '
    );

    expect(url.searchParams.has('search')).toBe(false);
    expect(catalogSearchFromUrl(url)).toBe('');
  });
});

describe('recipe filter navigation', () => {
  it('round-trips the local active-tab filter independently of catalog search', () => {
    const url = recipeFilterUrl(
      'https://example.test/browser/?search=iron&item=i%3Atest&view=recipes',
      'dust @gregtech'
    );

    expect(url.searchParams.get('search')).toBe('iron');
    expect(url.searchParams.get('recipe-filter')).toBe('dust @gregtech');
    expect(recipeFilterFromUrl(url)).toBe('dust @gregtech');
  });

  it('removes the local filter without removing the catalog search', () => {
    const url = recipeFilterUrl(
      'https://example.test/browser/?search=iron&recipe-filter=dust',
      ' '
    );

    expect(url.searchParams.has('recipe-filter')).toBe(false);
    expect(url.searchParams.get('search')).toBe('iron');
  });
});

describe('item-list navigation', () => {
  it('removes item selection without discarding unrelated query state', () => {
    const url = itemListUrl(
      'https://example.test/browser/?item=i%3Agregtech%3Aafsu&view=recipes&search=iron&recipe-filter=dust&version=2.8.0#catalog'
    );

    expect(url.href).toBe('https://example.test/browser/?search=iron&version=2.8.0#catalog');
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
