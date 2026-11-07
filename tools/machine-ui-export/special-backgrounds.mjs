import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Shadow UI 5.47, CropsNH 2.0.140 drawBackground: source (5,11), 166px wide.
const [resourcePack] = process.argv.slice(2);
if (!resourcePack) throw new Error('Usage: node tools/machine-ui-export/special-backgrounds.mjs <Shadow-UI.zip>');
const hash = value => createHash('sha256').update(value).digest('hex');
const resourcePackSha256 = hash(await readFile(resourcePack));
if (resourcePackSha256 !== 'dbff3a014e64703df3cd82c0ae46ca8762d7da851bafe2e18752dc46c6eff273') throw new Error('Expected the pinned standard Shadow UI 5.47 pack');
await mkdir('public/assets/machine-ui', { recursive: true });
const sourceDir = 'assets/source/machine-ui/special';
await mkdir(sourceDir, { recursive: true });
const images = [];
for (const [name, height] of [['breeding2', 87], ['breeding4', 87], ['cropList', 85]]) {
  const path = `assets/cropsnh/textures/gui/nei/${name}.png`;
  const source = execFileSync('unzip', ['-p', resourcePack, path]);
  const image = await sharp(source).extract({ left: 5, top: 11, width: 166, height }).png().toBuffer();
  await writeFile(`public/assets/machine-ui/crops-${name}.png`, image);
  await writeFile(`${sourceDir}/${name}.png`, source);
  images.push({ path, sourceSha256: hash(source), output: `crops-${name}.png`, outputSha256: hash(image), crop: [5, 11, 166, height] });
}
await writeFile(`${sourceDir}/provenance.json`, JSON.stringify({
  resourcePack: 'Shadow UI 5.47', resourcePackSha256,
  license: 'CC-BY-NC-SA-4.0', cropsNhVersion: '2.0.140',
  cropsNhRef: 'db0a9936bdcc00ac72c083790dbce8c76b73df41', images
}, null, 2) + '\n');
