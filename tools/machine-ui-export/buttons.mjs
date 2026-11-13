import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const zip = process.argv[2];
if (!zip) throw new Error('Usage: node tools/machine-ui-export/buttons.mjs <Shadow.UI.v5.47.zip>');
const pinned = JSON.parse(
  await readFile('assets/source/machine-ui/shadow-ui-provenance.json', 'utf8'),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (digest(await readFile(zip)) !== pinned.sha256)
  throw new Error('Shadow UI ZIP does not match the pinned release');
const resource = 'assets/minecraft/textures/gui/widgets.png';
const widgets = execFileSync('python3', [
  '-c',
  'import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
  zip,
  resource,
]);
const destination = 'assets/source/machine-ui/buttons';
await mkdir(destination, { recursive: true });
await writeFile(`${destination}/widgets.png`, widgets);
const slices = {};
for (const [state, top] of [
  ['disabled', 46],
  ['normal', 66],
  ['hover', 86],
]) {
  const bounds = { left: 0, top, width: 200, height: 20 };
  const file = `public/assets/machine-ui/button-${state}.png`;
  const bytes = await sharp(widgets).extract(bounds).png().toBuffer();
  await writeFile(file, bytes);
  slices[state] = { bounds, file, sha256: digest(bytes) };
}
await writeFile(
  `${destination}/provenance.json`,
  JSON.stringify(
    {
      resource,
      sourceSha256: digest(widgets),
      packSha256: pinned.sha256,
      license: pinned.license,
      processing:
        'Exact source crops; no recolouring. CSS stretches the flat centre and preserves the bevel.',
      slices,
    },
    null,
    2,
  ) + '\n',
);
