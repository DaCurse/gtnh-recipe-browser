import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ capture: vi.fn(), init: vi.fn() }));
vi.mock('posthog-js/dist/module.slim', () => ({ default: sdk }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('PROD', true);
  vi.stubGlobal(
    'location',
    new URL(
      'https://dacurse.github.io/gtnh-recipe-browser/?page=finder&finder-mode=chain&input=private&search=secret#raw',
    ),
  );
  vi.stubGlobal('navigator', { doNotTrack: null });
  vi.stubGlobal('requestIdleCallback', undefined);
  sdk.init.mockImplementation((_key, config) => config.loaded(sdk));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('focused analytics', () => {
  it('removes free text, exact selections, and fragments while keeping the navigation category', async () => {
    const { analyticsUrl, analyticsSearch } = await import('../src/lib/analytics');
    expect(analyticsUrl(location.href)).toBe(
      'https://dacurse.github.io/gtnh-recipe-browser/?page=finder&finder-mode=chain',
    );
    expect(analyticsUrl('https://site.test/?item=nbt&view=usages&recipe-filter=secret')).toBe(
      'https://site.test/?view=usages',
    );
    expect(analyticsUrl('bad-url')).toBe('');
    expect(
      analyticsUrl(
        'https://site.test/?page=quests&quest=q0&chapter=q1&quest-search=private&quest-version=2.9.0#raw',
      ),
    ).toBe('https://site.test/?page=quests');
    expect(analyticsSearch('  IRON   Dust  ')).toBe('iron dust');
    expect(analyticsSearch('x'.repeat(200))).toHaveLength(120);
  });
  it('keeps quest titles, chapter context and version readable across book and link events', async () => {
    const { questAnalyticsProperties } = await import('../src/lib/questbook/analytics');
    const { trackEvent } = await import('../src/lib/analytics');
    const quest = {
      id: 'q1',
      name: '§b[bold]Iron Hammer[/bold]',
      secret: false,
      tasks: [],
    } as unknown as import('../src/lib/questbook/types').Quest;
    const repository = {
      version: '2.9.0',
      quests: new Map([[quest.id, quest]]),
      items: new Map(),
      chaptersForQuest: () => [
        { id: 'chapter1', name: '§aStone Age' },
        { id: 'chapter2', name: '[bold]Steam Age[/bold]' },
      ],
    };
    for (const event of ['quest_viewed', 'quest_touch_preview', 'quest_link_opened'] as const) {
      trackEvent(event, questAnalyticsProperties(quest, repository));
    }
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    for (const [event, properties] of sdk.capture.mock.calls) {
      expect(event).toMatch(/^quest_/);
      expect(properties).toMatchObject({
        quest_id: 'q1',
        quest_name: 'Iron Hammer',
        chapter_id: 'chapter1',
        chapter_name: 'Stone Age',
        quest_version: '2.9.0',
      });
    }
    expect(sdk.capture).toHaveBeenCalledTimes(3);
    expect(questAnalyticsProperties(quest, repository, 'chapter2')).toMatchObject({
      chapter_id: 'chapter2',
      chapter_name: 'Steam Age',
    });
    expect(
      questAnalyticsProperties(quest, { ...repository, chaptersForQuest: () => [] }),
    ).not.toHaveProperty('chapter_name');
  });
  it('captures on the Pages project but excludes other projects on the same origin', async () => {
    const { trackEvent } = await import('../src/lib/analytics');
    vi.stubGlobal('location', new URL('https://dacurse.github.io/other/'));
    trackEvent('$pageview');
    await vi.runAllTimersAsync();
    expect(sdk.init).not.toHaveBeenCalled();
    vi.stubGlobal(
      'location',
      new URL('https://dacurse.github.io/gtnh-recipe-browser/?item=private'),
    );
    trackEvent('$pageview');
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    expect(sdk.capture).toHaveBeenCalledWith('$pageview', {
      $current_url: 'https://dacurse.github.io/gtnh-recipe-browser/',
    });
  });
  it('queues early completed events and loads the SDK without blocking callers', async () => {
    const { trackEvent } = await import('../src/lib/analytics');
    trackEvent('chain_search_completed', { duration_ms: 123, route_count: 8, invalid: Infinity });
    expect(sdk.init).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.capture).toHaveBeenCalledWith('chain_search_completed', {
      duration_ms: 123,
      route_count: 8,
      $current_url: 'https://dacurse.github.io/gtnh-recipe-browser/?page=finder&finder-mode=chain',
    });
    const config = sdk.init.mock.calls[0]![1];
    expect(config).toMatchObject({
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      capture_dead_clicks: false,
      rageclick: false,
      capture_heatmaps: false,
      capture_performance: false,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      person_profiles: 'never',
    });
    const event = {
      event: '$pageview',
      properties: {
        $current_url: location.href,
        $session_entry_url: location.href,
        $referrer: 'https://example.test/private?secret=1',
        $set_once: { raw: 'secret' },
      },
    };
    expect(config.before_send(event).properties).toEqual({
      $current_url: 'https://dacurse.github.io/gtnh-recipe-browser/?page=finder&finder-mode=chain',
      $session_entry_url:
        'https://dacurse.github.io/gtnh-recipe-browser/?page=finder&finder-mode=chain',
      $referrer: 'https://example.test',
    });
    expect(config.before_send({ event: '$autocapture', properties: {} })).toBeNull();
  });
  it('does not initialize or capture on previews, local development, DNT, or GPC', async () => {
    for (const [url, production, navigator] of [
      ['https://preview.netlify.app/', true, {}],
      ['http://localhost:5173/', true, {}],
      ['https://dacurse.github.io/gtnh-recipe-browser/', false, {}],
      ['https://dacurse.github.io/gtnh-recipe-browser/', true, { doNotTrack: '1' }],
      ['https://dacurse.github.io/gtnh-recipe-browser/', true, { globalPrivacyControl: true }],
    ] as const) {
      vi.stubGlobal('location', new URL(url));
      vi.stubGlobal('navigator', navigator);
      vi.stubEnv('PROD', production);
      const { initializeAnalytics, trackEvent } = await import('../src/lib/analytics');
      initializeAnalytics();
      trackEvent('$pageview');
      await vi.runAllTimersAsync();
      await vi.dynamicImportSettled();
    }
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });
  it('delivers the explicitly allowed quest, special-view and touch events', async () => {
    const { trackEvent } = await import('../src/lib/analytics');
    const names = [
      'questbook_loaded',
      'questbook_load_failed',
      'quest_version_changed',
      'quest_chapter_viewed',
      'quest_viewed',
      'quest_search',
      'quest_link_opened',
      'quest_touch_preview',
      'special_viewed',
      'item_touch_interaction',
      'item_action_selected',
    ] as const;
    for (const name of names) trackEvent(name, { result_count: 1 });
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    const config = sdk.init.mock.calls[0]![1];
    for (const name of names)
      expect(config.before_send({ event: name, properties: {} })?.event).toBe(name);
    expect(sdk.capture.mock.calls.map(([name]) => name)).toEqual(names);
  });

  it('contains SDK initialization failures so browsing stays usable', async () => {
    sdk.init.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    const { initializeAnalytics, trackEvent } = await import('../src/lib/analytics');
    initializeAnalytics();
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    expect(() => trackEvent('dataset_loaded', { duration_ms: 1 })).not.toThrow();
    expect(sdk.init).toHaveBeenCalledOnce();
  });

  it('discards queued events when privacy preferences change before idle startup', async () => {
    const { trackEvent } = await import('../src/lib/analytics');
    trackEvent('$pageview');
    vi.stubGlobal('navigator', { globalPrivacyControl: true });
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    expect(sdk.init).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { globalPrivacyControl: false });
    trackEvent('dataset_loaded');
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    expect(sdk.capture.mock.calls.map(([event]) => event)).toEqual(['dataset_loaded']);
  });

  it('does not flush queued events or send buffered events after a privacy opt-out', async () => {
    sdk.init.mockImplementationOnce(() => {});
    const { trackEvent } = await import('../src/lib/analytics');
    trackEvent('$pageview');
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    const config = sdk.init.mock.calls[0]![1];
    vi.stubGlobal('navigator', { doNotTrack: '1' });
    config.loaded(sdk);
    expect(sdk.capture).not.toHaveBeenCalled();
    expect(config.before_send({ event: '$pageview', properties: {} })).toBeNull();
    vi.stubGlobal('navigator', { doNotTrack: null });
    trackEvent('dataset_loaded');
    expect(sdk.capture.mock.calls.map(([event]) => event)).toEqual(['dataset_loaded']);
  });

  it('contains capture failures after successful SDK initialization', async () => {
    const { initializeAnalytics, trackEvent } = await import('../src/lib/analytics');
    initializeAnalytics();
    await vi.runAllTimersAsync();
    await vi.dynamicImportSettled();
    sdk.capture.mockImplementationOnce(() => {
      throw new Error('Capture blocked');
    });
    expect(() => trackEvent('dataset_loaded')).not.toThrow();
  });
});
