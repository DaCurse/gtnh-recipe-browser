import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { QuestPlacement } from '../../src/lib/questbook/types';

/** Midnight frames, including BetterQuesting GuiQuestLines.highlightButton's RGB multiply. */
export async function writeQuestFrames(
  midnightRoot: string,
  assets: string,
  placements: readonly Pick<QuestPlacement, 'width' | 'height'>[],
): Promise<void> {
  await mkdir(assets, { recursive: true });
  const [theme] = JSON.parse(await readFile(join(midnightRoot, 'bq_themes.json'), 'utf8'));
  const sizes = new Map(placements.map((p) => [`${p.width}x${p.height}`, p]));
  const provenance: Record<string, unknown> = {};
  for (const [name, key] of [
    ['normal', 'quest_norm_0'],
    ['main', 'quest_main_0'],
  ] as const) {
    const texture = theme.textures[`betterquesting:${key}`];
    const [left, top, width, height] = texture.bounds as number[];
    const borders = texture.padding as number[];
    if (
      texture.sliceMode !== 1 ||
      width !== 24 ||
      height !== 24 ||
      !borders.every((value) => value === borders[0])
    )
      throw new Error(`Unsupported Midnight quest frame geometry: ${key}`);
    const atlas = await readFile(join(midnightRoot, texture.atlas.split(':')[1]));
    const source = await sharp(atlas)
      .extract({ left: left!, top: top!, width, height })
      .png()
      .toBuffer();
    await writeFile(join(assets, `quest-${name}.png`), source);
    for (const [size, placement] of sizes) {
      const resized = await sharp(source)
        .resize(placement.width, placement.height, { kernel: 'nearest' })
        .png()
        .toBuffer();
      await writeFile(join(assets, `quest-${name}-${size}.png`), resized);
      await sharp(resized)
        .linear([1, 191 / 255, 0], [0, 0, 0])
        .png()
        .toFile(join(assets, `quest-${name}-highlight-${size}.png`));
    }
    provenance[name] = {
      resource: texture.atlas,
      bounds: texture.bounds,
      atlasSha256: createHash('sha256').update(atlas).digest('hex'),
    };
  }
  const provenanceRoot = 'assets/source/questbook-frames';
  await mkdir(provenanceRoot, { recursive: true });
  await writeFile(
    join(provenanceRoot, 'provenance.json'),
    JSON.stringify(
      {
        renderer: 'GTNewHorizons/BetterQuesting',
        rendererCommit: '81109f73cdeee72b26035d7937a170830a5074bf',
        method: 'GuiQuestLines.highlightButton',
        zoom: 2,
        colors: ['#000000', '#FFBF00'],
        pulsePeriodMs: 700,
        processing:
          'Nearest-neighbour frame scaling, then original OpenGL RGB multiplication; alpha unchanged.',
        frames: provenance,
      },
      null,
      2,
    ) + '\n',
  );
}
