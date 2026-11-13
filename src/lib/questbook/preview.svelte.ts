import { trackEvent } from '../analytics';
import { questAnalyticsProperties } from './analytics';
import { completeTouchGesture } from '../itemTouch.svelte';
import type { QuestPreviewRepository } from './linksTypes';

interface Preview {
  id: string;
  repository: QuestPreviewRepository;
  node: HTMLElement;
  x: number;
  y: number;
  anchor?: DOMRect;
  touch: boolean;
}
class QuestPreviewState {
  current = $state.raw<Preview>();
  private pointerType = '';
  clear = (): void => {
    this.current = undefined;
  };
  pointerKind = (event: PointerEvent): void => {
    this.pointerType = event.pointerType;
  };
  pointer(id: string, repository: QuestPreviewRepository, event: PointerEvent): void {
    if (event.pointerType === 'touch' || this.current?.touch) return;
    this.current = {
      id,
      repository,
      node: event.currentTarget as HTMLElement,
      x: event.clientX,
      y: event.clientY,
      touch: false,
    };
  }
  focus(id: string, repository: QuestPreviewRepository, event: FocusEvent): void {
    if (this.pointerType === 'touch') return;
    const node = event.currentTarget as HTMLElement,
      rect = node.getBoundingClientRect();
    this.current = { id, repository, node, x: rect.right, y: rect.bottom, touch: false };
  }
  activate(
    id: string,
    repository: QuestPreviewRepository,
    event: MouseEvent,
    open: () => void,
  ): void {
    if (this.pointerType === 'touch' && event.detail !== 0) {
      if (
        this.current?.id !== id ||
        !this.current.touch ||
        this.current.node !== event.currentTarget
      ) {
        const node = event.currentTarget as HTMLElement,
          anchor = node.getBoundingClientRect();
        this.current = {
          id,
          repository,
          node,
          anchor,
          x: anchor.right,
          y: anchor.bottom,
          touch: true,
        };
        const quest = repository.quests.get(id);
        if (quest) trackEvent('quest_touch_preview', questAnalyticsProperties(quest, repository));
        return;
      }
      completeTouchGesture('opened');
    }
    this.clear();
    open();
  }
  listen(): () => void {
    const outside = (event: PointerEvent) => {
      this.pointerKind(event);
      if (event.target instanceof Node && this.current?.node.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('.touch-tooltip')) return;
      this.clear();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element && event.target.closest('.touch-tooltip')))
        this.clear();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.clear();
      if (event.key === 'Tab') this.pointerType = 'keyboard';
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('keydown', key);
    window.addEventListener('popstate', this.clear);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('popstate', this.clear);
      this.clear();
    };
  }
}
export const questPreview = new QuestPreviewState();
