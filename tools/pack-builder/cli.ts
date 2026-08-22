#!/usr/bin/env node
import { buildPack, type BuildPackOptions } from './builder';

function usage(): never {
  console.error(`Usage:
  npm run pack -- --data <data.bin> --atlas <atlas.webp> --gtnh-version <version> \\
    --revision <immutable-revision> --output <directory> [--dataset-id <id>] \\
    [--display-name <name>] [--base-url <url>] [--max-shard-bytes <bytes>] \\
    [--special-data <browser-nei-special.json>] [--max-special-shard-bytes <bytes>]

The output directory must not already exist. Inputs must be ShadowTheAge format-v5 assets.`);
  process.exit(2);
}

function parseArguments(args: string[]): BuildPackOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) usage();
    values.set(key.slice(2), value);
  }
  const required = (key: string) => values.get(key) ?? usage();
  const maxShardBytes = values.has('max-shard-bytes')
    ? Number.parseInt(required('max-shard-bytes'), 10)
    : undefined;
  if (maxShardBytes !== undefined && (!Number.isFinite(maxShardBytes) || maxShardBytes < 1024)) {
    throw new Error('--max-shard-bytes must be an integer of at least 1024');
  }
  const maxSpecialShardBytes = values.has('max-special-shard-bytes')
    ? Number.parseInt(required('max-special-shard-bytes'), 10)
    : undefined;
  if (maxSpecialShardBytes !== undefined && (!Number.isFinite(maxSpecialShardBytes) || maxSpecialShardBytes < 1024)) {
    throw new Error('--max-special-shard-bytes must be an integer of at least 1024');
  }
  return {
    dataPath: required('data'),
    atlasPath: required('atlas'),
    gtnhVersion: required('gtnh-version'),
    revision: required('revision'),
    outputDirectory: required('output'),
    datasetId: values.get('dataset-id'),
    displayName: values.get('display-name'),
    baseUrl: values.get('base-url'),
    maxShardBytes,
    specialDataPath: values.get('special-data'),
    maxSpecialShardBytes
  };
}

try {
  const result = await buildPack(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify({
    manifest: result.manifestPath,
    datasetId: result.manifest.datasetId,
    assets: result.manifest.totals.assets,
    offlineBytes: result.manifest.totals.offlineBytes
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
