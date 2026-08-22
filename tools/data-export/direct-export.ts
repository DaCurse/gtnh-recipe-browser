import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createLaunchPlan,
  launchRuntime,
  resolveRuntime,
  type LaunchOptions,
  type RuntimeLaunchPlan,
  type RuntimeLaunchStatus
} from './direct-runtime';
import {
  assertPathMissing,
  readExportSession,
  type ExportSession
} from './lib';

const DEFAULT_CACHE_DIRECTORY = '.export-work/direct-export-cache';
const DEFAULT_XMS = '2G';
const DEFAULT_XMX = '8G';
const DEFAULT_LAUNCH_TIMEOUT_MS = 45 * 60 * 1_000;
const DEFAULT_AUTOMATION_TIMEOUT_MS = 45 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SHA1_PATTERN = /^[a-f0-9]{40}$/i;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface DirectExportProfile {
  version: string;
  archiveFileName: string;
  clientUrl: string;
  bytes: number;
  sha256: string;
  sourcePage: string;
}

export const DIRECT_EXPORT_PROFILES: Readonly<Record<string, DirectExportProfile>> = {
  '2.9.0-beta-2': {
    version: '2.9.0-beta-2',
    archiveFileName: 'GT_New_Horizons_2.9.0-beta-2_Java_17-25.zip',
    clientUrl:
      'https://downloads.gtnewhorizons.com/Multi_mc_downloads/betas/GT_New_Horizons_2.9.0-beta-2_Java_17-25.zip',
    bytes: 680_333_339,
    sha256: 'adb853b49e5e17cfe595a8c63c85e2f230c2d03d8aed0ac42bc83c475a1bcbee',
    sourcePage: 'https://www.gtnewhorizons.com/version-history/'
  }
};

export interface ArchiveDownloadResult {
  path: string;
  bytes: number;
  sha256: string;
  reused: boolean;
}

export interface ArchiveDownloadOptions {
  cacheDirectory: string;
  sourcePath?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface CommandInvocation {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export type CommandRunner = (invocation: CommandInvocation) => Promise<void>;

export interface PrepareContext {
  profile: DirectExportProfile;
  archive: ArchiveDownloadResult;
  workDirectory: string;
  instanceDirectory: string;
  repositoryRoot: string;
}

export interface ProcessContext {
  session: ExportSession;
  sessionPath: string;
  workDirectory: string;
  repositoryRoot: string;
}

export interface DirectExportDependencies {
  commandRunner?: CommandRunner;
  downloadArchive?: (
    profile: DirectExportProfile,
    options: ArchiveDownloadOptions
  ) => Promise<ArchiveDownloadResult>;
  prepare?: (context: PrepareContext) => Promise<void>;
  resolveRuntime?: typeof resolveRuntime;
  launchRuntime?: typeof launchRuntime;
  process?: (context: ProcessContext) => Promise<void>;
  now?: () => Date;
}

export interface DirectExportOptions {
  profile?: string | DirectExportProfile;
  repositoryRoot?: string;
  cacheDirectory?: string;
  workDirectory?: string;
  instanceDirectory?: string;
  archiveSourcePath?: string;
  statusFile?: string;
  launcherStatusFile?: string;
  automationStatusFile?: string;
  repositoryName?: string;
  worldName?: string;
  username?: string;
  java?: string;
  xvfbRun?: string;
  xvfbArgs?: string[];
  useXvfb?: boolean;
  xms?: string;
  xmx?: string;
  launchTimeoutMs?: number;
  automationTimeoutMs?: number;
  pollIntervalMs?: number;
  jvmArgs?: string[];
  identity?: {
    uuid?: string;
    accessToken?: string;
    userProperties?: string;
    userType?: string;
  };
  dependencies?: DirectExportDependencies;
}

export interface AutomationStatus {
  schemaVersion: 1;
  phase: string;
  updatedAt?: string;
  repository?: string;
  world?: string;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export type DirectExportPhase =
  | 'validating'
  | 'downloading'
  | 'preparing'
  | 'launching'
  | 'monitoring'
  | 'processing'
  | 'complete'
  | 'failed';

export interface DirectExportStatus {
  schemaVersion: 1;
  phase: DirectExportPhase;
  updatedAt: string;
  message: string;
  profile: string;
  statusFile: string;
  launcherStatusFile: string;
  automationStatusFile: string;
  archivePath?: string;
  sessionPath?: string;
  resultPath?: string;
  launcherState?: RuntimeLaunchStatus['state'];
  automationPhase?: string;
  error?: string;
}

export interface DirectExportResult {
  profile: DirectExportProfile;
  archive: ArchiveDownloadResult;
  session: ExportSession;
  sessionPath: string;
  resultPath: string;
  launcherStatusFile: string;
  automationStatusFile: string;
  statusFile: string;
  launchPlan: RuntimeLaunchPlan;
  processResult: Record<string, unknown>;
}

function profileFromInput(profile: string | DirectExportProfile | undefined): DirectExportProfile {
  const value = typeof profile === 'string' || profile === undefined
    ? DIRECT_EXPORT_PROFILES[profile ?? '2.9.0-beta-2']
    : profile;
  if (!value) throw new Error(`Unsupported direct export profile ${String(profile)}`);
  if (!value.version || !SAFE_NAME_PATTERN.test(value.version)) throw new Error(`Invalid export profile version ${value.version}`);
  if (!value.archiveFileName || basename(value.archiveFileName) !== value.archiveFileName) {
    throw new Error(`Invalid export profile archive filename ${value.archiveFileName}`);
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) throw new Error(`Invalid export profile byte size for ${value.version}`);
  if (!SHA256_PATTERN.test(value.sha256)) throw new Error(`Invalid export profile SHA-256 for ${value.version}`);
  if (!/^https?:\/\/|^file:\/\//.test(value.clientUrl)) {
    throw new Error(`Invalid export profile client URL for ${value.version}`);
  }
  return { ...value, sha256: value.sha256.toLowerCase() };
}

export function getDirectExportProfile(version = '2.9.0-beta-2'): DirectExportProfile {
  return profileFromInput(version);
}

async function digestFile(path: string, algorithm: 'sha1' | 'sha256'): Promise<{ bytes: number; digest: string }> {
  const hash = createHash(algorithm);
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, digest: hash.digest('hex') };
}

interface AssetDirectorFile {
  path: string;
  relativePath: string;
}

async function isValidatedAssetDirectorFile(path: string, relativePath: string): Promise<boolean> {
  const parts = relativePath.split(sep);
  if (parts[0] === 'assets' && parts[1] === 'objects') {
    if (
      parts.length !== 4
      || !SHA1_PATTERN.test(parts[3] ?? '')
      || parts[2] !== parts[3]!.slice(0, 2)
    ) return false;
    const actual = await digestFile(path, 'sha1');
    return actual.digest === parts[3]!.toLowerCase();
  }
  if (relativePath.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return false;
    }
  }
  return true;
}

async function listAssetDirectorFiles(root: string): Promise<AssetDirectorFile[]> {
  const files: AssetDirectorFile[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = prefix ? join(prefix, entry.name) : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, relativePath);
      } else if (
        entry.isFile()
        && !entry.name.endsWith('.part')
        && await isValidatedAssetDirectorFile(path, relativePath)
      ) {
        files.push({ path, relativePath });
      }
    }
  };
  await visit(resolve(root), '');
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

async function removeAssetDirectorPartFiles(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.part')) await rm(path, { force: true });
    }
  };
  await visit(resolve(root));
}

async function copyAssetDirectorFiles(sourceRoot: string, destinationRoot: string): Promise<number> {
  const files = await listAssetDirectorFiles(sourceRoot);
  for (const file of files) {
    const destination = join(destinationRoot, file.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file.path, destination);
  }
  return files.length;
}

async function seedAssetDirectorCache(cacheRoot: string, instanceRoot: string): Promise<number> {
  await removeAssetDirectorPartFiles(cacheRoot);
  return copyAssetDirectorFiles(cacheRoot, instanceRoot);
}

async function persistAssetDirectorCache(instanceRoot: string, cacheRoot: string): Promise<number> {
  await removeAssetDirectorPartFiles(cacheRoot);
  const copied = await copyAssetDirectorFiles(instanceRoot, cacheRoot);
  await removeAssetDirectorPartFiles(cacheRoot);
  return copied;
}

async function verifyPinnedArchive(path: string, profile: DirectExportProfile): Promise<ArchiveDownloadResult> {
  const actual = await digestFile(path, 'sha256');
  if (actual.bytes !== profile.bytes || actual.digest !== profile.sha256.toLowerCase()) {
    throw new Error(
      `Pinned ${profile.version} archive mismatch: expected ${profile.bytes} bytes / ${profile.sha256}, `
      + `received ${actual.bytes} bytes / ${actual.digest}`
    );
  }
  return { path: resolve(path), bytes: actual.bytes, sha256: actual.digest, reused: false };
}

async function downloadToFile(
  url: string,
  target: string,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<void> {
  if (url.startsWith('file://')) {
    await copyFile(new URL(url), target);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
    await pipeline(
      Readable.fromWeb(response.body as any),
      createWriteStream(target, { flags: 'wx' })
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensurePinnedArchive(
  profileInput: string | DirectExportProfile,
  options: ArchiveDownloadOptions
): Promise<ArchiveDownloadResult> {
  const profile = profileFromInput(profileInput);
  const cacheDirectory = resolve(options.cacheDirectory);
  const archiveDirectory = join(cacheDirectory, 'archives', profile.sha256);
  const destination = join(archiveDirectory, profile.archiveFileName);
  await mkdir(archiveDirectory, { recursive: true });
  try {
    const existing = await verifyPinnedArchive(destination, profile);
    return { ...existing, reused: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await rm(destination, { force: true });
  }
  const temporaryPath = join(
    archiveDirectory,
    `.download-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  try {
    if (options.sourcePath) await copyFile(resolve(options.sourcePath), temporaryPath);
    else await downloadToFile(
      profile.clientUrl,
      temporaryPath,
      options.fetch ?? fetch,
      options.timeoutMs ?? 120_000
    );
    const verified = await verifyPinnedArchive(temporaryPath, profile);
    await chmod(temporaryPath, 0o444);
    await rename(temporaryPath, destination);
    return { ...verified, path: destination };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function defaultCommandRunner(invocation: CommandInvocation): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      stdio: 'inherit'
    });
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(
        `${invocation.command} exited with ${signal ? `signal ${signal}` : `status ${String(code)}`}`
      ));
    });
  });
}

function tsxInvocation(repositoryRoot: string, script: string, args: string[]): CommandInvocation {
  const tsxCli = join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');
  if (requireFile(tsxCli)) {
    return { command: process.execPath, args: [tsxCli, resolve(repositoryRoot, script), ...args], cwd: repositoryRoot };
  }
  return { command: 'npx', args: ['--no-install', 'tsx', resolve(repositoryRoot, script), ...args], cwd: repositoryRoot };
}

function requireFile(path: string): boolean {
  return existsSync(path);
}

function safeOptionName(value: string | undefined, fallback: string, label: string): string {
  const result = value?.trim() || fallback;
  if (!SAFE_NAME_PATTERN.test(result)) throw new Error(`Invalid ${label}: ${value}`);
  return result;
}

function memoryOption(value: string | undefined, fallback: string, label: string): string {
  const result = value?.trim() || fallback;
  if (!/^\d+[mMgG]$/.test(result)) throw new Error(`Invalid ${label}: ${value}`);
  return result;
}

function positiveTimeout(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result <= 0) throw new Error(`Invalid ${label}: ${String(value)}`);
  return result;
}

function pathInside(path: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(path));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

async function writeDirectExportStatus(path: string, status: DirectExportStatus): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

async function clearStatusFile(path: string, label: string): Promise<void> {
  try {
    const existing = await stat(path);
    if (!existing.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
    await rm(path, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function readAutomationStatus(path: string): Promise<AutomationStatus | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as AutomationStatus;
    if (parsed.schemaVersion !== 1 || typeof parsed.phase !== 'string') {
      throw new Error(`Invalid ExportAutomationController status schema in ${path}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function monitorAutomationExport(
  statusPath: string,
  launchPromise: Promise<RuntimeLaunchStatus>,
  options: {
    timeoutMs: number;
    pollIntervalMs?: number;
    onStatus?: (status: AutomationStatus) => Promise<void> | void;
  }
): Promise<{ automation: AutomationStatus; launcher: RuntimeLaunchStatus }> {
  let launchSettled = false;
  let launchError: unknown;
  const observedLaunch = launchPromise.then(
    (status) => {
      launchSettled = true;
      return status;
    },
    (error: unknown) => {
      launchSettled = true;
      launchError = error;
      // Keep the observer consumed when the automation status fails first;
      // the orchestrator reports launchError below without an unhandled
      // rejection racing the controller failure.
      return undefined;
    }
  );
  const deadline = Date.now() + options.timeoutMs;
  let previousPhase: string | undefined;
  while (Date.now() <= deadline) {
    const status = await readAutomationStatus(statusPath);
    if (status) {
      if (status.phase !== previousPhase) {
        previousPhase = status.phase;
        await options.onStatus?.(status);
      }
      if (status.phase === 'failed') {
        throw new Error(`ExportAutomationController failed: ${status.message ?? status.error ?? 'unknown error'}`);
      }
      if (status.phase === 'complete') {
        const launcher = await observedLaunch;
        if (!launcher) throw launchError ?? new Error('Launcher returned no status');
        if (launcher.state !== 'exited' || launcher.exitCode !== 0) {
          throw new Error(`Launcher failed after automation completed: ${JSON.stringify(launcher)}`);
        }
        return { automation: status, launcher };
      }
    }
    if (launchSettled) {
      if (launchError) throw launchError;
      throw new Error(
        `Launcher exited before ExportAutomationController completed${status ? ` (phase ${status.phase})` : ''}`
      );
    }
    await delay(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ExportAutomationController status ${statusPath}`);
}

function validateSession(
  session: ExportSession,
  sessionPath: string,
  profile: DirectExportProfile,
  archive: ArchiveDownloadResult,
  workDirectory: string,
  instanceDirectory: string
): void {
  if (session.schemaVersion !== 1) throw new Error(`Unsupported export session schema ${session.schemaVersion}`);
  if (session.gtnhVersion !== profile.version) throw new Error(`Prepared session version mismatch: ${session.gtnhVersion}`);
  if (session.archive.bytes !== archive.bytes || session.archive.sha256 !== archive.sha256) {
    throw new Error(`Prepared session archive does not match pinned ${profile.version}`);
  }
  if (resolve(session.archive.path) !== resolve(archive.path)) {
    throw new Error(`Prepared session references a different archive: ${session.archive.path}`);
  }
  if (resolve(session.workDirectory) !== resolve(workDirectory)) {
    throw new Error(`Prepared session work directory mismatch: ${session.workDirectory}`);
  }
  if (resolve(session.instanceDirectory) !== resolve(instanceDirectory)) {
    throw new Error(`Prepared session instance directory mismatch: ${session.instanceDirectory}`);
  }
  if (!sessionPath) throw new Error('Prepared session path is empty');
}

function defaultJvmArguments(
  options: DirectExportOptions,
  repositoryName: string,
  worldName: string,
  automationStatusFile: string
): string[] {
  const xms = memoryOption(options.xms, DEFAULT_XMS, '--xms');
  const xmx = memoryOption(options.xmx, DEFAULT_XMX, '--xmx');
  return [
    `-Xms${xms}`,
    `-Xmx${xmx}`,
    '-XX:+UseG1GC',
    '-Djava.awt.headless=false',
    '-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=true',
    '-Dorg.lwjgl.opengl.Display.enableSoftwareOpenGL=true',
    '-Djava.net.preferIPv4Stack=true',
    // Forge 1.7.10's bootstrap uses the legacy security manager API. Java 18+
    // requires this opt-in even though the exporter itself does not install a
    // security manager.
    '-Djava.security.manager=allow',
    '-Dnesql.automation.enabled=true',
    `-Dnesql.automation.repository=${repositoryName}`,
    `-Dnesql.automation.world=${worldName}`,
    `-Dnesql.automation.status=${automationStatusFile}`
  ];
}

async function invokePrepare(
  context: PrepareContext,
  repositoryRoot: string,
  commandRunner: CommandRunner
): Promise<void> {
  const invocation = tsxInvocation(repositoryRoot, 'tools/data-export/prepare.ts', [
    '--archive', context.archive.path,
    '--version', context.profile.version,
    '--work-dir', context.workDirectory,
    '--instance-dir', context.instanceDirectory
  ]);
  await commandRunner(invocation);
}

async function invokeProcess(
  context: ProcessContext,
  repositoryRoot: string,
  commandRunner: CommandRunner
): Promise<void> {
  await commandRunner(tsxInvocation(repositoryRoot, 'tools/data-export/process.ts', [
    '--session', context.sessionPath,
    '--work-dir', context.workDirectory
  ]));
}

async function readProcessResult(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  if (!value || typeof value !== 'object') throw new Error(`Invalid process result at ${path}`);
  return value;
}

export async function orchestrateDirectExport(options: DirectExportOptions = {}): Promise<DirectExportResult> {
  const dependencies = options.dependencies ?? {};
  const profile = profileFromInput(options.profile);
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const cacheDirectory = resolve(options.cacheDirectory ?? DEFAULT_CACHE_DIRECTORY);
  const workDirectory = resolve(options.workDirectory ?? join(repositoryRoot, '.export-work', `${profile.version}-direct`));
  const instanceDirectory = resolve(options.instanceDirectory ?? join(workDirectory, 'client-instance'));
  const statusFile = resolve(options.statusFile ?? join(cacheDirectory, 'status', `${profile.version}-direct-export.json`));
  const launcherStatusFile = resolve(options.launcherStatusFile ?? join(cacheDirectory, 'status', `${profile.version}-launcher.json`));
  const automationStatusFile = resolve(options.automationStatusFile ?? join(cacheDirectory, 'status', `${profile.version}-automation.json`));
  const repositoryName = safeOptionName(options.repositoryName, 'browser-export', 'repository name');
  const worldName = safeOptionName(options.worldName, 'browser-export-world', 'world name');
  const launchTimeoutMs = positiveTimeout(options.launchTimeoutMs, DEFAULT_LAUNCH_TIMEOUT_MS, '--launch-timeout');
  const automationTimeoutMs = positiveTimeout(options.automationTimeoutMs, DEFAULT_AUTOMATION_TIMEOUT_MS, '--automation-timeout');
  const pollIntervalMs = positiveTimeout(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, '--poll-interval');
  if (statusFile === launcherStatusFile || statusFile === automationStatusFile || launcherStatusFile === automationStatusFile) {
    throw new Error('Orchestrator, launcher, and ExportAutomationController status files must be distinct');
  }
  if (pathInside(statusFile, workDirectory)) {
    throw new Error(`Orchestrator status must not be inside the fresh prepare workspace: ${statusFile}`);
  }
  await assertPathMissing(workDirectory, 'Direct export work directory');
  const now = dependencies.now ?? (() => new Date());
  const writeStatus = async (
    phase: DirectExportPhase,
    message: string,
    extra: Partial<DirectExportStatus> = {}
  ): Promise<void> => {
    await writeDirectExportStatus(statusFile, {
      schemaVersion: 1,
      phase,
      updatedAt: now().toISOString(),
      message,
      profile: profile.version,
      statusFile,
      launcherStatusFile,
      automationStatusFile,
      ...extra
    });
  };
  try {
    await writeStatus('validating', 'Validated direct export profile and disposable workspace');
    await writeStatus('downloading', `Downloading or reusing the pinned ${profile.version} client archive`);
    const archive = await (dependencies.downloadArchive ?? ensurePinnedArchive)(profile, {
      cacheDirectory,
      sourcePath: options.archiveSourcePath
    });
    await writeStatus('preparing', 'Preparing the disposable exporter/client workspace', { archivePath: archive.path });
    const prepareContext = { profile, archive, workDirectory, instanceDirectory, repositoryRoot };
    if (dependencies.prepare) await dependencies.prepare(prepareContext);
    else await invokePrepare(prepareContext, repositoryRoot, dependencies.commandRunner ?? defaultCommandRunner);
    const sessionPath = join(workDirectory, 'export-session.json');
    const session = await readExportSession(sessionPath);
    validateSession(session, sessionPath, profile, archive, workDirectory, instanceDirectory);
    await writeStatus('launching', 'Resolving embedded component metadata and building the direct JVM launch plan', {
      archivePath: archive.path,
      sessionPath
    });
    const assetDirectorCacheRoot = join(cacheDirectory, 'asset-director', profile.sha256);
    const assetDirectorInstanceRoot = join(
      session.instanceDirectory,
      '.minecraft',
      'assets',
      'asset_director'
    );
    await seedAssetDirectorCache(assetDirectorCacheRoot, assetDirectorInstanceRoot);
    const resolution = await (dependencies.resolveRuntime ?? resolveRuntime)({
      root: session.instanceDirectory,
      cacheDirectory: join(cacheDirectory, 'runtime'),
      identity: {
        username: options.username,
        ...options.identity
      },
      extractNatives: true
    });
    for (const argument of [
      ...defaultJvmArguments(options, repositoryName, worldName, automationStatusFile),
      ...(options.jvmArgs ?? [])
    ]) {
      if (!resolution.jvmArgs.includes(argument)) resolution.jvmArgs.push(argument);
    }
    const launchPlan = createLaunchPlan(resolution, {
      java: options.java,
      xvfbRun: options.xvfbRun,
      xvfbArgs: options.xvfbArgs ?? ['-a', '--server-args=-screen 0 1280x720x24'],
      useXvfb: options.useXvfb ?? true,
      timeoutMs: launchTimeoutMs,
      statusFile: launcherStatusFile
    });
    await writeStatus('monitoring', 'Launching the client and monitoring launcher plus exporter status', {
      archivePath: archive.path,
      sessionPath
    });
    // These paths are reusable cache locations by default. Remove only the
    // exact status files for this run so stale complete/failed JSON cannot be
    // mistaken for the new launch; reject a directory or other non-file path.
    await clearStatusFile(launcherStatusFile, 'Launcher status file');
    await clearStatusFile(automationStatusFile, 'ExportAutomationController status file');
    const launchAbort = new AbortController();
    const launch = (dependencies.launchRuntime ?? launchRuntime)(launchPlan, {
      statusFile: launcherStatusFile,
      signal: launchAbort.signal
    } satisfies LaunchOptions);
    let monitored: Awaited<ReturnType<typeof monitorAutomationExport>>;
    try {
      monitored = await monitorAutomationExport(automationStatusFile, launch, {
        timeoutMs: automationTimeoutMs,
        pollIntervalMs,
        onStatus: async (automation) => {
          await writeStatus('monitoring', `ExportAutomationController phase: ${automation.phase}`, {
            archivePath: archive.path,
            sessionPath,
            automationPhase: automation.phase
          });
        }
      });
    } catch (error) {
      launchAbort.abort();
      await launch.catch(() => undefined);
      await persistAssetDirectorCache(assetDirectorInstanceRoot, assetDirectorCacheRoot);
      throw error;
    }
    await persistAssetDirectorCache(assetDirectorInstanceRoot, assetDirectorCacheRoot);
    await writeStatus('processing', 'Automation completed; validating and processing the NESQL export', {
      archivePath: archive.path,
      sessionPath,
      launcherState: monitored.launcher.state,
      automationPhase: monitored.automation.phase
    });
    const processContext = { session, sessionPath, workDirectory, repositoryRoot };
    if (dependencies.process) await dependencies.process(processContext);
    else await invokeProcess(processContext, repositoryRoot, dependencies.commandRunner ?? defaultCommandRunner);
    const resultPath = join(workDirectory, 'process-result.json');
    const processResult = await readProcessResult(resultPath);
    await writeStatus('complete', 'Direct export prepared, exported, validated, and processed successfully', {
      archivePath: archive.path,
      sessionPath,
      resultPath,
      launcherState: monitored.launcher.state,
      automationPhase: monitored.automation.phase
    });
    return {
      profile,
      archive,
      session,
      sessionPath,
      resultPath,
      launcherStatusFile,
      automationStatusFile,
      statusFile,
      launchPlan,
      processResult
    };
  } catch (error) {
    await writeStatus('failed', 'Direct export failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
