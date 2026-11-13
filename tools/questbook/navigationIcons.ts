import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CatalogEntry } from '../../src/lib/types';

/** Navigation chrome uses real exported pixels independently of data downloads. */
export async function writeNavigationIcons(
  entries: ReadonlyMap<string, CatalogEntry>,
  publicRoot: string,
  datasetId: string,
): Promise<void> {
  const directory = join(publicRoot, 'assets/navigation');
  await mkdir(directory, { recursive: true });
  const records = [];
  for (const [name, id] of [
    ['items', 'i:minecraft:crafting_table:0'],
    ['finder', 'i:cropsnh:plantLens:0'],
    ['quests', 'i:questbook:ItemQuestBook:0'],
  ]) {
    const icon = entries.get(id!)?.icon;
    if (!icon) throw new Error(`Missing navigation icon ${id}`);
    const sheet = await readFile(
      join(publicRoot, new URL(icon.url, 'https://quest-build.invalid/').pathname.slice(1)),
    );
    const metadata = await sharp(sheet).metadata();
    const cell = metadata.width! / icon.columns;
    const png = await sharp(sheet)
      .extract({
        left: (icon.index % icon.columns) * cell,
        top: Math.floor(icon.index / icon.columns) * cell,
        width: cell,
        height: cell,
      })
      .png()
      .toBuffer();
    await writeFile(join(directory, `${name}.png`), png);
    records.push({
      name,
      goodsId: id,
      sheetSha256: icon.sha256,
      index: icon.index,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  }
  await mkdir('assets/source/navigation-icons', { recursive: true });
  await writeFile(
    'assets/source/navigation-icons/provenance.json',
    JSON.stringify({ datasetId, icons: records }, null, 2) + '\n',
  );
}
