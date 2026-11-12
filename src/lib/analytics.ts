import type { PostHog } from 'posthog-js';

// A public browser project token, not a personal API key.
const PROJECT_TOKEN = 'phc_kkQg6nF27kwnPJFcKPhx46dRanV7zeWdnnAQCoRZQ5HX';
const EVENT_NAMES = ['$pageview', 'dataset_loaded', 'dataset_load_failed', 'recipe_search_completed',
  'chain_search_completed', 'chain_more_requested', 'chain_more_stopped', 'chain_route_viewed',
  'questbook_loaded', 'questbook_load_failed', 'quest_version_changed', 'quest_chapter_viewed',
  'quest_viewed', 'quest_search', 'quest_link_opened', 'quest_touch_preview',
  'special_viewed', 'item_touch_interaction', 'item_action_selected',
  'catalog_search', 'search_help_opened', 'item_viewed', 'finder_ingredient_added', 'data_export_clicked', 'data_export_completed', 'data_export_failed'] as const;
type EventName = (typeof EVENT_NAMES)[number];
const EVENTS: ReadonlySet<string> = new Set(EVENT_NAMES);
const MAX_PENDING_EVENTS = 50;
const MAX_SEARCH_LENGTH = 120;
type Properties = Record<string, string | number | boolean>;
let client: Pick<PostHog, 'capture'> | undefined;
let scheduled = false;
let failed = false;
const pending: Array<{ name: EventName; properties: Properties }> = [];

export function analyticsSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_LENGTH);
}

function enabled(): boolean {
  return import.meta.env.PROD && typeof location !== 'undefined' && location.hostname === 'dacurse.github.io'
    && location.pathname.startsWith('/gtnh-recipe-browser/')
    && typeof navigator !== 'undefined' && navigator.doNotTrack !== '1'
    && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}

/** Keep navigation categories, never searches, exact item/NBT IDs, or URL fragments. */
export function analyticsUrl(value: string): string {
  try {
    const url = new URL(value);
    const params = new URLSearchParams();
    if (url.searchParams.get('page') === 'quests') params.set('page', 'quests');
    else if (url.searchParams.get('page') === 'finder') {
      params.set('page', 'finder');
      if (url.searchParams.get('finder-mode') === 'chain') params.set('finder-mode', 'chain');
    } else if (['recipes', 'usages', 'machine-usages'].includes(url.searchParams.get('view') ?? '')) {
      params.set('view', url.searchParams.get('view')!);
    }
    url.search = params.toString(); url.hash = '';
    return url.href;
  } catch { return ''; }
}

function send(name: EventName, properties: Properties) {
  try { client?.capture(name, properties); } catch { /* Analytics must never affect browsing. */ }
}

function sanitizeUrlProperties(properties: Record<string, unknown>) {
  properties.$current_url = analyticsUrl(String(properties.$current_url ?? location.href));
  for (const key of Object.keys(properties)) {
    const value = properties[key];
    if (typeof value !== 'string') continue;
    const referrer = key.endsWith('referrer');
    if (!key.toLowerCase().includes('url') && !referrer) continue;
    if (referrer && value === '$direct') continue;
    try { properties[key] = referrer ? new URL(value).origin : analyticsUrl(value); }
    catch { properties[key] = ''; }
  }
  delete properties.$set;
  delete properties.$set_once;
}

export function initializeAnalytics() {
  if (!enabled() || scheduled || failed) return;
  scheduled = true;
  const start = () => {
    if (!enabled()) {
      pending.length = 0;
      scheduled = false;
      return;
    }
    void import('posthog-js/dist/module.slim').then(({ default: posthog }) => {
      if (!enabled()) {
        pending.length = 0;
        scheduled = false;
        return;
      }
      posthog.init(PROJECT_TOKEN, {
        api_host: 'https://us.i.posthog.com', ui_host: 'https://us.posthog.com', defaults: '2026-08-30',
        autocapture: false, rageclick: false, capture_dead_clicks: false, capture_heatmaps: false, capture_performance: false, capture_pageview: false, capture_pageleave: false, capture_exceptions: false,
        disable_session_recording: true, disable_surveys: true, disable_external_dependency_loading: true,
        advanced_disable_flags: true, person_profiles: 'never', persistence: 'localStorage', respect_dnt: true,
        before_send: (event) => {
          if (!enabled() || !event || !EVENTS.has(event.event)) return null;
          sanitizeUrlProperties(event.properties);
          return event;
        },
        loaded: (instance) => {
          client = instance;
          if (!enabled()) {
            pending.length = 0;
            return;
          }
          for (const event of pending.splice(0)) send(event.name, event.properties);
        }
      });
    }).catch(() => { failed = true; pending.length = 0; });
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 2000 });
  else setTimeout(start, 0);
}

export function trackEvent(name: EventName, properties: Properties = {}) {
  if (!enabled() || failed) return;
  const clean = Object.fromEntries(Object.entries(properties).filter(([, value]) => typeof value !== 'number' || Number.isFinite(value)));
  const event = { name, properties: { ...clean, $current_url: analyticsUrl(location.href) } };
  if (client) send(event.name, event.properties);
  else {
    if (pending.length >= MAX_PENDING_EVENTS) pending.shift();
    pending.push(event); initializeAnalytics();
  }
}
