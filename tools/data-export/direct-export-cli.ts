#!/usr/bin/env node
import { resolve } from 'node:path';
import { orchestrateDirectExport, type DirectExportOptions } from './direct-export';

interface CliOptions extends DirectExportOptions {
  help: boolean;
}

function usage(): string {
  return [
    'One-command direct GTNH export orchestrator',
    '',
    'Usage:',
    '  npm run export:direct -- [options]',
    '',
    'Profile/cache/workspace:',
    '  --version <version>       Reviewed profile (default: 2.9.0-beta-2)',
    '  --cache-dir <directory>   Archive/runtime/status cache root',
    '  --archive <file>          Verify and use a local archive instead of downloading',
    '  --work-dir <directory>    Fresh disposable export workspace',
    '  --instance-dir <dir>      Fresh prepared client directory',
    '',
    'Client identity/automation:',
    '  --username <name>         Offline Minecraft identity (default: GTNH)',
    '  --repository <name>       Export repository name (default: browser-export)',
    '  --world <name>            Creative world name (default: browser-export-world)',
    '  --status-file <file>      Orchestrator status JSON',
    '  --launcher-status <file>  Direct JVM launcher status JSON',
    '  --automation-status <file> ExportAutomationController status JSON',
    '',
    'JVM/display/timeouts:',
    '  --java <command>          Java executable (default: $JAVA or java)',
    '  --xvfb-run <command>      xvfb-run executable (default: xvfb-run)',
    '  --xvfb-arg <argument>     Additional xvfb-run argument (repeatable)',
    '  --no-xvfb                 Do not wrap Java in xvfb-run',
    '  --xms <size>              Initial heap (default: 2G)',
    '  --xmx <size>              Maximum heap (default: 8G)',
    '  --launch-timeout <ms>     Launcher wall-clock timeout (default: 2700000)',
    '  --automation-timeout <ms> Export controller timeout (default: 2700000)',
    '  --poll-interval <ms>      Status polling interval (default: 1000)',
    '  --jvm-arg <argument>      Extra JVM argument (repeatable)',
    '',
    'The orchestrator verifies the official archive byte size and SHA-256 before preparing the disposable client.'
  ].join('\n');
}

function takeValue(args: string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function numberValue(value: string, flag: string): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${flag} must be a positive integer`);
  return result;
}

function parseCli(args: string[]): CliOptions {
  const result: CliOptions = {
    help: false,
    xvfbArgs: ['-a', '--server-args=-screen 0 1280x720x24'],
    useXvfb: true,
    jvmArgs: []
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === '--help' || flag === '-h') {
      result.help = true;
      continue;
    }
    if (flag === '--no-xvfb') {
      result.useXvfb = false;
      continue;
    }
    let value: string;
    if (flag === '--version') {
      [value, index] = takeValue(args, index, flag);
      result.profile = value;
    } else if (flag === '--cache-dir') {
      [value, index] = takeValue(args, index, flag);
      result.cacheDirectory = value;
    } else if (flag === '--archive') {
      [value, index] = takeValue(args, index, flag);
      result.archiveSourcePath = value;
    } else if (flag === '--work-dir') {
      [value, index] = takeValue(args, index, flag);
      result.workDirectory = value;
    } else if (flag === '--instance-dir') {
      [value, index] = takeValue(args, index, flag);
      result.instanceDirectory = value;
    } else if (flag === '--username') {
      [value, index] = takeValue(args, index, flag);
      result.username = value;
    } else if (flag === '--repository') {
      [value, index] = takeValue(args, index, flag);
      result.repositoryName = value;
    } else if (flag === '--world') {
      [value, index] = takeValue(args, index, flag);
      result.worldName = value;
    } else if (flag === '--status-file') {
      [value, index] = takeValue(args, index, flag);
      result.statusFile = value;
    } else if (flag === '--launcher-status') {
      [value, index] = takeValue(args, index, flag);
      result.launcherStatusFile = value;
    } else if (flag === '--automation-status') {
      [value, index] = takeValue(args, index, flag);
      result.automationStatusFile = value;
    } else if (flag === '--java') {
      [value, index] = takeValue(args, index, flag);
      result.java = value;
    } else if (flag === '--xvfb-run') {
      [value, index] = takeValue(args, index, flag);
      result.xvfbRun = value;
    } else if (flag === '--xvfb-arg') {
      [value, index] = takeValue(args, index, flag);
      result.xvfbArgs!.push(value);
    } else if (flag === '--xms') {
      [value, index] = takeValue(args, index, flag);
      result.xms = value;
    } else if (flag === '--xmx') {
      [value, index] = takeValue(args, index, flag);
      result.xmx = value;
    } else if (flag === '--launch-timeout') {
      [value, index] = takeValue(args, index, flag);
      result.launchTimeoutMs = numberValue(value, flag);
    } else if (flag === '--automation-timeout') {
      [value, index] = takeValue(args, index, flag);
      result.automationTimeoutMs = numberValue(value, flag);
    } else if (flag === '--poll-interval') {
      [value, index] = takeValue(args, index, flag);
      result.pollIntervalMs = numberValue(value, flag);
    } else if (flag === '--jvm-arg') {
      [value, index] = takeValue(args, index, flag);
      result.jvmArgs!.push(value);
    } else {
      throw new Error(`Unknown argument ${flag}`);
    }
  }
  return result;
}

export async function runDirectExportCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseCli(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const result = await orchestrateDirectExport(options);
  process.stdout.write(`${JSON.stringify({
    profile: result.profile.version,
    archive: result.archive.path,
    session: result.sessionPath,
    pack: result.processResult.packDirectory,
    result: result.resultPath,
    status: result.statusFile,
    launcherStatus: result.launcherStatusFile,
    automationStatus: result.automationStatusFile
  }, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runDirectExportCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  );
}
