import type { AssetDescriptor, CatalogEntry } from '../types';
import type { SpecialGoods } from '../specialData';

export interface QuestSection {
  type: string;
  title: string;
  items: SpecialGoods[];
  lines: string[];
  quests: string[];
  conditions?: string;
  nbtMatch?: 'ignore' | 'partial' | 'exact';
  itemLogic?: 'OR';
}
export interface Quest {
  id: string;
  name: string;
  description: string;
  icon: SpecialGoods;
  main: boolean;
  secret: boolean;
  counted: boolean;
  logic: string;
  taskLogic: string;
  requirements: { id: string; type: 'normal' | 'implicit' | 'hidden' }[];
  tasks: QuestSection[];
  rewards: QuestSection[];
}
export interface QuestPlacement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface QuestChapter {
  id: string;
  name: string;
  description: string;
  icon: SpecialGoods;
  quests: QuestPlacement[];
}
export interface QuestPack {
  schemaVersion: 1;
  version: string;
  sourceCommit: string;
  rendererCommit: string;
  quests: Quest[];
  chapters: QuestChapter[];
  items: CatalogEntry[];
  images: Record<string, string>;
  navigationTargets: Record<string, string>;
}
export interface QuestVersion extends AssetDescriptor {
  version: string;
  questCount: number;
  chapterCount: number;
  sourceCommit: string;
}
export interface QuestVersions {
  schemaVersion: 1;
  versions: QuestVersion[];
}

export function questUuid(high: string | number, low: string | number): string {
  const hex = [high, low]
    .map((value) => BigInt.asUintN(64, BigInt(value)).toString(16).padStart(16, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function questLinkId(value: string): string | undefined {
  if (/^q[0-9a-z]{1,25}$/.test(value)) {
    let number = 0n;
    for (const digit of value.slice(1)) number = number * 36n + BigInt(Number.parseInt(digit, 36));
    if (number >= 1n << 128n) return undefined;
    const hex = number.toString(16).padStart(32, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) return value.toLowerCase();
  if (/^\d+$/.test(value)) return questUuid(0, value);
  try {
    const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    if (bytes.length !== 16) return undefined;
    const hex = [...bytes].map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return questUuid(`0x${hex.slice(0, 16)}`, `0x${hex.slice(16)}`);
  } catch {
    return undefined;
  }
}
export function questUrlId(id: string): string {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
    throw new Error(`Invalid quest UUID: ${id}`);
  return 'q' + BigInt('0x' + id.replaceAll('-', '')).toString(36);
}
