#!/usr/bin/env node
import { verifyPack } from './verifier';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const packDirectory = argument('pack');
if (!packDirectory) {
  console.error('Usage: npm run verify-pack -- --pack <directory> [--atlas <atlas.webp>] [--sprite-samples <count>]');
  process.exit(2);
}

try {
  const result = await verifyPack({
    packDirectory,
    atlasPath: argument('atlas'),
    spriteSamples: argument('sprite-samples') ? Number.parseInt(argument('sprite-samples')!, 10) : undefined
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
