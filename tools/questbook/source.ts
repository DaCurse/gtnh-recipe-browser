import { questLinkId, questUuid } from '../../src/lib/questbook/types';
import type { Quest, QuestChapter, QuestSection } from '../../src/lib/questbook/types';
import type { SpecialGoods } from '../../src/lib/specialData';

export type NbtObject = Record<string, unknown>;
const object = (value: unknown): NbtObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as NbtObject) : {};
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const number = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const yes = (value: unknown) => value === 1;
const rows = (value: unknown) =>
  Object.entries(object(value))
    .sort(([a], [b]) => Number.parseInt(a) - Number.parseInt(b))
    .map(([, value]) => object(value));

/** Preserve signed NBT longs before JSON.parse can round quest UUIDs. */
export function parseQuestJson(source: string): NbtObject {
  return object(
    JSON.parse(
      source.replace(
        /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
        (token, quoted: string | undefined) => {
          if (quoted || !/^-?\d+$/.test(token) || Number.isSafeInteger(Number(token))) return token;
          return JSON.stringify(token);
        },
      ),
    ),
  );
}

/** Vanilla 1.7 SNBT, including numeric types and indexed list elements. */
export function questSnbt(value: unknown, type = 10): string {
  if (type === 8) return JSON.stringify(String(value));
  if (type === 10)
    return `{${Object.entries(object(value))
      .map(([key, child]) => {
        const match = key.match(/^(.*):(\d+)$/);
        if (!match) throw new Error(`Invalid NBT key: ${key}`);
        return `${JSON.stringify(match[1])}:${questSnbt(child, Number(match[2]))}`;
      })
      .join(',')}}`;
  if (type === 9)
    return `[${Object.entries(object(value))
      .sort(([a], [b]) => Number.parseInt(a) - Number.parseInt(b))
      .map(([key, child]) => questSnbt(child, Number(key.split(':').at(-1))))
      .join(',')}]`;
  if (type === 7 || type === 11 || type === 12)
    return `[${(Array.isArray(value) ? value : []).join(',')}]`;
  return `${String(value)}${({ 1: 'b', 2: 's', 4: 'L', 5: 'f', 6: 'd' } as Record<number, string>)[type] ?? ''}`;
}

export interface SourceStack {
  item: string;
  damage: number;
  count: number;
  ore: string;
  nbt?: string;
  fluid?: boolean;
  name?: string;
  lore?: string[];
}
export type StackResolver = (stack: SourceStack) => SpecialGoods;
function stack(value: unknown, resolve: StackResolver): SpecialGoods {
  const data = object(value);
  const fluid = Boolean(data['FluidName:8']);
  const display = object(object(data['tag:10'])['display:10']);
  return resolve({
    item: text(data[fluid ? 'FluidName:8' : 'id:8']),
    damage: number(data['Damage:2']),
    count: number(data[fluid ? 'Amount:3' : 'Count:3'], 1),
    ore: text(data['OreDict:8']),
    fluid,
    ...(data['tag:10'] ? { nbt: questSnbt(data['tag:10']) } : {}),
    ...(display['Name:8'] ? { name: text(display['Name:8']) } : {}),
    ...(display['Lore:9']
      ? { lore: Object.values(object(display['Lore:9'])).map((value) => text(value)) }
      : {}),
  });
}
const sectionNames: Record<string, string> = {
  retrieval: 'Retrieval',
  optional_retrieval: 'Optional retrieval',
  crafting: 'Crafting',
  checkbox: 'Checkbox',
  fluid: 'Fluid retrieval',
  hunt: 'Hunting',
  meeting: 'Meeting',
  location: 'Location',
  xp: 'Experience',
  item: 'Item reward',
  choice: 'Choice reward',
  questcompletion: 'Quest completion',
};
function sections(value: unknown, resolve: StackResolver): QuestSection[] {
  return rows(value)
    .sort((a, b) => number(a['index:3']) - number(b['index:3']))
    .map((data) => {
      const type = text(data['taskID:8'] ?? data['rewardID:8']).replace(/^bq_standard:/, '');
      if (!sectionNames[type]) throw new Error(`Unsupported quest section: ${type}`);
      const result: QuestSection = {
        type,
        title: sectionNames[type],
        items: [],
        lines: [],
        quests: [],
      };
      if (['crafting', 'retrieval', 'optional_retrieval'].includes(type))
        result.nbtMatch = yes(data['ignoreNBT:1'])
          ? 'ignore'
          : yes(data['partialMatch:1'])
            ? 'partial'
            : 'exact';
      for (const field of ['requiredItems:9', 'requiredFluids:9', 'rewards:9', 'choices:9']) {
        result.items.push(...rows(data[field]).map((value) => stack(value, resolve)));
      }
      if (type === 'checkbox') result.lines.push('Read and acknowledge this quest.');
      if (type === 'retrieval' || type === 'optional_retrieval' || type === 'fluid') {
        result.lines.push(`Consume: ${yes(data['consume:1']) ? '§cYes' : '§aNo'}§r`);
        if (yes(data['requireOnlyOneItem:1'])) result.itemLogic = 'OR';
        if (yes(data['groupDetect:1'])) result.lines.push('Shared party detection.');
        if (yes(data['autoConsume:1'])) result.lines.push('Automatic consumption.');
      }
      if (data['ignoreNBT:1'] !== undefined && !yes(data['ignoreNBT:1']))
        result.lines.push(`NBT matching: ${yes(data['partialMatch:1']) ? 'Partial' : 'Exact'}`);
      if (type === 'crafting') {
        result.lines.push(
          `Accepted: ${[
            ['allowCraft:1', 'Crafting'],
            ['allowSmelt:1', 'Smelting'],
            ['allowAnvil:1', 'Anvil'],
            ['allowCraftedFromStatistics:1', 'Crafting statistics'],
          ]
            .filter(([key]) => yes(data[key]))
            .map(([, label]) => label)
            .join(', ')}`,
        );
      }
      if (type === 'hunt' || type === 'meeting') {
        result.lines.push(
          `${text(data['target:8'])} × ${number(data[type === 'hunt' ? 'required:3' : 'amount:3'], 1)}`,
        );
        if (type === 'meeting') result.lines.push(`Within ${number(data['range:3'])} blocks`);
        if (yes(data['subtypes:1'])) result.lines.push('Includes subtypes.');
        if (data['damageType:8']) result.lines.push(`Damage type: ${text(data['damageType:8'])}`);
        if (!yes(data['ignoreNBT:1']) && data['targetNBT:10'])
          result.conditions = questSnbt(data['targetNBT:10']);
      }
      if (type === 'location') {
        result.lines.push(text(data['name:8'], 'Location'));
        if (!yes(data['hideInfo:1'])) {
          result.lines.push(`Dimension: ${number(data['dimension:3'])}`);
          if (number(data['range:3'], -1) >= 0)
            result.lines.push(
              `Position: ${number(data['posX:3'])}, ${number(data['posY:3'])}, ${number(data['posZ:3'])}`,
              `Range: ${number(data['range:3'])} blocks`,
            );
          if (number(data['biome:3'], -1) >= 0)
            result.lines.push(`Biome: ${number(data['biome:3'])}`);
          if (data['structure:8']) result.lines.push(`Structure: ${text(data['structure:8'])}`);
        }
        if (yes(data['invert:1'])) result.lines.push('Must be outside this area.');
      }
      if (type === 'xp')
        result.lines.push(
          `${number(data['amount:3'])} ${yes(data['isLevels:1']) ? 'levels' : 'experience points'}`,
        );
      if (type === 'questcompletion') {
        const id = questLinkId(text(data['questID:8']));
        if (!id) throw new Error('Invalid quest-completion reward reference');
        result.quests.push(id);
      }
      return result;
    });
}
function sourceQuestId(data: NbtObject, prefix = 'quest'): string {
  const high = data[`${prefix}IDHigh:4`],
    low = data[`${prefix}IDLow:4`];
  if (
    (typeof high !== 'string' && typeof high !== 'number') ||
    (typeof low !== 'string' && typeof low !== 'number')
  )
    throw new Error('Missing quest UUID');
  return questUuid(high, low);
}
export function readQuest(data: NbtObject, resolve: StackResolver): Quest {
  const props = object(object(data['properties:10'])['betterquesting:10']);
  return {
    id: sourceQuestId(data),
    name: text(props['name:8']),
    description: text(props['desc:8']),
    icon: stack(props['icon:10'], resolve),
    main: yes(props['isMain:1']),
    secret: props['visibility:8'] === 'HIDDEN' || props['visibility:8'] === 'SECRET',
    counted: props['countAsQuest:1'] !== 0,
    logic: text(props['questLogic:8'], 'AND'),
    taskLogic: text(props['taskLogic:8'], 'AND'),
    requirements: rows(data['preRequisites:9']).map((value) => ({
      id: sourceQuestId(value),
      type:
        number(value['type:1']) === 1
          ? 'implicit'
          : number(value['type:1']) === 2
            ? 'hidden'
            : 'normal',
    })),
    tasks: sections(data['tasks:9'], resolve),
    rewards: sections(data['rewards:9'], resolve),
  };
}
export function readChapter(
  data: NbtObject,
  placements: NbtObject[],
  resolve: StackResolver,
): QuestChapter {
  const props = object(object(data['properties:10'])['betterquesting:10']);
  return {
    id: sourceQuestId(data, 'questLine'),
    name: text(props['name:8']),
    description: text(props['desc:8']),
    icon: stack(props['icon:10'], resolve),
    quests: placements.map((value) => ({
      id: sourceQuestId(value),
      x: number(value['x:3']),
      y: number(value['y:3']),
      width: number(value['sizeX:3'], 24),
      height: number(value['sizeY:3'], 24),
    })),
  };
}
