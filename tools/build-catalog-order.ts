import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCatalogOrder, publishCatalogOrder } from './catalog-order';
import { decodeFormat5 } from './pack-builder/decoder';
import type { GeneratedPackManifest } from './pack-builder/manifest';

const [dataPath, packPath] = process.argv.slice(2);
if (!dataPath || !packPath) throw new Error('Usage: tsx tools/build-catalog-order.ts <processed-data.bin> <published-pack>');
const bytes = await readFile(dataPath);
const manifest = JSON.parse(await readFile(join(packPath, 'pack-manifest.json'), 'utf8')) as GeneratedPackManifest;
if (createHash('sha256').update(bytes).digest('hex') !== manifest.source.dataSha256) {
  throw new Error('Processed data does not match the immutable recipe pack');
}
await publishCatalogOrder(process.cwd(), manifest, buildCatalogOrder(decodeFormat5(bytes, { recipes: false }), manifest));
console.log(`Published numeric catalogue ordering for ${manifest.datasetId}`);
