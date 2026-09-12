import { createHash } from 'node:crypto';

const baseUrl = process.argv[2];
if (!baseUrl) {
  throw new Error(
    'Usage: node tools/deployment-smoke.mjs <deployed-base-url> '
    + '[--manifest <relative-manifest-url>] [--all-assets] [--require-special]'
  );
}
const manifestArgument = process.argv.indexOf('--manifest');
const directManifest = manifestArgument >= 0 ? process.argv[manifestArgument + 1] : undefined;
if (manifestArgument >= 0 && !directManifest) throw new Error('--manifest requires a URL');
const verifyAllAssets = process.argv.includes('--all-assets');
const requireSpecial = process.argv.includes('--require-special') || !directManifest;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

async function fetchOk(url, label) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`${label}: ${response.status} ${response.statusText} (${url})`);
  }
  return response;
}

async function fetchJson(url, label) {
  return fetchOk(url, label).then((response) => response.json());
}

async function verifyAsset(asset, manifestUrl, label) {
  const url = new URL(asset.url, manifestUrl);
  const bytes = new Uint8Array(await fetchOk(url, label).then((response) => response.arrayBuffer()));
  if (bytes.byteLength !== asset.bytes) {
    throw new Error(`${label}: expected ${asset.bytes} bytes, received ${bytes.byteLength}`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.sha256) {
    throw new Error(`${label}: SHA-256 mismatch (${digest})`);
  }
  console.log(`Verified ${label}: ${bytes.byteLength.toLocaleString('en-US')} bytes`);
}

function assertPhysicalDescriptor(asset, label) {
  if (
    !asset
    || typeof asset !== 'object'
    || typeof asset.url !== 'string'
    || asset.url.length === 0
    || asset.segments !== undefined
    || !Number.isSafeInteger(asset.bytes)
    || asset.bytes < 0
    || typeof asset.sha256 !== 'string'
    || !SHA256_PATTERN.test(asset.sha256)
  ) {
    throw new Error(`${label}: invalid physical asset descriptor`);
  }
}

function assertVirtualDescriptor(asset, label, recordPageCount) {
  if (
    !asset
    || typeof asset !== 'object'
    || asset.url !== ''
    || asset.encoding !== 'identity'
    || !Number.isSafeInteger(asset.bytes)
    || asset.bytes < 0
    || typeof asset.sha256 !== 'string'
    || !SHA256_PATTERN.test(asset.sha256)
    || !Array.isArray(asset.segments)
    || asset.segments.length === 0
  ) {
    throw new Error(`${label}: invalid virtual asset descriptor`);
  }
  for (const [index, segment] of asset.segments.entries()) {
    if (
      !Array.isArray(segment)
      || segment.length !== 3
      || !Number.isSafeInteger(segment[0])
      || segment[0] < 0
      || segment[0] >= recordPageCount
      || !Number.isSafeInteger(segment[1])
      || segment[1] < 0
      || !Number.isSafeInteger(segment[2])
      || segment[2] < 1
    ) {
      throw new Error(`${label}: invalid record-page segment ${index}`);
    }
  }
}

function validateFormat6Manifest(manifest) {
  if (
    manifest.formatVersion !== 6
    || typeof manifest.datasetId !== 'string'
    || !Array.isArray(manifest.catalogAssets)
    || !Array.isArray(manifest.recipeShards)
    || !Array.isArray(manifest.specialDataShards)
    || !Array.isArray(manifest.recordPages)
    || !Array.isArray(manifest.iconSheets)
    || manifest.recordPages.length === 0
    || manifest.iconSheets.length === 0
  ) {
    throw new Error('pack manifest: identity or format mismatch');
  }
  for (const [index, page] of manifest.recordPages.entries()) {
    assertPhysicalDescriptor(page, `record page ${index}`);
  }
  for (const [index, sheet] of manifest.iconSheets.entries()) {
    assertPhysicalDescriptor(sheet, `icon sheet ${index}`);
  }
  for (const [index, asset] of manifest.catalogAssets.entries()) {
    assertVirtualDescriptor(asset, `catalog asset ${index}`, manifest.recordPages.length);
  }
  for (const [index, asset] of manifest.recipeShards.entries()) {
    assertVirtualDescriptor(asset, `recipe shard ${index}`, manifest.recordPages.length);
  }
  for (const [index, asset] of manifest.specialDataShards.entries()) {
    assertVirtualDescriptor(asset, `special data shard ${index}`, manifest.recordPages.length);
  }
  return [...manifest.recordPages, ...manifest.iconSheets];
}

const appUrl = new URL('./', baseUrl);
const html = await fetchOk(appUrl, 'application shell').then((response) => response.text());
if (!html.includes('GTNH Recipe Browser')) {
  throw new Error('application shell: expected title was not found');
}

let expectedDatasetId;
let manifestUrl;
if (directManifest) {
  manifestUrl = new URL(directManifest, appUrl);
} else {
  const versionsUrl = new URL('versions.json', appUrl);
  const versionIndex = await fetchJson(versionsUrl, 'version index');
  if (
    versionIndex.schemaVersion !== 1
    || !Array.isArray(versionIndex.versions)
    || !versionIndex.versions[0]
  ) {
    throw new Error('version index: no supported dataset is published');
  }
  const version = versionIndex.versions[0];
  expectedDatasetId = version.datasetId;
  manifestUrl = new URL(version.packManifestUrl, versionsUrl);
}
const manifest = await fetchJson(manifestUrl, 'pack manifest');
if (
  manifest.formatVersion !== 6
  || typeof manifest.datasetId !== 'string'
  || (expectedDatasetId && manifest.datasetId !== expectedDatasetId)
) {
  throw new Error('pack manifest: identity or format mismatch');
}
const physicalAssets = validateFormat6Manifest(manifest);
if (requireSpecial && (
  manifest.formatVersion !== 6
  || !Array.isArray(manifest.specialDataShards)
  || manifest.specialDataShards.length === 0
  || (manifest.totals?.specialRecords ?? 0) <= 0
)) {
  throw new Error('pack manifest: deployed default is not a verified special-data release');
}

const assets = verifyAllAssets
  ? physicalAssets.map((asset) => [asset, asset.id])
  : [
      [manifest.recordPages[0], 'record page'],
      [manifest.iconSheets[0], 'icon sheet']
    ];
let nextAsset = 0;
async function verifyNextAsset() {
  while (nextAsset < assets.length) {
    const [asset, label] = assets[nextAsset++] ?? [];
    if (!asset) throw new Error(`pack manifest: missing ${label}`);
    await verifyAsset(asset, manifestUrl, label);
  }
}
await Promise.all(Array.from(
  { length: Math.min(6, assets.length) },
  () => verifyNextAsset()
));

console.log(
  `Deployment smoke test passed: ${appUrl} (${assets.length} assets)`
);
