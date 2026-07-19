import { describe, expect, it } from 'vitest';
import { itemListUrl } from '../src/lib/navigation';

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
