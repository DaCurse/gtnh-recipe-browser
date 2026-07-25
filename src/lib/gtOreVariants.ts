import type { CatalogEntry } from './types';

export interface GtOreVariant {
  familyKey: string;
  hostStone: string;
  order: number;
}

interface OreBlockSeries {
  hosts: string[];
  orderOffset: number;
}

const oreBlockSeries: Record<string, OreBlockSeries> = {
  'gt.blockores': {
    hosts: ['Stone', 'Netherrack', 'End Stone', 'Black Granite', 'Red Granite', 'Marble', 'Basalt'],
    orderOffset: 0
  },
  'gt.blockores2': {
    hosts: [
      'Stone',
      'Netherrack',
      'End Stone',
      'Black Granite',
      'Red Granite',
      'Marble',
      'Basalt',
      'Moon'
    ],
    orderOffset: 0
  },
  'gt.blockores3': {
    hosts: ['Mars', 'Asteroid', 'Phobos', 'Deimos', 'Ceres', 'Io', 'Europa', 'Ganymede'],
    orderOffset: 8
  },
  'gt.blockores4': {
    hosts: ['Callisto', 'Enceladus', 'Titan', 'Miranda', 'Oberon', 'Proteus', 'Triton', 'Pluto'],
    orderOffset: 16
  },
  'gt.blockores5': {
    hosts: ['Venus', 'Mercury'],
    orderOffset: 24
  },
  'gt.blockores6': {
    hosts: [
      'Haumea',
      'Makemake',
      'Alpha Centauri',
      'Tau Ceti e',
      'Vega b',
      "Barnard's Star e",
      "Barnard's Star f",
      'Horus'
    ],
    orderOffset: 26
  },
  'gt.blockores7': {
    hosts: ['Anubis & Maahes', 'Packed Ice', 'Seth Ice', 'Seth Clay', 'Deepslate', 'Tuff', 'Blue Ice'],
    orderOffset: 34
  }
};

/**
 * Decodes only the generated, ordinary GT ore stacks exposed by the retained
 * 2.8 and 2.9 catalogs. Hidden natural/small forms and unknown future series
 * remain exact catalog rows until their semantics are explicitly supported.
 */
export function describeGtOreVariant(entry: CatalogEntry): GtOreVariant | null {
  if (
    entry.kind !== 'item'
    || !entry.id.startsWith('i:gregtech:')
    || !entry.internalName
    || entry.damage === undefined
    || !Number.isInteger(entry.damage)
    || entry.damage < 0
    || entry.damage >= 8_000
  ) return null;

  const series = oreBlockSeries[entry.internalName];
  if (!series) return null;
  const stoneIndex = Math.floor(entry.damage / 1_000);
  const hostStone = series.hosts[stoneIndex];
  if (!hostStone) return null;

  const materialId = entry.damage % 1_000;
  return {
    familyKey: `gtOre\u0000${materialId}\u0000${entry.name}`,
    hostStone,
    order: series.orderOffset + stoneIndex
  };
}
