#!/usr/bin/env node
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createLaunchPlan,
  launchRuntime,
  resolveRuntime,
  runtimePlanJson,
  type RuntimeIdentity
} from './direct-runtime';

interface CliOptions {
  root?: string;
  cacheDirectory?: string;
  gameDirectory?: string;
  nativesDirectory?: string;
  username?: string;
  uuid?: string;
  accessToken?: string;
  userProperties?: string;
  userType?: string;
  java?: string;
  xvfbRun?: string;
  xvfbArgs: string[];
  useXvfb: boolean;
  dryRun: boolean;
  launch: boolean;
  launchPlan?: string;
  noDownload: boolean;
  noExtractNatives: boolean;
  timeoutMs?: number;
  statusFile?: string;
  jvmArgs: string[];
  gameArgs: string[];
}

function usage(): string {
  return [
    'Direct GTNH JVM runtime resolver/launcher (no Prism dependency)',
    '',
    'Usage:',
    '  npm run export:runtime -- --archive <pack.zip> [options]',
    '  npm run export:runtime -- --root <unpacked-pack> [options]',
    '',
    'Actions:',
    '  --dry-run                  Resolve and print a machine-readable launch plan',
    '  --launch-plan <file|->     Write the JSON launch plan to a file (or stdout with -)',
    '  --launch                   Launch the resolved main class',
    '',
    'Runtime options:',
    '  --cache-dir <directory>    Immutable artifact/cache root',
    '  --game-dir <directory>    Game directory (default: pack .minecraft)',
    '  --username <name>          Offline username (default: GTNH)',
    '  --uuid <uuid>              Override deterministic offline UUID',
    '  --java <command>           Java executable (default: $JAVA or java)',
    '  --xvfb-run <command>       xvfb-run executable (default: xvfb-run)',
    '  --xvfb-arg <argument>      Additional xvfb-run argument (repeatable)',
    '  --no-xvfb                  Launch Java without xvfb-run',
    '  --timeout <milliseconds>   Stop a hung launch after this duration',
    '  --status-file <file>       Atomically updated launch status JSON',
    '  --no-download               Require all remote artifacts/assets in cache',
    '  --no-extract-natives       Skip native JAR extraction',
    '  --jvm-arg <argument>       Append a JVM argument (repeatable)',
    '  --game-arg <argument>      Append a game argument (repeatable)',
    '',
    'The default archive is .export-work/2.9.0-beta-2/source/GT_New_Horizons_2.9.0-beta-2_Java_17-25.zip when present.'
  ].join('\n');
}

function takeValue(args: string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function milliseconds(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid timeout ${value}`);
  return parsed;
}

function parseCli(args: string[]): CliOptions {
  const result: CliOptions = {
    xvfbArgs: ['-a'],
    useXvfb: true,
    dryRun: false,
    launch: false,
    noDownload: false,
    noExtractNatives: false,
    jvmArgs: [],
    gameArgs: []
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--dry-run' || argument === '--plan') {
      result.dryRun = true;
    } else if (argument === '--launch') {
      result.launch = true;
    } else if (argument === '--no-xvfb') {
      result.useXvfb = false;
    } else if (argument === '--no-download') {
      result.noDownload = true;
    } else if (argument === '--no-extract-natives') {
      result.noExtractNatives = true;
    } else if (argument === '--archive' || argument === '--pack' || argument === '--root') {
      const [value, next] = takeValue(args, index, argument);
      result.root = value;
      index = next;
    } else if (argument === '--cache-dir') {
      const [value, next] = takeValue(args, index, argument);
      result.cacheDirectory = value;
      index = next;
    } else if (argument === '--game-dir') {
      const [value, next] = takeValue(args, index, argument);
      result.gameDirectory = value;
      index = next;
    } else if (argument === '--natives-dir') {
      const [value, next] = takeValue(args, index, argument);
      result.nativesDirectory = value;
      index = next;
    } else if (argument === '--username') {
      const [value, next] = takeValue(args, index, argument);
      result.username = value;
      index = next;
    } else if (argument === '--uuid') {
      const [value, next] = takeValue(args, index, argument);
      result.uuid = value;
      index = next;
    } else if (argument === '--access-token') {
      const [value, next] = takeValue(args, index, argument);
      result.accessToken = value;
      index = next;
    } else if (argument === '--user-properties') {
      const [value, next] = takeValue(args, index, argument);
      result.userProperties = value;
      index = next;
    } else if (argument === '--user-type') {
      const [value, next] = takeValue(args, index, argument);
      result.userType = value;
      index = next;
    } else if (argument === '--java') {
      const [value, next] = takeValue(args, index, argument);
      result.java = value;
      index = next;
    } else if (argument === '--xvfb-run') {
      const [value, next] = takeValue(args, index, argument);
      result.xvfbRun = value;
      index = next;
    } else if (argument === '--xvfb-arg') {
      const [value, next] = takeValue(args, index, argument);
      result.xvfbArgs.push(value);
      index = next;
    } else if (argument === '--timeout') {
      const [value, next] = takeValue(args, index, argument);
      result.timeoutMs = milliseconds(value);
      index = next;
    } else if (argument === '--status-file') {
      const [value, next] = takeValue(args, index, argument);
      result.statusFile = value;
      index = next;
    } else if (argument === '--launch-plan') {
      const [value, next] = takeValue(args, index, argument);
      result.launchPlan = value;
      index = next;
    } else if (argument === '--jvm-arg') {
      const [value, next] = takeValue(args, index, argument);
      result.jvmArgs.push(value);
      index = next;
    } else if (argument === '--game-arg') {
      const [value, next] = takeValue(args, index, argument);
      result.gameArgs.push(value);
      index = next;
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  return result;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writePlan(path: string, plan: ReturnType<typeof createLaunchPlan>): Promise<void> {
  const json = runtimePlanJson(plan);
  if (path === '-') {
    process.stdout.write(json);
    return;
  }
  await writeFile(resolve(path), json, 'utf8');
}

export async function runDirectRuntimeCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseCli(args);
  const defaultArchive = '.export-work/2.9.0-beta-2/source/GT_New_Horizons_2.9.0-beta-2_Java_17-25.zip';
  const root = options.root ?? (await pathExists(defaultArchive) ? defaultArchive : undefined);
  if (!root) throw new Error('Missing --archive, --pack, or --root (and the default GTNH archive was not found)');
  const identity: Partial<RuntimeIdentity> = {
    username: options.username,
    uuid: options.uuid,
    accessToken: options.accessToken,
    userProperties: options.userProperties,
    userType: options.userType
  };
  const resolution = await resolveRuntime({
    root,
    cacheDirectory: options.cacheDirectory,
    gameDirectory: options.gameDirectory,
    nativesDirectory: options.nativesDirectory,
    identity,
    download: !options.noDownload,
    extractNatives: !options.noExtractNatives
  });
  resolution.jvmArgs.push(...options.jvmArgs);
  resolution.gameArgs.push(...options.gameArgs);
  const plan = createLaunchPlan(resolution, {
    java: options.java,
    xvfbRun: options.xvfbRun,
    xvfbArgs: options.xvfbArgs,
    useXvfb: options.useXvfb,
    timeoutMs: options.timeoutMs,
    statusFile: options.statusFile
  });
  if (options.launchPlan) await writePlan(options.launchPlan, plan);
  if (options.dryRun || !options.launch) {
    if (!options.launchPlan) process.stdout.write(runtimePlanJson(plan));
    return 0;
  }
  const status = await launchRuntime(plan, { statusFile: options.statusFile });
  if (!options.launchPlan) process.stderr.write(`${JSON.stringify(status)}\n`);
  return status.state === 'exited' && status.exitCode === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runDirectRuntimeCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  );
}

