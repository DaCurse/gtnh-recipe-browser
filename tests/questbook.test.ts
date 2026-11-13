import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import { parseQuestJson, questSnbt, readQuest } from '../tools/questbook/source';
import { formatNbt, nbtIdentity } from '../src/lib/nbt';
import { questLinkId, questUuid, questUrlId } from '../src/lib/questbook/types';
import type { QuestPack, QuestChapter, QuestVersion } from '../src/lib/questbook/types';
import { questBounds, questEdges, placementVisible } from '../src/lib/questbook/layout';
import { plainQuestText, questText } from '../src/lib/questbook/text';
import { parseMinecraftCodes } from '../src/lib/minecraftText';
import sharp from 'sharp';

describe('BetterQuesting source compatibility', () => {
  it('formats nested NBT without rounding signed longs or losing string escapes', () => {
    const formatted = formatNbt(
      '{display:{Name:"A\\nB"},energy:9223372036854775807L,list:[0:1b,1:2s]}',
    );
    expect(formatted).toContain('\n  "display": {\n    "Name": "A\\nB"\n  }');
    expect(formatted).toContain('"energy": 9223372036854775807L');
    expect(formatted).toContain('"list": [\n    1b,\n    2s\n  ]');
  });
  it('uses native consumption colors and only shows active NBT matching', () => {
    const tasks = [
      { 'consume:1': 1, 'ignoreNBT:1': 1 },
      { 'consume:1': 0, 'ignoreNBT:1': 0, 'partialMatch:1': 1 },
      { 'consume:1': 0, 'ignoreNBT:1': 0, 'partialMatch:1': 0 },
    ];
    const quest = readQuest(
      {
        'questIDHigh:4': 0,
        'questIDLow:4': 1,
        'tasks:9': Object.fromEntries(
          tasks.map((task, index) => [
            `${index}:10`,
            { 'taskID:8': 'bq_standard:retrieval', ...task },
          ]),
        ),
      },
      (stack) => ({ goodsId: stack.item, amount: stack.count }),
    );
    expect(quest.tasks[0]!.lines).toEqual(['Consume: §cYes§r']);
    expect(quest.tasks[1]!.lines).toEqual(['Consume: §aNo§r', 'NBT matching: Partial']);
    expect(quest.tasks[2]!.lines).toEqual(['Consume: §aNo§r', 'NBT matching: Exact']);
  });
  it('preserves Midnight frame outlines and transparent cutouts at every node size', async () => {
    for (const name of ['main', 'normal'] as const) {
      const source = readFileSync(`public/quests/assets/quest-${name}.png`);
      const sourcePixels = await sharp(source).ensureAlpha().raw().toBuffer();
      for (const [width, height] of [
        [24, 24],
        [48, 48],
        [54, 48],
        [96, 96],
      ] as const) {
        const rendered = readFileSync(`public/quests/assets/quest-${name}-${width}x${height}.png`);
        const { data, info } = await sharp(rendered)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect([info.width, info.height]).toEqual([width, height]);
        // The middle of each outside edge used to become an opaque gray block
        // when the frame was enlarged independently from its corners.
        for (const [x, y] of [
          [0, 12],
          [23, 12],
          [12, 0],
          [12, 23],
          [12, 12],
        ] as const) {
          const targetX = Math.floor(((x + 0.5) * width) / 24),
            targetY = Math.floor(((y + 0.5) * height) / 24);
          expect(data[(targetY * width + targetX) * 4 + 3]).toBe(
            sourcePixels[(y * 24 + x) * 4 + 3],
          );
        }
        if (width === 24 && height === 24) {
          expect(await sharp(rendered).flatten({ background: '#000' }).raw().toBuffer()).toEqual(
            await sharp(source).flatten({ background: '#000' }).raw().toBuffer(),
          );
        }
      }
    }
  });
  it('preserves signed 64-bit UUIDs before parsing and accepts native compact quest links', () => {
    const data = parseQuestJson(
      '{"questIDHigh:4":9223372036854775807,"questIDLow:4":-9223372036854775808}',
    );
    expect(data['questIDHigh:4']).toBe('9223372036854775807');
    expect(questUuid(data['questIDHigh:4'] as string, data['questIDLow:4'] as string)).toBe(
      '7fffffff-ffff-ffff-8000-000000000000',
    );
    expect(questLinkId('AAAAAAAAAAAAAAAAAAACIg==')).toBe(questUuid(0, 546));
    expect(questLinkId('546')).toBe(questUuid(0, 546));
    expect(questLinkId('invalid')).toBeUndefined();
  });
  it('keeps NBT numeric types and compares compounds semantically', () => {
    const snbt = questSnbt({
      'display:10': { 'Name:8': 'A "reward"' },
      'x:1': 1,
      'list:9': { '0:10': { 'n:4': '9223372036854775807' } },
    });
    expect(nbtIdentity(snbt)).toBe(
      nbtIdentity(
        `{list:[0:{n:9223372036854775807L}],x:1b,display:{Name:${JSON.stringify('A "reward"')}}}`,
      ),
    );
    expect(nbtIdentity('{x:1b}')).not.toBe(nbtIdentity('{x:1}'));
    expect(() => nbtIdentity('{broken')).toThrow();
  });
  it('normalizes each task and reward type actually used in the pinned release', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('./fixtures/questbook/2.9.0/source.json', import.meta.url), 'utf8'),
    );
    const types = new Set<string>();
    for (const file of fixture.files) {
      expect(createHash('sha256').update(file.source).digest('hex')).toBe(file.sha256);
      const quest = readQuest(parseQuestJson(file.source), (stack) => ({
        goodsId: stack.item,
        amount: stack.count,
      }));
      for (const section of [...quest.tasks, ...quest.rewards]) types.add(section.type);
      expect(quest.id).toMatch(/^[a-f0-9-]{36}$/);
    }
    expect([...types].sort()).toEqual([
      'checkbox',
      'choice',
      'crafting',
      'fluid',
      'hunt',
      'item',
      'location',
      'meeting',
      'optional_retrieval',
      'questcompletion',
      'retrieval',
      'xp',
    ]);
  });
});

describe('quest text and canvas semantics', () => {
  it('uses safe text runs, native tags, formatted links and inert unsafe URLs', () => {
    const runs = questText(
      '[warn]Careful [bold]now[/bold][/warn] [url]https://example.com[/url] [url link=javascript:alert(1)]bad[/url] [Player] <script>alert(1)</script>',
    );
    expect(runs.find((run) => run.text === 'now')?.codes).toContain('§l');
    expect(runs.find((run) => run.text === 'https://example.com')?.link?.target).toBe(
      'https://example.com/',
    );
    expect(runs.find((run) => run.text === 'bad')?.link).toBeUndefined();
    expect(plainQuestText('[note]Hello[/note] §aWorld')).toBe('Hello World');
    expect(runs.map((run) => run.text).join('')).toContain('[Player] <script>alert(1)</script>');
    expect(parseMinecraftCodes('§aHi §lthere§r! \\&b').plainText).toBe('Hi there! &b');
    const link = questText(
      '[questlink]AAAAAAAAAAAAAAAAAAACIg==[/questlink]',
      () => 'Linked quest',
    )[0];
    expect(link.text).toBe('Linked quest');
    expect(link.link?.target).toBe(questUuid(0, 546));
  });
  it('preserves source coordinates, distinguishes flagged implicit edges and skips hidden/cross-page edges', () => {
    const chapter = {
      quests: [
        { id: 'a', x: -24, y: 0, width: 24, height: 24 },
        { id: 'b', x: 48, y: 48, width: 48, height: 48 },
      ],
    } as QuestChapter;
    const quests = new Map([
      [
        'b',
        {
          main: true,
          requirements: [
            { id: 'a', type: 'implicit' },
            { id: 'a', type: 'hidden' },
            { id: 'elsewhere', type: 'normal' },
          ],
        },
      ],
    ]) as Parameters<typeof questEdges>[1];
    expect(questBounds(chapter)).toEqual({ minX: -24, minY: 0, width: 120, height: 96 });
    const edges = questEdges(chapter, quests);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ type: 'implicit', width: 8, x: -12, y: 12 });
    expect(placementVisible(chapter.quests[0], 0, 0, 1, 390, 800)).toBe(true);
    expect(placementVisible(chapter.quests[0], -1000, 0, 1, 390, 800)).toBe(false);
  });
});

describe('published local 2.9.0 quest dataset', () => {
  it('is verified, independently versioned, and resolves all task and reward icons', () => {
    const root = new URL('../public/quests/', import.meta.url);
    const index = JSON.parse(readFileSync(new URL('versions.json', root), 'utf8')) as {
      versions: QuestVersion[];
    };
    expect(index.versions.map((version) => version.version)).toEqual(['2.9.0']);
    const version = index.versions[0];
    const bytes = readFileSync(new URL(version.url, root));
    expect(bytes.byteLength).toBe(version.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(version.sha256);
    const pack = decode(gunzipSync(bytes)) as QuestPack;
    expect(pack.sourceCommit).toBe('79f9a03b5dd9e492d28998b9dee0ea1d1822a6b1');
    expect(pack.quests).toHaveLength(3814);
    expect(pack.chapters).toHaveLength(46);
    const ids = new Set(pack.quests.map((quest) => quest.id));
    const compactIds = [...pack.quests, ...pack.chapters].map((entry) => questUrlId(entry.id));
    expect(
      [...pack.quests, ...pack.chapters].every(
        (entry, index) => questLinkId(compactIds[index]) === entry.id,
      ),
    ).toBe(true);
    expect(questUrlId(questUuid(0, 0))).toBe('q0');
    expect(questLinkId('q' + 'z'.repeat(25))).toBeUndefined();
    expect(ids.size).toBe(pack.quests.length);
    expect(
      pack.chapters.every((chapter) => chapter.quests.every((placement) => ids.has(placement.id))),
    ).toBe(true);
    expect(
      pack.quests
        .flatMap((quest) => quest.requirements)
        .filter((requirement) => !ids.has(requirement.id)),
    ).toHaveLength(3);
    const items = new Map(pack.items.map((item) => [item.id, item]));
    const references = [
      ...pack.chapters.map((chapter) => chapter.icon),
      ...pack.quests.flatMap((quest) => [
        quest.icon,
        ...quest.tasks.flatMap((section) => section.items),
        ...quest.rewards.flatMap((section) => section.items),
      ]),
    ];
    expect(references).toHaveLength(23205);
    expect(references.filter((reference) => !items.get(reference.goodsId)?.icon)).toEqual([]);
    expect(
      pack.items.filter((item) => item.internalName?.includes('spawn_egg')).length,
    ).toBeGreaterThan(20);
    for (const item of pack.items.filter((item) => item.kind === 'oreDict')) {
      expect(item.tooltip[0]).toBe(
        `${item.members!.length.toLocaleString('en-US')} interchangeable item${item.members!.length === 1 ? '' : 's'}`,
      );
    }
    for (const [id, target] of Object.entries(pack.navigationTargets)) {
      expect(items.get(id)?.icon).toBeDefined();
      expect(items.has(target)).toBe(true);
    }
    expect(
      pack.navigationTargets[
        'i:gregtech:gt.metatool.01:12:5dc9210788149f3a5ee412c4e051ceb141ecaf8d'
      ],
    ).toBe('i:gregtech:gt.metatool.01:12:303388477f39f6c9ee5460198b32269e81610dd3');
  });
});
