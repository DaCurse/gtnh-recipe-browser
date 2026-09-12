import { describe, expect, it } from 'vitest';
import {
  browserExportFilename,
  createRecipeExport,
  createSpecialExport,
  recipeRecordsForExport,
  serializeBrowserExport
} from '../src/lib/browserExport';
import type { CatalogEntry, Recipe } from '../src/lib/types';
import type { SpecialRecord } from '../src/lib/specialData';

const iron: CatalogEntry = {
  id: 'i:minecraft:iron_ingot:0',
  name: 'Iron Ingot',
  mod: 'Minecraft',
  kind: 'item',
  tooltip: [],
  color: '#aaa',
  glyph: 'I'
};
const copper: CatalogEntry = {
  id: 'i:gregtech:copper_ingot:0',
  name: 'Copper Ingot',
  mod: 'GregTech',
  kind: 'item',
  tooltip: [],
  color: '#c76',
  glyph: 'C'
};
const repository = {
  datasetId: 'gtnh-fixture',
  gtnhVersion: '2.8.0',
  revision: 'revision-1',
  entries: [iron, copper]
};

function recipe(id: string, type: string, order: number, inputId: string): Recipe {
  return {
    id,
    type,
    inputs: [{ id: inputId, alternatives: [copper.id] }],
    outputs: [{ id: iron.id }],
    layout: {
      itemInputs: { columns: 1, rows: 1 },
      fluidInputs: { columns: 0, rows: 0 },
      itemOutputs: { columns: 1, rows: 1 },
      fluidOutputs: { columns: 0, rows: 0 }
    },
    order,
    crafterId: copper.id,
    crafters: [{ id: copper.id, role: 'singleblock' }],
    typeIconId: copper.id
  };
}

describe('browser JSON exports', () => {
  it('exports complete and filtered materialized recipe records with item names', () => {
    const records = [
      recipe('electric:2', 'Electric Furnace', 2, copper.id),
      recipe('crafting:1', 'Crafting Table', 1, iron.id)
    ];
    const complete = createRecipeExport({
      repository,
      selected: iron,
      view: 'recipes',
      scope: 'pane',
      records,
      applied: false
    });
    expect(browserExportFilename(complete)).toBe('gtnh-iron-ingot-recipes.json');

    const activeType = createRecipeExport({
      repository,
      selected: iron,
      view: 'recipes',
      scope: 'pane',
      recipeType: 'Canner',
      records: []
    });
    expect(browserExportFilename(activeType)).toBe('gtnh-canner-recipes.json');

    const machineUsages = createRecipeExport({
      repository,
      selected: { ...iron, name: 'Canner' },
      view: 'machineUsages',
      scope: 'machine',
      records: []
    });
    expect(browserExportFilename(machineUsages)).toBe('gtnh-canner-machine-usages.json');
    expect(complete.records.map((record) => record.id)).toEqual(['crafting:1', 'electric:2']);
    expect(complete.records[0]?.inputs[0]).toMatchObject({
      id: iron.id,
      name: 'Iron Ingot',
      alternativeNames: ['Copper Ingot']
    });
    expect(complete.records[0]).toMatchObject({
      crafterName: 'Copper Ingot',
      crafters: [{ id: copper.id, name: 'Copper Ingot' }],
      typeIconName: 'Copper Ingot'
    });

    const filtered = recipeRecordsForExport(
      repository,
      records,
      'Crafting Table',
      'copper',
      true
    );
    expect(filtered.map((record) => record.id)).toEqual(['crafting:1']);

    const copperFiltered = recipeRecordsForExport(
      repository,
      records,
      'Electric Furnace',
      'copper',
      true
    );
    expect(copperFiltered.map((record) => record.id)).toEqual(['electric:2']);
  });

  it('uses the special category for global filenames and decorates special goods', () => {
    const record: SpecialRecord = {
      id: 'meteor:iron',
      category: 'meteorRitual',
      title: 'Meteor Ritual: Iron',
      goodsIds: [iron.id],
      inputs: [{ goodsId: iron.id }],
      payload: { focus: { goodsId: iron.id }, crystalGoodsId: copper.id }
    };
    const value = createSpecialExport({
      repository,
      selected: { ...iron, name: 'Tiberium Ore' },
      view: 'recipes',
      scope: 'special-global',
      specialViewType: { id: 'meteor-ritual', label: 'Meteor Rituals' },
      records: [record]
    });

    expect(browserExportFilename(value)).toBe('gtnh-special-global-meteor-ritual.json');
    expect(browserExportFilename(value)).not.toContain('tiberium');
    expect(value.records[0]?.goodsNames).toEqual(['Iron Ingot']);
    expect(value.records[0]?.inputs?.[0]).toMatchObject({ name: 'Iron Ingot' });
    expect(value.records[0]?.payload).toMatchObject({
      focus: { name: 'Iron Ingot' },
      crystalGoodsName: 'Copper Ingot'
    });

    const cropValue = createSpecialExport({
      repository,
      selected: iron,
      view: 'recipes',
      scope: 'special-global',
      specialViewType: { id: 'crop-outputs', label: 'Crop Outputs' },
      records: [{
        id: 'crop:iron',
        category: 'crop',
        title: 'Iron Crop',
        payload: { parents: [[copper.id]] }
      }]
    });
    expect(cropValue.records[0]?.payload).toMatchObject({
      parentsNames: [['Copper Ingot']]
    });
    expect(JSON.parse(serializeBrowserExport(value))).toEqual(expect.objectContaining({
      schemaVersion: 1,
      kind: 'special',
      scope: 'special-global'
    }));
  });
});
