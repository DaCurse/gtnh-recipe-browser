import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import { writeQuestFrames } from './frames';
import type { QuestPack, QuestVersions } from '../../src/lib/questbook/types';
const [modpackRoot] = process.argv.slice(2);
if (!modpackRoot) throw new Error('Usage: npm run ui:quest-frames -- <modpack-checkout>');
const index = JSON.parse(await readFile('public/quests/versions.json', 'utf8')) as QuestVersions;
const placements = [];
for (const version of index.versions) {
  const pack = decode(gunzipSync(await readFile(join('public/quests', version.url)))) as QuestPack;
  placements.push(...pack.chapters.flatMap((chapter) => chapter.quests));
}
await writeQuestFrames(
  join(modpackRoot, 'config/betterquesting/resources/midnight'),
  'public/quests/assets',
  placements,
);
