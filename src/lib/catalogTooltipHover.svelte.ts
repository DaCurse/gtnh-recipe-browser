import type { CatalogEntry } from './types';

/** Pointer/focus bookkeeping only; loading is shared by FloatingCatalogTooltip. */
export class CatalogTooltipHover {
  entry = $state.raw<CatalogEntry>();
  x = $state(0);
  y = $state(0);

  pointer(event: PointerEvent, entry = this.entry): void {
    if (event.pointerType === 'touch' || !entry) return;
    if (this.entry?.id !== entry.id) this.entry = entry;
    this.x = event.clientX;
    this.y = event.clientY;
  }

  focus(event: FocusEvent, entry: CatalogEntry | undefined): void {
    if (!entry) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.entry = entry;
    this.x = rect.right;
    this.y = rect.bottom;
  }

  clear(): void {
    this.entry = undefined;
  }
}
