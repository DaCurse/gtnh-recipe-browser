#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argumentsMap, requiredArgument } from './lib';
import { recoverSpecialSidecar } from './recover-special';

function usage(): string {
  return [
    'Recover canonical browser goods IDs in a raw NESQL NEI-special sidecar.',
    '',
    'Usage:',
    '  npm run export:recover-special -- --sidecar <json> --script <nesql-db.script> --output <json>',
    '',
    'The source sidecar and HSQL script are read-only. The output is written as a',
    'validated, deterministic sidecar and is never overwritten.'
  ].join('\n');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage());
  process.exit(0);
}

const options = argumentsMap(args);
const sidecarPath = resolve(requiredArgument(options, 'sidecar'));
const scriptPath = resolve(requiredArgument(options, 'script'));
const outputPath = resolve(requiredArgument(options, 'output'));
const result = await recoverSpecialSidecar(sidecarPath, scriptPath);
await writeFile(outputPath, `${JSON.stringify(result.data, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  sidecarPath,
  scriptPath,
  outputPath,
  replacedIds: result.replacedIds.length,
  unresolvedRawIds: result.unresolvedRawIds.length
}, null, 2));
