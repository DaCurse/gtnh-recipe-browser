import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createLaunchPlan,
  matchesRuntimeRule,
  isAllowedByRuntimeRules,
  LINUX_X86_64,
  offlineUuid,
  readRuntimePackMetadata,
  resolveRuntime,
  splitRuntimeArguments,
  waitForRuntimeStatus
} from '../tools/data-export/direct-runtime';

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

async function fileArtifact(path: string): Promise<{ url: string; sha1: string; size: number }> {
  const content = await readFile(path);
  return {
    url: pathToFileURL(path).href,
    sha1: createHash('sha1').update(content).digest('hex'),
    size: content.byteLength
  };
}

describe('direct GTNH runtime resolver', () => {
  it('evaluates launcher rules for Linux x86_64 and computes offline identity', () => {
    expect(isAllowedByRuntimeRules([{ action: 'allow', os: { name: 'linux', arch: 'x86_64' } }])).toBe(true);
    expect(matchesRuntimeRule({ action: 'allow', os: { name: 'linux', arch: 'x86_64' } })).toBe(true);
    expect(isAllowedByRuntimeRules([{ action: 'allow', os: { name: 'windows' } }])).toBe(false);
    expect(isAllowedByRuntimeRules([
      { action: 'allow' },
      { action: 'disallow', os: { name: 'linux', arch: 'arm64' } }
    ], LINUX_X86_64)).toBe(true);
    expect(splitRuntimeArguments('--username "Offline Player" --flag \'quoted value\'')).toEqual([
      '--username',
      'Offline Player',
      '--flag',
      'quoted value'
    ]);
    expect(offlineUuid('GTNH')).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('orders component patches, verifies artifacts, resolves assets, and assembles an offline plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtnh-direct-runtime-'));
    try {
      const libraries = join(root, 'libraries');
      const gameDirectory = join(root, '.minecraft');
      await mkdirForTest(libraries);
      await mkdirForTest(gameDirectory);
      const clientPath = join(root, 'client-1.jar');
      const libraryPath = join(root, 'library-1.jar');
      const localPath = join(libraries, 'local-1.jar');
      const linuxNativePath = join(root, 'native-linux.jar');
      const windowsNativePath = join(root, 'native-windows.jar');
      const objectPath = join(root, 'asset-object');
      await writeFile(clientPath, 'client');
      await writeFile(libraryPath, 'library');
      await writeFile(localPath, 'local');
      await writeFile(linuxNativePath, 'native-linux');
      await writeFile(windowsNativePath, 'native-windows');
      await writeFile(objectPath, 'asset');
      const client = await fileArtifact(clientPath);
      const library = await fileArtifact(libraryPath);
      const linuxNative = await fileArtifact(linuxNativePath);
      const windowsNative = await fileArtifact(windowsNativePath);
      const object = await fileArtifact(objectPath);
      const assetIndexDocument = JSON.stringify({
        virtual: true,
        map_to_resources: true,
        objects: {
          'minecraft/test': { hash: object.sha1, size: object.size }
        }
      });
      const assetIndexPath = join(root, 'asset-index.json');
      await writeFile(assetIndexPath, assetIndexDocument);
      const assetIndex = await fileArtifact(assetIndexPath);
      await writeFile(join(root, 'mmc-pack.json'), JSON.stringify({
        formatVersion: 1,
        components: [
          { uid: 'net.minecraft', version: '1.7.10' },
          { uid: 'com.example.launcher', version: '1' }
        ]
      }));
      await writePatch(root, 'launcher.json', {
        uid: 'com.example.launcher',
        version: '1',
        order: 100,
        mainClass: 'com.example.Wrapper'
      });
      await writePatch(root, 'forge.json', {
        uid: 'com.example.forge',
        order: 5,
        mainClass: 'com.example.Forge',
        '+tweakers': ['example.Tweaker'],
        libraries: [{
          name: 'com.example:library:1',
          downloads: { artifact: library }
        }]
      });
      await writePatch(root, 'early.json', {
        uid: 'com.example.early',
        order: 3,
        '+jvmArgs': ['-Dexample=true'],
        libraries: [
          {
            name: 'com.example:local:1',
            'MMC-hint': 'local'
          },
          {
            name: 'com.example:native:1',
            natives: {
              linux: 'natives-linux',
              windows: 'natives-windows-${arch}'
            },
            downloads: {
              classifiers: {
                'natives-linux': linuxNative,
                'natives-windows-64': windowsNative
              }
            }
          }
        ]
      });
      await writePatch(root, 'minecraft.json', {
        uid: 'net.minecraft',
        version: '1.7.10',
        order: -2,
        mainClass: 'net.minecraft.client.Main',
        mainJar: {
          name: 'com.example:client:1',
          downloads: { artifact: client }
        },
        assetIndex: {
          id: '1.7.10',
          ...assetIndex
        },
        minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userProperties ${user_properties} --userType ${user_type}'
      });
      const metadata = await readRuntimePackMetadata(root);
      expect(metadata.patches.map(({ patch }) => patch.order)).toEqual([-2, 3, 5, 100]);

      const resolution = await resolveRuntime({
        root,
        cacheDirectory: join(root, 'cache'),
        extractNatives: false,
        identity: { username: 'OfflineUser' },
        fetch: async (url) => {
          if (String(url).startsWith('https://resources.download.minecraft.net/')) {
            return new Response(await readFile(objectPath), { status: 200 });
          }
          throw new Error(`Unexpected test URL ${url}`);
        }
      });
      expect(resolution.patches.map((patch) => patch.order)).toEqual([-2, 3, 5, 100]);
      expect(resolution.mainClass).toBe('com.example.Wrapper');
      expect(resolution.jvmArgs).toContain('-Dexample=true');
      expect(resolution.jvmArgs).toContain('-Djava.security.manager=allow');
      expect(resolution.gameArgs).toContain('--tweakClass');
      expect(resolution.gameArgs).toContain('OfflineUser');
      expect(resolution.gameArgs).toContain('1.7.10');
      expect(resolution.classpath).toHaveLength(3);
      expect(resolution.classpath.every((path) => path.endsWith('.jar'))).toBe(true);
      expect(resolution.artifacts.map((artifact) => artifact.name)).toContain('com.example:native:1:natives-linux');
      expect(resolution.artifacts.map((artifact) => artifact.name)).not.toContain('com.example:native:1:natives-windows-64');
      expect(resolution.assetIndex.objects[0]?.name).toBe('minecraft/test');
      await expect(readFile(resolution.assetIndex.objects[0]!.path, 'utf8')).resolves.toBe('asset');
      await expect(readFile(join(resolution.assetIndex.virtualDirectory!, 'minecraft/test'), 'utf8')).resolves.toBe('asset');
      await expect(readFile(join(resolution.assetIndex.resourcesDirectory!, 'minecraft/test'), 'utf8')).resolves.toBe('asset');

      const plan = createLaunchPlan(resolution, { useXvfb: false, java: '/usr/bin/java' });
      expect(plan.command[0]).toBe('/usr/bin/java');
      expect(plan.command).toContain('-cp');
      expect(plan.command).toContain('com.example.Wrapper');

      const cached = await resolveRuntime({
        root,
        cacheDirectory: join(root, 'cache'),
        extractNatives: false,
        download: false,
        identity: { username: 'OfflineUser' },
        fetch: async (url) => {
          if (String(url).startsWith('https://resources.download.minecraft.net/')) {
            return new Response(await readFile(objectPath), { status: 200 });
          }
          throw new Error(`Unexpected test URL ${url}`);
        }
      });
      expect(cached.artifacts.map((artifact) => artifact.actualSha1)).toEqual(
        resolution.artifacts.map((artifact) => artifact.actualSha1)
      );

      const statusPath = join(root, 'status.json');
      await writeFile(statusPath, JSON.stringify({
        schemaVersion: 1,
        state: 'exited',
        exitCode: 0,
        updatedAt: new Date().toISOString()
      }));
      await expect(waitForRuntimeStatus(statusPath, { timeoutMs: 100, intervalMs: 1 })).resolves.toMatchObject({
        state: 'exited',
        exitCode: 0
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies later Maven GA overrides while retaining distinct classifiers and selected natives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtnh-direct-runtime-library-merge-'));
    try {
      const clientPath = join(root, 'client.jar');
      const guava15Path = join(root, 'guava-15.jar');
      const guava17Path = join(root, 'guava-17.jar');
      const nativeOldPath = join(root, 'selector-old-linux.jar');
      const nativeNewPath = join(root, 'selector-new-linux.jar');
      const nativeWindowsPath = join(root, 'selector-old-windows.jar');
      const testsPath = join(root, 'tool-tests.jar');
      const runtimePath = join(root, 'tool-runtime.jar');
      const assetIndexPath = join(root, 'asset-index.json');
      await writeFile(clientPath, 'client');
      await writeFile(guava15Path, 'guava 15');
      await writeFile(guava17Path, 'guava 17');
      await writeFile(nativeOldPath, 'old linux native');
      await writeFile(nativeNewPath, 'new linux native');
      await writeFile(nativeWindowsPath, 'old windows native');
      await writeFile(testsPath, 'tests classifier');
      await writeFile(runtimePath, 'runtime classifier');
      await writeFile(assetIndexPath, JSON.stringify({ objects: {} }));
      const client = await fileArtifact(clientPath);
      const guava15 = await fileArtifact(guava15Path);
      const guava17 = await fileArtifact(guava17Path);
      const nativeOld = await fileArtifact(nativeOldPath);
      const nativeNew = await fileArtifact(nativeNewPath);
      const nativeWindows = await fileArtifact(nativeWindowsPath);
      const testsClassifier = await fileArtifact(testsPath);
      const runtimeClassifier = await fileArtifact(runtimePath);
      const assetIndex = await fileArtifact(assetIndexPath);
      await writeFile(join(root, 'mmc-pack.json'), JSON.stringify({
        formatVersion: 1,
        components: [
          { uid: 'net.minecraft', version: '1.7.10' },
          { uid: 'com.example.old', version: '1' },
          { uid: 'com.example.new', version: '2' }
        ]
      }));
      await writePatch(root, 'minecraft.json', {
        uid: 'net.minecraft',
        version: '1.7.10',
        order: -2,
        mainClass: 'example.Main',
        mainJar: {
          name: 'com.example:client:1',
          downloads: { artifact: client }
        },
        assetIndex: { id: '1.7.10', ...assetIndex }
      });
      await writePatch(root, 'old.json', {
        uid: 'com.example.old',
        order: 1,
        libraries: [
          {
            name: 'com.example:guava:15',
            downloads: { artifact: guava15 }
          },
          {
            name: 'com.example:selector:1',
            natives: {
              linux: 'natives-linux',
              windows: 'natives-windows-${arch}'
            },
            downloads: {
              classifiers: {
                'natives-linux': nativeOld,
                'natives-windows-64': nativeWindows
              }
            }
          },
          {
            name: 'com.example:tool:1:tests',
            downloads: { artifact: testsClassifier }
          }
        ]
      });
      await writePatch(root, 'new.json', {
        uid: 'com.example.new',
        order: 2,
        libraries: [
          {
            name: 'com.example:guava:17',
            downloads: { artifact: guava17 }
          },
          {
            name: 'com.example:selector:2',
            natives: { linux: 'natives-linux' },
            downloads: { classifiers: { 'natives-linux': nativeNew } }
          },
          {
            name: 'com.example:tool:2:runtime',
            downloads: { artifact: runtimeClassifier }
          }
        ]
      });

      const resolution = await resolveRuntime({
        root,
        cacheDirectory: join(root, 'cache'),
        extractNatives: false,
        identity: { username: 'OfflineUser' }
      });
      const names = resolution.artifacts.map((artifact) => artifact.name);
      expect(names).toContain('com.example:guava:17');
      expect(names).not.toContain('com.example:guava:15');
      expect(names).toContain('com.example:selector:2:natives-linux');
      expect(names).not.toContain('com.example:selector:1:natives-linux');
      expect(names).not.toContain('com.example:selector:1:natives-windows-64');
      expect(names).toContain('com.example:tool:1:tests');
      expect(names).toContain('com.example:tool:2:runtime');
      expect(resolution.artifacts.find((artifact) => artifact.name === 'com.example:guava:17')?.patchUid)
        .toBe('com.example.new');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a remote artifact whose declared digest does not match its bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtnh-direct-runtime-bad-cache-'));
    try {
      const remotePath = join(root, 'remote.jar');
      const assetIndexPath = join(root, 'asset-index.json');
      await writeFile(remotePath, 'wrong');
      const remoteUrl = pathToFileURL(remotePath).href;
      await writeFile(assetIndexPath, JSON.stringify({ objects: {} }));
      const assetIndex = await fileArtifact(assetIndexPath);
      await writeFile(join(root, 'mmc-pack.json'), JSON.stringify({
        formatVersion: 1,
        components: [{ uid: 'net.minecraft', version: '1.7.10' }]
      }));
      await writePatch(root, 'minecraft.json', {
        uid: 'net.minecraft',
        version: '1.7.10',
        order: -2,
        mainClass: 'example.Main',
        mainJar: {
          name: 'com.example:client:1',
          downloads: {
            artifact: {
              url: remoteUrl,
              sha1: sha1('expected'),
              size: 'wrong'.length
            }
          }
        },
        assetIndex: { id: '1.7.10', ...assetIndex }
      });
      await expect(resolveRuntime({
        root,
        cacheDirectory: join(root, 'cache'),
        extractNatives: false,
        fetch: async () => new Response('asset-index')
      })).rejects.toThrow(/SHA-1 mismatch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function mkdirForTest(path: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path, { recursive: true });
}

async function writePatch(root: string, name: string, patch: Record<string, unknown>): Promise<void> {
  await mkdirForTest(join(root, 'patches'));
  await writeFile(join(root, 'patches', name), JSON.stringify({ formatVersion: 1, ...patch }));
}
