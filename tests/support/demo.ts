import type { CatalogEntry, Recipe } from '../../src/lib/types';

export const entries: CatalogEntry[] = [
  {
    id: 'gregtech:gt.metaitem.01:32606',
    name: 'Naquadah Alloy Ingot',
    mod: 'GregTech',
    kind: 'item',
    formula: 'Nq⁺',
    tooltip: ['Tier 7 material', 'gregtech:gt.metaitem.01:32606'],
    color: '#566e5d',
    glyph: '▰'
  },
  {
    id: 'gregtech:gt.blockmachines:1180',
    name: 'Large Chemical Reactor',
    mod: 'GregTech',
    kind: 'item',
    tooltip: ['Processes complex chemical reactions', 'gregtech:gt.blockmachines:1180'],
    color: '#7b858b',
    glyph: '⚙'
  },
  {
    id: 'gregtech:gt.metaitem.01:17303',
    name: 'Naquadah Dust',
    mod: 'GregTech',
    kind: 'item',
    tooltip: ['Radioactive material'],
    color: '#35453b',
    glyph: '✦'
  },
  {
    id: 'gregtech:gt.metaitem.01:11303',
    name: 'Naquadah Ingot',
    mod: 'GregTech',
    kind: 'item',
    tooltip: ['Hot to the touch'],
    color: '#46624d',
    glyph: '▰'
  },
  {
    id: 'gregtech:gt.metaitem.01:28303',
    name: 'Molten Naquadah',
    mod: 'GregTech',
    kind: 'fluid',
    tooltip: ['Temperature: 4500 K'],
    color: '#528a62',
    glyph: '≈'
  },
  {
    id: 'gregtech:gt.metaitem.01:32605',
    name: 'Trinium Ingot',
    mod: 'GregTech',
    kind: 'item',
    tooltip: ['A bright, lightweight metal'],
    color: '#d5e9e8',
    glyph: '▰'
  },
  {
    id: 'bartworks:gt.bwMetaGeneratedingots:30',
    name: 'Awakened Draconium Ingot',
    mod: 'BartWorks',
    kind: 'item',
    tooltip: ['Charged with draconic energy'],
    color: '#ed6b1e',
    glyph: '▰'
  },
  {
    id: 'minecraft:diamond',
    name: 'Diamond',
    mod: 'Minecraft',
    kind: 'item',
    tooltip: ['A brilliant gemstone'],
    color: '#55d9d2',
    glyph: '◆'
  },
  {
    id: 'gregtech:gt.metaitem.03:32074',
    name: 'Ultimate Circuit',
    mod: 'GregTech',
    kind: 'item',
    tooltip: ['An UHV-tier circuit'],
    color: '#b85be0',
    glyph: '▦'
  },
  {
    id: 'minecraft:planks:0',
    name: 'Oak Wood Planks',
    mod: 'Minecraft',
    kind: 'item',
    tooltip: ['Building material'],
    color: '#b58a54',
    glyph: '▤'
  },
  {
    id: 'minecraft:crafting_table',
    name: 'Crafting Table',
    mod: 'Minecraft',
    kind: 'item',
    tooltip: ['A workbench for shaped and shapeless crafting'],
    color: '#8c633d',
    glyph: '▦'
  }
];

export const recipes: Recipe[] = [
  {
    id: 'r1',
    type: 'Vacuum Freezer',
    layout: {
      itemInputs: { columns: 1, rows: 1 },
      fluidInputs: { columns: 0, rows: 0 },
      itemOutputs: { columns: 1, rows: 1 },
      fluidOutputs: { columns: 0, rows: 0 }
    },
    inputs: [{ id: 'gregtech:gt.metaitem.01:11303', amount: 1, slot: 0 }],
    outputs: [{ id: 'gregtech:gt.metaitem.01:32606', amount: 1, slot: 0 }]
  },
  {
    id: 'r2',
    type: 'Fluid Solidifier',
    layout: {
      itemInputs: { columns: 1, rows: 1 },
      fluidInputs: { columns: 1, rows: 1 },
      itemOutputs: { columns: 1, rows: 1 },
      fluidOutputs: { columns: 0, rows: 0 }
    },
    inputs: [
      { id: 'gregtech:gt.metaitem.01:32605', amount: 1, slot: 0 },
      { id: 'gregtech:gt.metaitem.01:28303', amount: 144, slot: 0, kind: 'fluid' }
    ],
    outputs: [{ id: 'gregtech:gt.metaitem.01:32606', amount: 1, slot: 0 }]
  },
  {
    id: 'craft-1',
    type: 'Crafting',
    layout: {
      itemInputs: { columns: 3, rows: 3 },
      fluidInputs: { columns: 0, rows: 0 },
      itemOutputs: { columns: 1, rows: 1 },
      fluidOutputs: { columns: 0, rows: 0 },
      shapeless: false
    },
    inputs: [
      { id: 'minecraft:planks:0', amount: 1, slot: 0 },
      { id: 'minecraft:planks:0', amount: 1, slot: 1 },
      { id: 'minecraft:planks:0', amount: 1, slot: 3 },
      { id: 'minecraft:planks:0', amount: 1, slot: 4 }
    ],
    outputs: [{ id: 'minecraft:crafting_table', amount: 1, slot: 0 }]
  }
];
