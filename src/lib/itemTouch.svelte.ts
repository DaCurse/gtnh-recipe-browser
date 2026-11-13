import { trackEvent } from './analytics';
import type { CatalogEntry } from './types';

type ItemView = 'recipes' | 'usages';
let suppressTouchEventUntil = 0;

export function resetItemTouchEvents(event: PointerEvent): void {
  if (event.isPrimary || event.pointerType !== 'touch') suppressTouchEventUntil = 0;
}

/** A touch can replace its target with a modal before the compatibility click arrives. */
export function consumeItemTouchEvent(event: MouseEvent): void {
  if (
    Date.now() < suppressTouchEventUntil &&
    (event.type === 'contextmenu' || event.detail !== 0)
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

interface TouchOptions {
  key: string;
  entry: CatalogEntry;
  activate: (entry: CatalogEntry) => void;
  hold?: (entry: CatalogEntry) => void;
  navigate?: (id: string, view: ItemView) => void;
  notes?: readonly string[];
  enabled?: boolean;
  clearHover?: () => void;
}

interface TouchSession {
  owner: ItemTouch;
  key: string;
  node: HTMLElement;
  entry: CatalogEntry;
  anchor: DOMRect;
  preview: boolean;
  notes?: readonly string[];
}

export const itemTouchState = $state<{
  session?: TouchSession;
  menu?: {
    entry: CatalogEntry;
    navigate: (id: string, view: ItemView) => void;
    opener?: HTMLElement;
    usageLabel: string;
  };
  tutorial: { opened: boolean; held: boolean };
}>({ tutorial: { opened: false, held: false } });

const tutorialKey = 'gtnh-touch-tutorial-v1';

export function loadItemTouchTutorial(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(tutorialKey) ?? '{}');
    itemTouchState.tutorial = { opened: saved?.opened === true, held: saved?.held === true };
  } catch {
    /* Keep in-memory progress when storage is unavailable. */
  }
}

export function completeTouchGesture(gesture: 'opened' | 'held'): void {
  itemTouchState.tutorial[gesture] = true;
  try {
    localStorage.setItem(tutorialKey, JSON.stringify(itemTouchState.tutorial));
  } catch {
    /* Gesture hints still disappear for this visit. */
  }
}

export function clearItemTouch(): void {
  itemTouchState.session?.node.closest('.row')?.classList.remove('touch-inspecting');
  itemTouchState.session = undefined;
}

export function openItemActions(
  entry: CatalogEntry,
  navigate: (id: string, view: ItemView) => void,
  usageLabel = 'Usages',
): void {
  const opener =
    itemTouchState.session?.node ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  clearItemTouch();
  itemTouchState.menu = { entry, navigate, opener, usageLabel };
}

/** One active touch inspection across all item surfaces, with per-feature destinations. */
export class ItemTouch {
  frozen(key: string): CatalogEntry | undefined {
    const session = itemTouchState.session;
    return session?.owner === this && session.key === key ? session.entry : undefined;
  }

  display(key: string, entry: CatalogEntry | undefined): CatalogEntry | undefined {
    return this.frozen(key) ?? entry;
  }

  action = (node: HTMLElement, initial: TouchOptions) => {
    let options = initial;
    let pointer:
      | {
          id: number;
          x: number;
          y: number;
          second: boolean;
          options: TouchOptions;
          entry: CatalogEntry;
        }
      | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let suppressUntil = 0;
    let lastTouchPointer = -1;
    node.toggleAttribute('data-touch-item', options.enabled !== false);
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
      pointer = undefined;
    };
    const clearOwned = () => {
      if (itemTouchState.session?.node === node) clearItemTouch();
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        suppressUntil = 0;
        return;
      }
      if (options.enabled === false) return;
      suppressUntil = Infinity;
      suppressTouchEventUntil = Infinity;
      lastTouchPointer = event.pointerId;
      if (!event.isPrimary || pointer) {
        cancel();
        clearItemTouch();
        return;
      }
      const session = itemTouchState.session;
      const second = session?.owner === this && session.key === options.key && session.preview;
      const entry = this.frozen(options.key) ?? options.entry;
      clearItemTouch();
      options.clearHover?.();
      itemTouchState.session = {
        owner: this,
        key: options.key,
        node,
        entry,
        anchor: node.getBoundingClientRect(),
        preview: second,
        notes: options.notes,
      };
      node.closest('.row')?.classList.add('touch-inspecting');
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, second, options, entry };
      timer = setTimeout(() => {
        const held = pointer;
        cancel();
        if (!held || itemTouchState.session?.node !== node) return;
        completeTouchGesture('held');
        trackEvent('item_touch_interaction', {
          action: 'hold',
          item_name: held.entry.name,
          item_kind: held.entry.kind,
        });
        window.getSelection()?.removeAllRanges();
        if (held.options.hold) {
          clearItemTouch();
          held.options.hold(held.entry);
        } else if (held.options.navigate) openItemActions(held.entry, held.options.navigate);
      }, 500);
    };
    const move = (event: PointerEvent) => {
      if (
        pointer?.id === event.pointerId &&
        Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10
      ) {
        cancel();
        clearOwned();
      }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === lastTouchPointer)
        suppressTouchEventUntil = suppressUntil = Date.now() + 1500;
      if (pointer?.id !== event.pointerId) return;
      const tapped = pointer;
      cancel();
      suppressUntil = Date.now() + 1500;
      if (itemTouchState.session?.node !== node) return;
      if (tapped.second) {
        trackEvent('item_touch_interaction', {
          action: 'activate',
          item_name: tapped.entry.name,
          item_kind: tapped.entry.kind,
        });
        completeTouchGesture('opened');
        clearItemTouch();
        tapped.options.activate(tapped.entry);
      } else {
        itemTouchState.session.preview = true;
        trackEvent('item_touch_interaction', {
          action: 'preview',
          item_name: tapped.entry.name,
          item_kind: tapped.entry.kind,
        });
      }
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === lastTouchPointer)
        suppressTouchEventUntil = suppressUntil = Date.now() + 1500;
      if (pointer?.id !== event.pointerId) return;
      cancel();
      clearOwned();
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressUntil && event.detail !== 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const context = (event: MouseEvent) => {
      if (Date.now() < suppressUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    // Capture before component handlers, including touch-generated focus and mouse events.
    const focus = (event: FocusEvent) => {
      if (Date.now() < suppressUntil) event.stopImmediatePropagation();
    };
    const outside = (event: PointerEvent) => {
      if (pointer && event.pointerId !== pointer.id) {
        cancel();
        clearOwned();
      }
    };
    node.addEventListener('pointerdown', down, true);
    node.addEventListener('click', click, true);
    node.addEventListener('contextmenu', context, true);
    node.addEventListener('focus', focus, true);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    return {
      update(next: TouchOptions) {
        if (
          next.key !== options.key ||
          next.enabled === false ||
          (next.entry.id !== options.entry.id && !thisOwnerFrozen())
        ) {
          cancel();
          clearOwned();
        }
        options = next;
        node.toggleAttribute('data-touch-item', options.enabled !== false);
      },
      destroy() {
        cancel();
        clearOwned();
        node.removeAttribute('data-touch-item');
        node.removeEventListener('pointerdown', down, true);
        node.removeEventListener('click', click, true);
        node.removeEventListener('contextmenu', context, true);
        node.removeEventListener('focus', focus, true);
        window.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', pointerCancel, true);
      },
    };
    function thisOwnerFrozen() {
      return itemTouchState.session?.node === node;
    }
  };
}
