import { createHash } from 'node:crypto';
import { mkdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIRECT_EXPORT_PROFILES,
  ensurePinnedArchive,
  getDirectExportProfile,
  monitorAutomationExport,
  orchestrateDirectExport,
  type AutomationStatus,
  type CommandInvocation,
  type CommandRunner,
  type DirectExportDependencies,
  type DirectExportPhase,
  type DirectExportProfile,
  type DirectExportStatus,
  type PrepareContext,
  type ProcessContext
} from '../tools/data-export/direct-export';
import type { ExportSession } from '../tools/data-export/lib';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha1Digest(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function tinyProfile(content: string): DirectExportProfile {
  return {
    version: 'test-profile',
    archiveFileName: 'test-pack.zip',
    clientUrl: 'file:///unused/test-pack.zip',
    bytes: Buffer.byteLength(content),
    sha256: digest(content),
    sourcePage: 'https://example.test/profile'
  };
}

function sessionFor(
  profile: DirectExportProfile,
  archivePath: string,
  workDirectory: string,
  instanceDirectory: string
): ExportSession {
  return {
    schemaVersion: 1,
    gtnhVersion: profile.version,
    createdAt: new Date().toISOString(),
    workDirectory,
    instanceDirectory,
    archive: {
      path: archivePath,
      bytes: profile.bytes,
      sha256: profile.sha256
    },
    exporter: {
      repository: 'test',
      commit: 'test',
      patchSha256: 'test',
      mainJar: 'test.jar',
      mainJarSha256: 'test',
      dependenciesJar: 'test-deps.jar',
      dependenciesJarSha256: 'test'
    },
    processor: { repository: 'test', commit: 'test', patchSha256: 'test' },
    toolchains: { java: 'test', dotnetSdk: 'test' }
  };
}

function fakeResolution(instanceDirectory: string) {
  return {
    schemaVersion: 1 as const,
    packRoot: instanceDirectory,
    minecraftDirectory: join(instanceDirectory, '.minecraft'),
    gameDirectory: join(instanceDirectory, '.minecraft'),
    cacheDirectory: join(instanceDirectory, 'cache'),
    nativesDirectory: join(instanceDirectory, '.minecraft', 'natives'),
    platform: { name: 'linux' as const, arch: 'x86_64' as const, features: {} },
    patches: [],
    artifacts: [],
    classpath: [join(instanceDirectory, 'client.jar')],
    mainClass: 'example.Main',
    jvmArgs: [],
    gameArgs: [],
    identity: {
      username: 'GTNH',
      uuid: '00000000-0000-3000-8000-000000000000',
      accessToken: '0',
      userProperties: '{}',
      userType: 'legacy'
    },
    assetIndex: {
      id: 'test',
      path: join(instanceDirectory, 'assets.json'),
      sha1: digest('assets'),
      bytes: 6,
      objects: [],
      assetsDirectory: join(instanceDirectory, '.minecraft', 'assets')
    }
  };
}

const publicTypeCoverage: [
  CommandInvocation,
  CommandRunner,
  PrepareContext,
  ProcessContext,
  DirectExportDependencies,
  AutomationStatus,
  DirectExportPhase,
  DirectExportStatus
] | undefined = undefined;

void publicTypeCoverage;

describe('direct export orchestration', () => {
  it('pins the reviewed current client profile', () => {
    expect(getDirectExportProfile('2.9.0-beta-2').version).toBe('2.9.0-beta-2');
    expect(DIRECT_EXPORT_PROFILES['2.9.0-beta-2']).toMatchObject({
      clientUrl: 'https://downloads.gtnewhorizons.com/Multi_mc_downloads/betas/GT_New_Horizons_2.9.0-beta-2_Java_17-25.zip',
      bytes: 680333339,
      sha256: 'adb853b49e5e17cfe595a8c63c85e2f230c2d03d8aed0ac42bc83c475a1bcbee'
    });
  });

  it('reports a completed automation status only after a clean launcher exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtnh-direct-export-monitor-'));
    try {
      const statusPath = join(root, 'automation.json');
      await writeFile(statusPath, JSON.stringify({ schemaVersion: 1, phase: 'complete' }));
      const result = await monitorAutomationExport(statusPath, Promise.resolve({
        schemaVersion: 1,
        state: 'exited',
        exitCode: 0,
        signal: null,
        updatedAt: new Date().toISOString()
      }), { timeoutMs: 100, pollIntervalMs: 1 });
      expect(result.automation.phase).toBe('complete');
      expect(result.launcher.exitCode).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('downloads, verifies, and reuses an immutable pinned archive cache entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtnh-direct-export-download-'));
    try {
      const content = 'synthetic archive';
      const sourcePath = join(root, 'source.zip');
      const profile = tinyProfile(content);
      await writeFile(sourcePath, content);
      const first = await ensurePinnedArchive(profile, {
        cacheDirectory: join(root, 'cache'),
        sourcePath
      });
      expect(first.reused).toBe(false);
      expect(first.bytes).toBe(content.length);
      const second = await ensurePinnedArchive(profile, { cacheDirectory: join(root, 'cache') });
      expect(second.reused).toBe(true);
      expect(second.path).toBe(first.path);
      await expect(readFile(second.path, 'utf8')).resolves.toBe(content);

      const badProfile = { ...profile, sha256: digest('different') };
      await expect(ensurePinnedArchive(badProfile, {
        cacheDirectory: join(root, 'bad-cache'),
        sourcePath
      })).rejects.toThrow(/archive mismatch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prepares, launches, monitors separate statuses, then processes the export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtnh-direct-export-orchestrator-'));
    try {
      const content = 'synthetic archive';
      const sourcePath = join(root, 'source.zip');
      const profile = tinyProfile(content);
      await writeFile(sourcePath, content);
      const workDirectory = join(root, 'work');
      const statusDirectory = join(root, 'status');
      await mkdir(statusDirectory, { recursive: true });
      await writeFile(join(statusDirectory, 'launcher.json'), JSON.stringify({
        schemaVersion: 1,
        state: 'failed',
        exitCode: 1
      }));
      await writeFile(join(statusDirectory, 'automation.json'), JSON.stringify({
        schemaVersion: 1,
        phase: 'failed',
        message: 'stale controller failure'
      }));
      let prepared = false;
      let processed = false;
      const cacheDirectory = join(root, 'cache');
      const seededContent = 'seeded asset';
      const seededHash = sha1Digest(seededContent);
      const seededCachePath = join(
        cacheDirectory,
        'asset-director',
        profile.sha256,
        'assets',
        'objects',
        seededHash.slice(0, 2),
        seededHash
      );
      await mkdir(dirname(seededCachePath), { recursive: true });
      await writeFile(seededCachePath, seededContent);
      const result = await orchestrateDirectExport({
        profile,
        cacheDirectory,
        archiveSourcePath: sourcePath,
        workDirectory,
        statusFile: join(statusDirectory, 'orchestrator.json'),
        launcherStatusFile: join(statusDirectory, 'launcher.json'),
        automationStatusFile: join(statusDirectory, 'automation.json'),
        repositoryName: 'test-export',
        worldName: 'test-world',
        username: 'TestUser',
        java: '/usr/bin/java',
        pollIntervalMs: 1,
        dependencies: {
          commandRunner: async ({ args }) => {
            if (args.some((argument) => argument.endsWith('/prepare.ts'))) {
              prepared = true;
              const archivePath = args[args.indexOf('--archive') + 1]!;
              const preparedWork = args[args.indexOf('--work-dir') + 1]!;
              const instanceDirectory = args[args.indexOf('--instance-dir') + 1]!;
              await mkdir(instanceDirectory, { recursive: true });
              await writeFile(join(preparedWork, 'export-session.json'), JSON.stringify(
                sessionFor(profile, archivePath, preparedWork, instanceDirectory)
              ));
              return;
            }
            if (args.some((argument) => argument.endsWith('/process.ts'))) {
              processed = true;
              const processedWork = args[args.indexOf('--work-dir') + 1]!;
              await writeFile(join(processedWork, 'process-result.json'), JSON.stringify({
                pack: join(processedWork, 'pack'),
                datasetId: 'test'
              }));
              return;
            }
            throw new Error(`Unexpected command: ${args.join(' ')}`);
          },
          resolveRuntime: async ({ root: runtimeRoot }) => fakeResolution(runtimeRoot),
          launchRuntime: async (plan, launchOptions) => {
            const launchConfig = launchOptions!;
            const assetDirectorRoot = join(plan.gameDirectory, 'assets', 'asset_director');
            await expect(readFile(join(
              assetDirectorRoot,
              'assets',
              'objects',
              seededHash.slice(0, 2),
              seededHash
            ), 'utf8')).resolves.toBe(seededContent);
            expect(plan.command[0]).toBe('xvfb-run');
            expect(plan.command).toContain('/usr/bin/java');
            expect(plan.command).toContain('example.Main');
            expect(plan.jvmArgs).toContain('-Xmx8G');
            expect(plan.jvmArgs).toContain('-Dorg.lwjgl.opengl.Display.enableSoftwareOpenGL=true');
            expect(plan.jvmArgs).toContain('-Djava.security.manager=allow');
            expect(plan.jvmArgs).toContain('-Dnesql.automation.enabled=true');
            expect(plan.jvmArgs).toContain('-Dnesql.automation.repository=test-export');
            expect(plan.jvmArgs).toContain('-Dnesql.automation.world=test-world');
            expect(plan.jvmArgs.some((arg) => arg.startsWith('-Dnesql.automation.status='))).toBe(true);
            expect(plan.statusFile).toBe(launchConfig.statusFile);
            await expect(readFile(launchConfig.statusFile!)).rejects.toThrow();
            await expect(readFile(join(statusDirectory, 'automation.json'))).rejects.toThrow();
            const persistedContent = 'persisted asset';
            const persistedHash = sha1Digest(persistedContent);
            const persistedDirectory = join(
              assetDirectorRoot,
              'assets',
              'objects',
              persistedHash.slice(0, 2)
            );
            await mkdir(persistedDirectory, { recursive: true });
            await writeFile(join(persistedDirectory, persistedHash), persistedContent);
            await writeFile(join(persistedDirectory, `${persistedHash}.part`), 'partial');
            await writeFile(join(persistedDirectory, '0'.repeat(40)), 'invalid digest');
            await writeFile(launchConfig.statusFile!, JSON.stringify({
              schemaVersion: 1,
              state: 'exited',
              exitCode: 0,
              updatedAt: new Date().toISOString()
            }));
            await writeFile(join(statusDirectory, 'automation.json'), JSON.stringify({
              schemaVersion: 1,
              phase: 'complete',
              message: 'done',
              updatedAt: new Date().toISOString()
            }));
            return {
              schemaVersion: 1,
              state: 'exited' as const,
              exitCode: 0,
              signal: null,
              updatedAt: new Date().toISOString()
            };
          }
        }
      });
      expect(prepared).toBe(true);
      expect(processed).toBe(true);
      expect(result.statusFile).not.toBe(result.launcherStatusFile);
      expect(result.statusFile).not.toBe(result.automationStatusFile);
      expect(result.launcherStatusFile).not.toBe(result.automationStatusFile);
      await expect(readFile(result.statusFile, 'utf8')).resolves.toMatch(/"phase"\s*:\s*"complete"/);
      await expect(readFile(result.automationStatusFile, 'utf8')).resolves.toMatch(/"phase"\s*:\s*"complete"/);
      const persistedContent = 'persisted asset';
      const persistedHash = sha1Digest(persistedContent);
      const sharedAssetRoot = join(cacheDirectory, 'asset-director', profile.sha256, 'assets', 'objects');
      await expect(readFile(join(sharedAssetRoot, seededHash.slice(0, 2), seededHash), 'utf8'))
        .resolves.toBe(seededContent);
      await expect(readFile(join(sharedAssetRoot, persistedHash.slice(0, 2), persistedHash), 'utf8'))
        .resolves.toBe(persistedContent);
      await expect(readFile(join(sharedAssetRoot, persistedHash.slice(0, 2), `${persistedHash}.part`)))
        .rejects.toThrow();
      await expect(readFile(join(sharedAssetRoot, persistedHash.slice(0, 2), '0'.repeat(40))))
        .rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on ExportAutomationController failure and does not process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtnh-direct-export-failure-'));
    try {
      const content = 'synthetic archive';
      const sourcePath = join(root, 'source.zip');
      const profile = tinyProfile(content);
      await writeFile(sourcePath, content);
      const workDirectory = join(root, 'work');
      const statusDirectory = join(root, 'status');
      const cacheDirectory = join(root, 'cache');
      let processed = false;
      await expect(orchestrateDirectExport({
        profile,
        cacheDirectory,
        archiveSourcePath: sourcePath,
        workDirectory,
        statusFile: join(statusDirectory, 'orchestrator.json'),
        launcherStatusFile: join(statusDirectory, 'launcher.json'),
        automationStatusFile: join(statusDirectory, 'automation.json'),
        automationTimeoutMs: 100,
        pollIntervalMs: 1,
        dependencies: {
          prepare: async ({ archive, workDirectory: preparedWork, instanceDirectory }) => {
            await mkdir(instanceDirectory, { recursive: true });
            await writeFile(join(preparedWork, 'export-session.json'), JSON.stringify(
              sessionFor(profile, archive.path, preparedWork, instanceDirectory)
            ));
          },
          resolveRuntime: async ({ root: runtimeRoot }) => fakeResolution(runtimeRoot),
          launchRuntime: async (plan, launchOptions) => {
            const persistedContent = 'failure asset';
            const persistedHash = sha1Digest(persistedContent);
            const persistedDirectory = join(
              plan.gameDirectory,
              'assets',
              'asset_director',
              'assets',
              'objects',
              persistedHash.slice(0, 2)
            );
            await mkdir(persistedDirectory, { recursive: true });
            await writeFile(join(persistedDirectory, persistedHash), persistedContent);
            await writeFile(join(persistedDirectory, `${persistedHash}.part`), 'partial');
            await writeFile(launchOptions!.statusFile!, JSON.stringify({
              schemaVersion: 1,
              state: 'exited',
              exitCode: 0,
              updatedAt: new Date().toISOString()
            }));
            await writeFile(join(statusDirectory, 'automation.json'), JSON.stringify({
              schemaVersion: 1,
              phase: 'failed',
              message: 'synthetic controller failure',
              updatedAt: new Date().toISOString()
            }));
            return {
              schemaVersion: 1,
              state: 'exited' as const,
              exitCode: 0,
              signal: null,
              updatedAt: new Date().toISOString()
            };
          },
          process: async () => {
            processed = true;
          }
        }
      })).rejects.toThrow(/ExportAutomationController failed/);
      expect(processed).toBe(false);
      await expect(readFile(join(statusDirectory, 'orchestrator.json'), 'utf8')).resolves.toMatch(/"phase"\s*:\s*"failed"/);
      const persistedContent = 'failure asset';
      const persistedHash = sha1Digest(persistedContent);
      const sharedFailureRoot = join(cacheDirectory, 'asset-director', profile.sha256, 'assets', 'objects');
      await expect(readFile(join(sharedFailureRoot, persistedHash.slice(0, 2), persistedHash), 'utf8'))
        .resolves.toBe(persistedContent);
      await expect(readFile(join(sharedFailureRoot, persistedHash.slice(0, 2), `${persistedHash}.part`)))
        .rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
