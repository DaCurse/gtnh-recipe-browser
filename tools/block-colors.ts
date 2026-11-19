import { colorScoreDigits } from '../src/lib/blockColors';
import { join } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const palette = [
  0xf5f5f5, 0xf9801d, 0xc74ebd, 0x6699d9, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97,
  0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21,
];

function coordinates(r: number, g: number, b: number) {
  // Separate brightness from chroma so shadows don't dominate hue matching.
  const y = (r + 2 * g + b) / 4;
  return [y, r - b, g - (r + b) / 2];
}

const anchors = palette.map((rgb) => coordinates(rgb >> 16, (rgb >> 8) & 255, rgb & 255));
const nearest = new Uint8Array(32768);
const runnerUp = new Uint8Array(nearest.length);
const runnerUpShare = new Uint8Array(nearest.length);
for (let key = 0; key < nearest.length; key++) {
  const pixel = coordinates((key >> 10) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4);
  const ranked = anchors
    .map((anchor, index) => ({
      index,
      distance: Math.min(
        Math.hypot(...anchor.map((channel, i) => channel - pixel[i]!)),
        // Chromatic dyes also occur as muted materials. Keep their brightness and hue.
        Math.hypot(
          anchor[0]! - pixel[0]!,
          anchor[1]! * 0.4 - pixel[1]!,
          anchor[2]! * 0.4 - pixel[2]!,
        ) + 8,
      ),
    }))
    .sort((a, b) => a.distance - b.distance);
  const [best, next] = ranked;
  nearest[key] = best!.index;
  runnerUp[key] = next!.index;
  // A pixel near the boundary between two dyes lends part of its vote to both.
  const gap = next!.distance - best!.distance;
  runnerUpShare[key] = Math.round(128 * Math.max(0, 1 - gap / 32));
}

export async function buildBlockColors(root = process.cwd()) {
  const profiles = new Map<string, number>();
  const sheets: Record<string, string> = {};
  const directories = await readdir(join(root, 'public/data'), { withFileTypes: true });
  for (const directory of directories.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
    const dataset = directory.name;
    const manifest = JSON.parse(
      await readFile(join(root, `public/data/${dataset}/pack-manifest.json`), 'utf8'),
    ) as {
      iconSheets: { sha256: string; columns: number; spriteSize: number; iconCount: number }[];
    };
    for (const { sha256, columns, spriteSize, iconCount } of manifest.iconSheets) {
      if (sheets[sha256]) continue;
      const { data, info } = await sharp(join(root, `public/assets/sha256/${sha256}`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let result = '';
      for (let index = 0; index < iconCount; index++) {
        const votes = new Uint32Array(16);
        const left = (index % columns) * spriteSize;
        const top = Math.floor(index / columns) * spriteSize;
        for (let y = top; y < top + spriteSize; y++)
          for (let x = left; x < left + spriteSize; x++) {
            const offset = (y * info.width + x) * 4;
            const key =
              ((data[offset]! >> 3) << 10) |
              ((data[offset + 1]! >> 3) << 5) |
              (data[offset + 2]! >> 3);
            const alpha = data[offset + 3]!;
            if (alpha >= 128) {
              // Rendered cube sides are darker than the material. Give brighter
              // visible faces more influence without dropping all shadow colors.
              const brightness = (data[offset]! + 2 * data[offset + 1]! + data[offset + 2]!) / 4;
              const weight = Math.round(alpha * (0.15 + (brightness / 255) ** 2));
              const share = runnerUpShare[key]!;
              votes[nearest[key]!]! += weight * (256 - share);
              votes[runnerUp[key]!]! += weight * share;
            }
          }
        const total = votes.reduce((sum, vote) => sum + vote, 0);
        // Store each coverage score in a single hex digit.
        const profile = Array.from(votes, (vote) =>
          Math.round(total ? (vote / total) * 15 : 0).toString(16),
        ).join('');
        const code = profiles.get(profile) ?? profiles.size;
        profiles.set(profile, code);
        result +=
          colorScoreDigits[code >> 12]! +
          colorScoreDigits[(code >> 6) & 63]! +
          colorScoreDigits[code & 63]!;
      }
      sheets[sha256] = result;
    }
  }
  await writeFile(
    join(root, 'src/lib/generated/block-colors.json'),
    JSON.stringify(
      {
        profiles: [...profiles.keys()].join(''),
        sheets: Object.fromEntries(Object.entries(sheets).sort()),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Indexed ${Object.keys(sheets).length} sprite sheets`);
}
