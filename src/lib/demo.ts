import type { CatalogEntry, Recipe } from './types';

export const entries: CatalogEntry[] = [
  { id:'gregtech:gt.metaitem.01:32606', name:'Naquadah Alloy Ingot', mod:'GregTech', kind:'item', formula:'Nq⁺', tooltip:['Tier 7 material','gregtech:gt.metaitem.01:32606'], color:'#566e5d', glyph:'▰', recipeTypes:['Vacuum Freezer','Fluid Solidifier'] },
  { id:'gregtech:gt.blockmachines:1180', name:'Large Chemical Reactor', mod:'GregTech', kind:'item', tooltip:['Processes complex chemical reactions','gregtech:gt.blockmachines:1180'], color:'#7b858b', glyph:'⚙', recipeTypes:['Assembly Line','Assembler'] },
  { id:'gregtech:gt.metaitem.01:17303', name:'Naquadah Dust', mod:'GregTech', kind:'item', formula:'Nq', tooltip:['Radioactive material'], color:'#35453b', glyph:'✦', recipeTypes:['Electrolyzer','Centrifuge'] },
  { id:'gregtech:gt.metaitem.01:11303', name:'Naquadah Ingot', mod:'GregTech', kind:'item', formula:'Nq', tooltip:['Hot to the touch'], color:'#46624d', glyph:'▰', recipeTypes:['Blast Furnace','Vacuum Freezer'] },
  { id:'gregtech:gt.metaitem.01:28303', name:'Molten Naquadah', mod:'GregTech', kind:'fluid', formula:'Nq', tooltip:['Temperature: 4500 K'], color:'#528a62', glyph:'≈', recipeTypes:['Fluid Extractor'] },
  { id:'gregtech:gt.metaitem.01:32605', name:'Trinium Ingot', mod:'GregTech', kind:'item', formula:'Tr', tooltip:['A bright, lightweight metal'], color:'#d5e9e8', glyph:'▰', recipeTypes:['Vacuum Freezer'] },
  { id:'bartworks:gt.bwMetaGeneratedingots:30', name:'Awakened Draconium Ingot', mod:'BartWorks', kind:'item', tooltip:['Charged with draconic energy'], color:'#ed6b1e', glyph:'▰', recipeTypes:['Blast Furnace'] },
  { id:'gregtech:gt.metaitem.01:32609', name:'Neutronium Ingot', mod:'GregTech', kind:'item', tooltip:['Incredibly dense'], color:'#20242b', glyph:'▰', recipeTypes:['Neutronium Compressor'] },
  { id:'gregtech:gt.blockmachines:210', name:'Electric Blast Furnace', mod:'GregTech', kind:'item', tooltip:['Controller block for the EBF'], color:'#90604b', glyph:'♨', recipeTypes:['Assembler'] },
  { id:'gregtech:gt.metaitem.03:32074', name:'Ultimate Circuit', mod:'GregTech', kind:'item', tooltip:['An UHV-tier circuit'], color:'#b85be0', glyph:'▦', recipeTypes:['Circuit Assembler','Assembly Line'] },
  { id:'minecraft:diamond', name:'Diamond', mod:'Minecraft', kind:'item', formula:'C', tooltip:['A brilliant gemstone'], color:'#55d9d2', glyph:'◆', recipeTypes:['Implosion Compressor'] },
  { id:'gregtech:gt.metaitem.01:17001', name:'Iron Dust', mod:'GregTech', kind:'item', formula:'Fe', tooltip:['Fine iron powder'], color:'#a79b8d', glyph:'✦', recipeTypes:['Electric Furnace'] },
  { id:'minecraft:planks:0', name:'Oak Wood Planks', mod:'Minecraft', kind:'item', tooltip:['Building material'], color:'#b58a54', glyph:'▤', recipeTypes:['Crafting'] },
  { id:'minecraft:crafting_table', name:'Crafting Table', mod:'Minecraft', kind:'item', tooltip:['A workbench for shaped and shapeless crafting','Supports a 3 × 3 crafting grid'], color:'#8c633d', glyph:'▦', recipeTypes:['Crafting'] }
];

export const recipes: Recipe[] = [
  { id:'r1', type:'Vacuum Freezer', layout:{itemInputs:{columns:1,rows:1},fluidInputs:{columns:0,rows:0},itemOutputs:{columns:1,rows:1},fluidOutputs:{columns:0,rows:0}}, inputs:[{id:'gregtech:gt.metaitem.01:11303',amount:1,slot:0}], outputs:[{id:'gregtech:gt.metaitem.01:32606',amount:1,slot:0}], duration:'20 s', voltage:'EV', eu:'9,600 EU' },
  { id:'r2', type:'Fluid Solidifier', layout:{itemInputs:{columns:1,rows:1},fluidInputs:{columns:1,rows:1},itemOutputs:{columns:1,rows:1},fluidOutputs:{columns:0,rows:0}}, inputs:[{id:'gregtech:gt.metaitem.01:32605',amount:1,slot:0},{id:'gregtech:gt.metaitem.01:28303',amount:144,slot:0,kind:'fluid'}], outputs:[{id:'gregtech:gt.metaitem.01:32606',amount:1,slot:0}], duration:'8 s', voltage:'HV', eu:'1,536 EU', note:'Ingot mold is not consumed' },
  { id:'r3', type:'Blast Furnace', layout:{itemInputs:{columns:2,rows:2},fluidInputs:{columns:1,rows:1},itemOutputs:{columns:2,rows:1},fluidOutputs:{columns:0,rows:0}}, inputs:[{id:'gregtech:gt.metaitem.01:17303',amount:1,slot:0}], outputs:[{id:'gregtech:gt.metaitem.01:11303',amount:1,slot:0}], duration:'12.8 s', voltage:'IV', eu:'25,600 EU' },
  { id:'u1', type:'Assembly Line', layout:{itemInputs:{columns:4,rows:4},fluidInputs:{columns:4,rows:1},itemOutputs:{columns:1,rows:1},fluidOutputs:{columns:0,rows:0}}, inputs:[{id:'gregtech:gt.metaitem.01:32606',amount:8,slot:0},{id:'gregtech:gt.metaitem.03:32074',amount:2,slot:5}], outputs:[{id:'gregtech:gt.blockmachines:1180',amount:1,slot:0}], duration:'2 m 8 s', voltage:'LuV', eu:'7.8M EU' },
  { id:'craft-1', type:'Crafting', layout:{itemInputs:{columns:3,rows:3},fluidInputs:{columns:0,rows:0},itemOutputs:{columns:1,rows:1},fluidOutputs:{columns:0,rows:0},shapeless:false}, inputs:[
    {id:'minecraft:planks:0',amount:1,slot:0},
    {id:'minecraft:planks:0',amount:1,slot:1},
    {id:'minecraft:planks:0',amount:1,slot:3},
    {id:'minecraft:planks:0',amount:1,slot:4}
  ], outputs:[{id:'minecraft:crafting_table',amount:1,slot:0}], note:'Shaped recipe' }
];

export const byId = new Map(entries.map((entry) => [entry.id, entry]));
