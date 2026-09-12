#!/usr/bin/env node
import { verifyPack } from './verifier';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const packDirectory = argument('pack');
if (!packDirectory) {
  console.error('Usage: npm run verify-pack -- --pack <directory> [--asset-directory <directory>] [--data <data.bin>] [--layout <shared-layout.json>] [--atlas <atlas.webp>] [--special-data <browser-nei-special.json>] [--sprite-samples <count>]');
  process.exit(2);
}

try {
  const result = await verifyPack({
    packDirectory,
    assetDirectory: argument('asset-directory'),
    dataPath: argument('data'),
    layoutPath: argument('layout'),
    atlasPath: argument('atlas'),
    specialDataPath: argument('special-data'),
    spriteSamples: argument('sprite-samples') ? Number.parseInt(argument('sprite-samples')!, 10) : undefined
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
