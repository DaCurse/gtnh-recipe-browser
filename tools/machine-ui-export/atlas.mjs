import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, copyFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve('public/assets/machine-ui');
const originals = resolve('assets/source/machine-ui/textures');
await mkdir(originals, { recursive: true });
const dataPath = resolve('src/lib/generated/machine-ui.json');
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const needed = new Set();
function visit(value, action) {
  if (!value || typeof value !== 'object') return;
  if (value.file && value.size && value.uv) {
    action(value);
    return;
  }
  for (const child of Object.values(value)) visit(child, action);
}
visit(data, (texture) => needed.add(texture.file));
const images = await Promise.all(
  [...needed].sort().map(async (file) => {
    const buffer = await readFile(join(directory, file));
    const { width, height } = await sharp(buffer).metadata();
    return { file, buffer, width, height };
  }),
);
const width = Math.max(1024, ...images.map((image) => image.width + 4));
let x = 2,
  y = 2,
  rowHeight = 0;
const regions = {};
for (const image of images) {
  if (x + image.width + 2 > width) {
    x = 2;
    y += rowHeight + 2;
    rowHeight = 0;
  }
  regions[image.file] = { x, y, width: image.width, height: image.height };
  x += image.width + 2;
  rowHeight = Math.max(rowHeight, image.height);
}
const height = y + rowHeight + 2;
// Copy straight RGBA bytes, avoiding premultiplication rounding on translucent pixels.
const pixels = Buffer.alloc(width * height * 4);
for (const image of images) {
  const rgba = await sharp(image.buffer).ensureAlpha().raw().toBuffer();
  const region = regions[image.file];
  for (let row = 0; row < image.height; row++) {
    rgba.copy(
      pixels,
      ((region.y + row) * width + region.x) * 4,
      row * image.width * 4,
      (row + 1) * image.width * 4,
    );
  }
}
const atlas = await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toBuffer();
if (!(await sharp(atlas).ensureAlpha().raw().toBuffer()).equals(pixels)) {
  throw new Error('UI atlas PNG encoding changed original RGBA pixels');
}
const filename = `atlas-${createHash('sha256').update(atlas).digest('hex').slice(0, 20)}.png`;
await writeFile(join(directory, filename), atlas);
visit(data, (texture) => {
  const region = regions[texture.file];
  const [u0, v0, u1, v1] = texture.uv;
  texture.file = filename;
  texture.size = [width, height];
  texture.uv = [
    (region.x + u0 * region.width) / width,
    (region.y + v0 * region.height) / height,
    (region.x + u1 * region.width) / width,
    (region.y + v1 * region.height) / height,
  ];
});
// Intern shared texture crops instead of repeating long atlas UVs in every slot.
const textures = [];
const textureIds = new Map();
function compact(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.file && value.size && value.uv) {
    const key = JSON.stringify(value.uv);
    if (!textureIds.has(key)) {
      textureIds.set(key, textures.length);
      textures.push(value.uv);
    }
    return textureIds.get(key);
  }
  if (Array.isArray(value)) return value.map(compact);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compact(child)]));
}
const compacted = compact(data);
compacted.atlas = { file: filename, size: [width, height] };
compacted.textures = textures;
await writeFile(dataPath, JSON.stringify(compacted) + '\n');
await writeFile(
  'assets/source/machine-ui/atlas.json',
  JSON.stringify({ file: filename, width, height, regions }, null, 2) + '\n',
);
for (const file of await readdir(directory)) {
  if (/^[a-f0-9]{20}\.png$/.test(file))
    await copyFile(join(directory, file), join(originals, file));
}
// This directory is exclusively owned by this generator; retain just the shared atlas and native cells.
for (const file of await readdir(directory)) {
  if (/^(?:[a-f0-9]{20}|atlas-[a-f0-9]{20})\.png$/.test(file) && file !== filename)
    await unlink(join(directory, file));
}
console.log(
  `Packed ${images.length} original UI sprites into ${width}x${height}, ${atlas.length} bytes`,
);
