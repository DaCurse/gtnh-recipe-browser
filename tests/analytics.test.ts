import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ capture: vi.fn(), init: vi.fn() }));
vi.mock('posthog-js/dist/module.slim', () => ({ default: sdk }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubEnv('PROD', true);
  vi.stubGlobal('location', new URL('https://gtnh-recipes.netlify.app/?page=finder&finder-mode=chain&input=private&search=secret#raw'));
  vi.stubGlobal('navigator', { doNotTrack: null });
  vi.stubGlobal('requestIdleCallback', undefined);
  sdk.init.mockImplementation((_key, config) => config.loaded(sdk));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('focused analytics', () => {
  it('removes free text, exact selections, and fragments while keeping the navigation category', async () => {
    const { analyticsUrl, analyticsSearch } = await import('../src/lib/analytics');
    expect(analyticsUrl(location.href)).toBe('https://gtnh-recipes.netlify.app/?page=finder&finder-mode=chain');
    expect(analyticsUrl('https://site.test/?item=nbt&view=usages&recipe-filter=secret')).toBe('https://site.test/?view=usages');
    expect(analyticsUrl('bad-url')).toBe('');
    expect(analyticsSearch('  IRON   Dust  ')).toBe('iron dust');
    expect(analyticsSearch('x'.repeat(200))).toHaveLength(120);
  });
  it('queues early completed events and loads the SDK without blocking callers', async () => {
    const { trackEvent } = await import('../src/lib/analytics');
    trackEvent('chain_search_completed', { duration_ms: 123, route_count: 8, invalid: Infinity });
    expect(sdk.init).not.toHaveBeenCalled();
    await vi.runAllTimersAsync(); await vi.dynamicImportSettled();
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.capture).toHaveBeenCalledWith('chain_search_completed', {
      duration_ms: 123, route_count: 8, $current_url: 'https://gtnh-recipes.netlify.app/?page=finder&finder-mode=chain'
    });
    const config = sdk.init.mock.calls[0]![1];
    expect(config).toMatchObject({ api_host: 'https://us.i.posthog.com', autocapture: false,
      capture_pageview: false, capture_pageleave: false, disable_session_recording: true,
      disable_external_dependency_loading: true, advanced_disable_flags: true, person_profiles: 'never' });
    const event = { event: '$pageview', properties: { $current_url: location.href, $session_entry_url: location.href,
      $referrer: 'https://example.test/private?secret=1', $set_once: { raw: 'secret' } } };
    expect(config.before_send(event).properties).toEqual({
      $current_url: 'https://gtnh-recipes.netlify.app/?page=finder&finder-mode=chain',
      $session_entry_url: 'https://gtnh-recipes.netlify.app/?page=finder&finder-mode=chain', $referrer: 'https://example.test'
    });
    expect(config.before_send({ event: '$autocapture', properties: {} })).toBeNull();
  });
  it('does not initialize or capture on previews, local development, DNT, or GPC', async () => {
    for (const [url, production, navigator] of [
      ['https://preview.netlify.app/', true, {}], ['http://localhost:5173/', true, {}],
      ['https://gtnh-recipes.netlify.app/', false, {}],
      ['https://gtnh-recipes.netlify.app/', true, { doNotTrack: '1' }],
      ['https://gtnh-recipes.netlify.app/', true, { globalPrivacyControl: true }]
    ] as const) {
      vi.stubGlobal('location', new URL(url)); vi.stubGlobal('navigator', navigator); vi.stubEnv('PROD', production);
      const { initializeAnalytics, trackEvent } = await import('../src/lib/analytics');
      initializeAnalytics(); trackEvent('$pageview'); await vi.runAllTimersAsync(); await vi.dynamicImportSettled();
    }
    expect(sdk.init).not.toHaveBeenCalled(); expect(sdk.capture).not.toHaveBeenCalled();
  });
  it('contains SDK initialization and capture failures so browsing stays usable', async () => {
    sdk.init.mockImplementationOnce(() => { throw new Error('blocked'); });
    const { initializeAnalytics, trackEvent } = await import('../src/lib/analytics');
    initializeAnalytics(); await vi.runAllTimersAsync(); await vi.dynamicImportSettled();
    expect(() => trackEvent('dataset_loaded', { duration_ms: 1 })).not.toThrow();
    expect(sdk.init).toHaveBeenCalledOnce();
  });
});
