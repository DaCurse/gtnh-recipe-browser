import type { Quest, QuestChapter, QuestPlacement } from './types';

export function questBounds(chapter: QuestChapter) {
  const placements = chapter.quests;
  const minX = Math.min(0, ...placements.map(p => p.x)), minY = Math.min(0, ...placements.map(p => p.y));
  const maxX = Math.max(24, ...placements.map(p => p.x + p.width)), maxY = Math.max(24, ...placements.map(p => p.y + p.height));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}
export function questEdges(chapter: QuestChapter, quests: ReadonlyMap<string, Pick<Quest, 'main' | 'requirements'>>) {
  const placements = new Map(chapter.quests.map(p => [p.id, p]));
  return chapter.quests.flatMap(end => (quests.get(end.id)?.requirements ?? []).flatMap(requirement => {
    const start = placements.get(requirement.id);
    if (!start || requirement.type === 'hidden') return [];
    const x = start.x + start.width / 2, y = start.y + start.height / 2;
    const dx = end.x + end.width / 2 - x, dy = end.y + end.height / 2 - y;
    const length = Math.hypot(dx, dy);
    // DirectionalLine's repeated chevrons, including main-quest line width.
    const width = quests.get(end.id)?.main ? 8 : 4;
    const count = Math.ceil(length / 20), offset = count % 2 === 1 ? 0 : 1 / (count + 1) / 2;
    const arrows = Array.from({ length: count + 1 }, (_, index) => {
      const at = length * (index / (count + 1) + offset), half = width / 4;
      return `M${at - half},${width / 2} L${at + half},${width / 2} L${at + width * .75 + half},0 L${at + half},${-width / 2} L${at - half},${-width / 2} L${at + width * .75 - half},0 Z`;
    }).join(' ');
    return [{ id: `${start.id}:${end.id}`, type: requirement.type, x, y, length, width, angle: Math.atan2(dy, dx) * 180 / Math.PI, arrows }];
  }));
}
export function placementVisible(p: QuestPlacement, x: number, y: number, zoom: number, width: number, height: number): boolean {
  return p.x * zoom + x < width + 100 && (p.x + p.width) * zoom + x > -100
    && p.y * zoom + y < height + 100 && (p.y + p.height) * zoom + y > -100;
}
