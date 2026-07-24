import { createHash } from 'node:crypto';

const baseUrl = process.argv[2];
if (!baseUrl) {
  throw new Error(
    'Usage: node tools/deployment-smoke.mjs <deployed-base-url> '
    + '[--manifest <relative-manifest-url>] [--all-assets]'
  );
}
const manifestArgument = process.argv.indexOf('--manifest');
const directManifest = manifestArgument >= 0 ? process.argv[manifestArgument + 1] : undefined;
if (manifestArgument >= 0 && !directManifest) throw new Error('--manifest requires a URL');
const verifyAllAssets = process.argv.includes('--all-assets');

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
  ![1, 2].includes(manifest.formatVersion)
  || typeof manifest.datasetId !== 'string'
  || (expectedDatasetId && manifest.datasetId !== expectedDatasetId)
) {
  throw new Error('pack manifest: identity or format mismatch');
}

const listedAssets = [
  ...(manifest.catalogAssets ?? []),
  ...(manifest.recipeShards ?? []),
  ...(manifest.iconSheets ?? [])
];
const assets = verifyAllAssets
  ? listedAssets.map((asset) => [asset, asset.id])
  : [
      [manifest.catalogAssets?.[0], 'catalog asset'],
      [manifest.recipeShards?.[0], 'recipe shard'],
      [manifest.iconSheets?.[0], 'icon sheet']
    ];
for (const [asset, label] of assets) {
  if (!asset) throw new Error(`pack manifest: missing ${label}`);
  await verifyAsset(asset, manifestUrl, label);
}

console.log(
  `Deployment smoke test passed: ${appUrl} (${verifyAllAssets ? listedAssets.length : 3} assets)`
);
