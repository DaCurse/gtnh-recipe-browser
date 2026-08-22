import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const DEFAULT_CACHE_DIRECTORY = '.export-work/direct-runtime-cache';
const DEFAULT_ASSET_CONCURRENCY = 8;
const SHA1_PATTERN = /^[a-f0-9]{40}$/i;

export interface RuntimePlatform {
  name: 'linux';
  arch: 'x86_64';
  version?: string;
  features?: Record<string, boolean>;
}

export const LINUX_X86_64: RuntimePlatform = {
  name: 'linux',
  arch: 'x86_64',
  features: {}
};

export interface RuntimeRule {
  action: 'allow' | 'disallow' | string;
  os?: {
    name?: string;
    arch?: string;
    version?: string;
  };
  features?: Record<string, boolean>;
}

interface RuntimeLibraryArtifact {
  url?: string;
  sha1?: string;
  size?: number;
  path?: string;
  [key: string]: unknown;
}

interface RuntimeLibrary {
  name: string;
  rules?: RuntimeRule[];
  natives?: Record<string, string>;
  downloads?: {
    artifact?: RuntimeLibraryArtifact;
    classifiers?: Record<string, RuntimeLibraryArtifact>;
  };
  [key: string]: unknown;
}

interface RuntimePatch {
  uid?: string;
  name?: string;
  version?: string;
  order?: number;
  mainClass?: string;
  mainJar?: {
    name?: string;
    downloads?: { artifact?: RuntimeLibraryArtifact };
    [key: string]: unknown;
  };
  assetIndex?: {
    id?: string;
    sha1?: string;
    size?: number;
    totalSize?: number;
    url?: string;
    downloads?: { artifact?: RuntimeLibraryArtifact };
    [key: string]: unknown;
  };
  libraries?: RuntimeLibrary[];
  minecraftArguments?: string;
  arguments?: {
    jvm?: RuntimeArgument[];
    game?: RuntimeArgument[];
  };
  ['+jvmArgs']?: string[];
  ['+gameArgs']?: string[];
  ['+minecraftArguments']?: string | string[];
  ['+tweakers']?: string[];
  ['+traits']?: string[];
  [key: string]: unknown;
}

interface RuntimeComponent {
  uid: string;
  version?: string;
  [key: string]: unknown;
}

interface RuntimePackMetadata {
  formatVersion: number;
  components: RuntimeComponent[];
  patches: RuntimePatchFile[];
}

interface RuntimePatchFile {
  file: string;
  patch: RuntimePatch;
}

export interface RuntimeIdentity {
  username: string;
  uuid: string;
  accessToken: string;
  userProperties: string;
  userType: string;
}

interface RuntimeArtifactRequest {
  name: string;
  url?: string;
  sha1?: string;
  size?: number;
  localPath?: string;
  source: 'download' | 'local';
  isNative: boolean;
  patchUid?: string;
  classifier?: string;
}

interface ResolvedRuntimeArtifact extends RuntimeArtifactRequest {
  path: string;
  cachePath: string;
  bytes: number;
  actualSha1: string;
}

interface RuntimeAssetObject {
  name: string;
  hash: string;
  size: number;
  path: string;
  cachePath: string;
  materializedPaths: string[];
}

interface RuntimeAssetIndex {
  id: string;
  path: string;
  sha1: string;
  bytes: number;
  objects: RuntimeAssetObject[];
  assetsDirectory: string;
  virtualDirectory?: string;
  resourcesDirectory?: string;
}

export interface RuntimeResolution {
  schemaVersion: 1;
  packRoot: string;
  minecraftDirectory: string;
  gameDirectory: string;
  cacheDirectory: string;
  nativesDirectory: string;
  platform: RuntimePlatform;
  patches: Array<{ file: string; uid?: string; version?: string; order: number }>;
  artifacts: ResolvedRuntimeArtifact[];
  classpath: string[];
  mainClass: string;
  jvmArgs: string[];
  gameArgs: string[];
  identity: RuntimeIdentity;
  assetIndex: RuntimeAssetIndex;
}

export interface RuntimeLaunchPlan extends RuntimeResolution {
  java: string;
  xvfbRun?: string;
  xvfbArgs: string[];
  command: string[];
  timeoutMs?: number;
  statusFile?: string;
}

export interface ResolveRuntimeOptions {
  root: string;
  cacheDirectory?: string;
  gameDirectory?: string;
  nativesDirectory?: string;
  platform?: RuntimePlatform;
  identity?: Partial<RuntimeIdentity> & { username?: string };
  download?: boolean;
  downloadTimeoutMs?: number;
  assetConcurrency?: number;
  extractNatives?: boolean;
  unzipCommand?: string;
  fetch?: typeof fetch;
}

export interface LaunchPlanOptions {
  java?: string;
  xvfbRun?: string;
  xvfbArgs?: string[];
  useXvfb?: boolean;
  timeoutMs?: number;
  statusFile?: string;
}

export interface LaunchOptions {
  timeoutMs?: number;
  statusFile?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onStatus?: (status: RuntimeLaunchStatus) => void;
}

export interface RuntimeLaunchStatus {
  schemaVersion: 1;
  state: 'starting' | 'running' | 'exited' | 'failed' | 'timeout';
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  updatedAt: string;
  error?: string;
}

interface RuntimeArgumentObject {
  rules?: RuntimeRule[];
  value: string | string[];
}

type RuntimeArgument = string | RuntimeArgumentObject;

interface AssetIndexDocument {
  objects?: Record<string, { hash?: string; size?: number }>;
  virtual?: boolean | string;
  map_to_resources?: boolean;
  [key: string]: unknown;
}

interface ArtifactSource {
  url?: string;
  sha1?: string;
  size?: number;
  localPath?: string;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function normalizeSha1(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (!SHA1_PATTERN.test(normalized)) throw new Error(`Invalid SHA-1 ${value}`);
  return normalized;
}

function normalizedRules(value: unknown): RuntimeRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value as RuntimeRule[];
}

function matchesPattern(value: string | undefined, pattern: string | undefined): boolean {
  if (pattern === undefined) return true;
  if (value === undefined) return false;
  try {
    return new RegExp(pattern).test(value);
  } catch (error) {
    throw new Error(`Invalid launcher rule pattern ${pattern}: ${String(error)}`, { cause: error });
  }
}

/** Evaluate MultiMC/Minecraft launcher rules for the fixed Linux x86_64 target. */
export function matchesRuntimeRule(rule: RuntimeRule, platform: RuntimePlatform = LINUX_X86_64): boolean {
  if (rule.os) {
    if (!matchesPattern(platform.name, rule.os.name)) return false;
    if (!matchesPattern(platform.arch, rule.os.arch)) return false;
    if (!matchesPattern(platform.version, rule.os.version)) return false;
  }
  if (rule.features) {
    const features = platform.features ?? {};
    for (const [name, expected] of Object.entries(rule.features)) {
      if (features[name] !== expected) return false;
    }
  }
  return true;
}

/** Apply launcher rules in order; the last matching rule wins. */
export function isAllowedByRuntimeRules(
  rules: readonly RuntimeRule[] | undefined,
  platform: RuntimePlatform = LINUX_X86_64
): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (!matchesRuntimeRule(rule, platform)) continue;
    if (rule.action !== 'allow' && rule.action !== 'disallow') {
      throw new Error(`Unsupported launcher rule action ${String(rule.action)}`);
    }
    allowed = rule.action === 'allow';
  }
  return allowed;
}

async function findPackRoot(root: string): Promise<string> {
  const directManifest = join(root, 'mmc-pack.json');
  try {
    await stat(directManifest);
    return root;
  } catch {
    // A downloaded archive commonly has one named top-level directory.
  }
  const entries = await readdir(root, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await stat(join(root, entry.name, 'mmc-pack.json'));
      candidates.push(join(root, entry.name));
    } catch {
      // Ignore unrelated directories in an extraction staging root.
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one MultiMC pack root under ${root}, found ${candidates.length}`);
  }
  return candidates[0]!;
}

async function extractRuntimeArchive(archive: string, cacheDirectory: string): Promise<string> {
  const archiveHash = await sha1OrSha256File(archive, 'sha256');
  const extractionDirectory = join(cacheDirectory, 'packs', archiveHash);
  const marker = join(extractionDirectory, '.archive-sha256');
  try {
    const existingHash = (await readFile(marker, 'utf8')).trim();
    if (existingHash === archiveHash) return findPackRoot(extractionDirectory);
    throw new Error(`Runtime archive cache has an unexpected marker: ${extractionDirectory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(cacheDirectory, { recursive: true });
  await mkdir(join(cacheDirectory, 'packs'), { recursive: true });
  let entries: string[] = [];
  try {
    entries = await readdir(extractionDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (entries.length > 0) {
    throw new Error(`Refusing to overwrite incomplete runtime archive cache ${extractionDirectory}`);
  }
  const temporaryDirectory = `${extractionDirectory}.tmp-${process.pid}`;
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    await execFile('unzip', ['-q', '-o', archive, '-d', temporaryDirectory]);
    await rename(temporaryDirectory, extractionDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  await writeFile(marker, `${archiveHash}\n`, 'utf8');
  return findPackRoot(extractionDirectory);
}

async function resolvePackRootInput(rootOrArchive: string, cacheDirectory: string): Promise<string> {
  const input = resolve(rootOrArchive);
  const inputStat = await stat(input);
  if (inputStat.isDirectory()) return findPackRoot(input);
  if (!inputStat.isFile()) throw new Error(`Runtime root is not a file or directory: ${input}`);
  return extractRuntimeArchive(input, cacheDirectory);
}

export async function readRuntimePackMetadata(packRoot: string): Promise<RuntimePackMetadata> {
  const manifest = await readJson<Record<string, unknown>>(join(packRoot, 'mmc-pack.json'));
  const formatVersion = manifest.formatVersion;
  if (formatVersion !== 1) throw new Error(`Unsupported mmc-pack format ${String(formatVersion)}`);
  const rawComponents = manifest.components;
  if (!Array.isArray(rawComponents)) throw new Error('mmc-pack.json has no components array');
  const components = rawComponents.map((value, index) => {
    const component = asObject(value, `components[${index}]`);
    return {
      ...component,
      uid: asString(component.uid, `components[${index}].uid`)
    } as RuntimeComponent;
  });
  const patchesDirectory = join(packRoot, 'patches');
  const patchEntries = (await readdir(patchesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
    .map((entry) => entry.name)
    .sort();
  if (patchEntries.length === 0) throw new Error(`No component patches found under ${patchesDirectory}`);
  const patches: RuntimePatchFile[] = [];
  for (const file of patchEntries) {
    const value = await readJson<RuntimePatch>(join(patchesDirectory, file));
    if (value.formatVersion !== undefined && value.formatVersion !== 1) {
      throw new Error(`Unsupported patch format in ${file}: ${String(value.formatVersion)}`);
    }
    patches.push({ file, patch: value });
  }
  patches.sort((left, right) => {
    const leftOrder = Number.isFinite(left.patch.order) ? Number(left.patch.order) : 0;
    const rightOrder = Number.isFinite(right.patch.order) ? Number(right.patch.order) : 0;
    return leftOrder - rightOrder || left.file.localeCompare(right.file);
  });
  return { formatVersion: 1, components, patches };
}

function mavenCoordinateParts(name: string): {
  group: string;
  artifact: string;
  version: string;
  classifier?: string;
  extension: string;
} {
  const [coordinate, extensionPart] = name.split('@', 2);
  const parts = coordinate.split(':');
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => part.length === 0)) {
    throw new Error(`Invalid Maven library coordinate ${name}`);
  }
  return {
    group: parts[0]!,
    artifact: parts[1]!,
    version: parts[2]!,
    classifier: parts[3],
    extension: extensionPart || 'jar'
  };
}

function mavenFileName(name: string): string {
  const parts = mavenCoordinateParts(name);
  const classifier = parts.classifier ? `-${parts.classifier}` : '';
  return `${parts.artifact}-${parts.version}${classifier}.${parts.extension}`;
}

function mavenRelativePath(name: string): string {
  const parts = mavenCoordinateParts(name);
  return join(parts.group.replaceAll('.', sep), parts.artifact, parts.version, mavenFileName(name));
}

/**
 * MultiMC resolves component libraries by Maven identity rather than by the
 * complete versioned coordinate. Keep classifiers and extensions in the key:
 * a native/test classifier is a distinct artifact, while a later version of
 * the unclassified library replaces the earlier one.
 */
function runtimeLibraryIdentity(name: string): string {
  try {
    const parts = mavenCoordinateParts(name);
    return [parts.group, parts.artifact, parts.classifier ?? '', parts.extension].join(':');
  } catch {
    // Preserve support for non-Maven/local names without allowing unrelated
    // entries to collide with a parseable Maven coordinate.
    return `raw:${name}`;
  }
}

function fallbackMavenUrl(name: string): string {
  return `https://libraries.minecraft.net/${mavenRelativePath(name).split(sep).join('/')}`;
}

async function findFileByName(root: string, fileName: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return path;
    if (entry.isDirectory()) {
      const match = await findFileByName(path, fileName);
      if (match) return match;
    }
  }
  return undefined;
}

async function localArtifactPath(
  packRoot: string,
  name: string,
  explicitPath?: string
): Promise<string | undefined> {
  const fileName = mavenFileName(name);
  const candidates = [
    explicitPath ? (isAbsolute(explicitPath) ? explicitPath : join(packRoot, explicitPath)) : undefined,
    join(packRoot, 'libraries', mavenRelativePath(name)),
    join(packRoot, mavenRelativePath(name)),
    join(packRoot, 'libraries', fileName),
    join(packRoot, fileName)
  ].filter((value): value is string => value !== undefined);
  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) return candidate;
    } catch {
      // Try the next conventional path.
    }
  }
  try {
    return await findFileByName(join(packRoot, 'libraries'), fileName);
  } catch {
    return undefined;
  }
}

function artifactSource(artifact: RuntimeLibraryArtifact | undefined): ArtifactSource {
  return {
    url: optionalString(artifact?.url),
    sha1: normalizeSha1(optionalString(artifact?.sha1)),
    size: optionalNumber(artifact?.size),
    localPath: optionalString(artifact?.path)
  };
}

function isNativeArtifact(name: string, classifier?: string, url?: string): boolean {
  return /(?:^|:)natives-(?:linux|linux-\w+)/.test(name)
    || classifier?.startsWith('natives-') === true
    || /(?:^|[-/])natives-linux(?:[-/.]|$)/.test(url ?? '');
}

function nativeClassifierForPlatform(
  natives: Record<string, string> | undefined,
  platform: RuntimePlatform
): string | undefined {
  if (!natives) return undefined;
  const archToken = platform.arch === 'x86_64' ? '64' : platform.arch;
  const keys = [platform.name, `${platform.name}-${platform.arch}`, `${platform.name}-${archToken}`];
  for (const key of keys) {
    const classifier = natives[key];
    if (typeof classifier === 'string' && classifier.length > 0) {
      return classifier.replaceAll('${arch}', archToken);
    }
  }
  return undefined;
}

async function collectArtifactRequest(
  library: RuntimeLibrary,
  artifact: RuntimeLibraryArtifact | undefined,
  classifier: string | undefined,
  patchUid: string | undefined,
  packRoot: string,
  platform: RuntimePlatform
): Promise<RuntimeArtifactRequest> {
  const source = artifactSource(artifact);
  const localHint = library['MMC-hint'] === 'local' || library['mmc-hint'] === 'local';
  const localPath = localHint
    ? await localArtifactPath(packRoot, library.name, source.localPath)
    : undefined;
  if (localHint && !localPath) {
    throw new Error(`Local runtime library ${library.name} is missing from ${packRoot}/libraries`);
  }
  if (source.url && !localHint && !isAllowedByRuntimeRules(normalizedRules(artifact?.rules), platform)) {
    throw new Error(`Artifact rules unexpectedly rejected selected library ${library.name}`);
  }
  const url = source.url ?? (localHint ? undefined : fallbackMavenUrl(library.name));
  if (!url && !localPath) throw new Error(`Library ${library.name} has no URL or local path`);
  return {
    name: library.name,
    url,
    sha1: source.sha1,
    size: source.size,
    localPath,
    source: localPath ? 'local' : 'download',
    isNative: isNativeArtifact(library.name, classifier, url),
    patchUid,
    classifier
  };
}

async function collectArtifactRequests(
  metadata: RuntimePackMetadata,
  packRoot: string,
  platform: RuntimePlatform
): Promise<{ requests: RuntimeArtifactRequest[]; mainJar?: RuntimeArtifactRequest; assetIndex?: RuntimePatch['assetIndex'] }> {
  const requests: RuntimeArtifactRequest[] = [];
  const librariesByIdentity = new Map<string, { library: RuntimeLibrary; patchUid?: string }>();
  let mainJar: RuntimeArtifactRequest | undefined;
  let assetIndex: RuntimePatch['assetIndex'];
  for (const { patch } of metadata.patches) {
    const patchUid = optionalString(patch.uid);
    if (patch.mainJar) {
      const name = asString(patch.mainJar.name, `${patchUid ?? 'patch'}.mainJar.name`);
      const descriptor = artifactSource(patch.mainJar.downloads?.artifact);
      const localPath = descriptor.localPath
        ? await localArtifactPath(packRoot, name, descriptor.localPath)
        : undefined;
      const request: RuntimeArtifactRequest = {
        name,
        url: descriptor.url ?? (localPath ? undefined : fallbackMavenUrl(name)),
        sha1: descriptor.sha1,
        size: descriptor.size,
        localPath,
        source: localPath ? 'local' : 'download',
        isNative: false,
        patchUid
      };
      mainJar = request;
    }
    if (patch.assetIndex) assetIndex = patch.assetIndex;
    if (!patch.libraries) continue;
    for (const library of patch.libraries) {
      // Component patches are already ordered. A later library with the same
      // Maven group/artifact identity replaces the earlier version; retain a
      // classifier in the identity so tests/native variants do not collide.
      const identity = runtimeLibraryIdentity(library.name);
      librariesByIdentity.delete(identity);
      librariesByIdentity.set(identity, { library, patchUid });
    }
  }
  for (const { library, patchUid } of librariesByIdentity.values()) {
    if (!isAllowedByRuntimeRules(normalizedRules(library.rules), platform)) continue;
    const artifact = library.downloads?.artifact;
    const localHint = library['MMC-hint'] === 'local' || library['mmc-hint'] === 'local';
    if (artifact || localHint) {
      const request = await collectArtifactRequest(library, artifact, undefined, patchUid, packRoot, platform);
      requests.push(request);
    }
    // Launcher classifiers are native variants. Select only the classifier
    // named by natives[platform], never every OS payload in the map.
    const classifier = nativeClassifierForPlatform(library.natives, platform);
    const classifierArtifact = classifier ? library.downloads?.classifiers?.[classifier] : undefined;
    if (classifier && classifierArtifact) {
      if (!isAllowedByRuntimeRules(normalizedRules(classifierArtifact.rules), platform)) continue;
      const classifierName = library.name.includes(':')
        ? `${library.name}:${classifier}`
        : `${library.name}-${classifier}`;
      const classifierLibrary = { ...library, name: classifierName };
      const request = await collectArtifactRequest(
        classifierLibrary,
        classifierArtifact,
        classifier,
        patchUid,
        packRoot,
        platform
      );
      requests.push(request);
    }
  }
  return { requests, mainJar, assetIndex };
}

async function sha1OrSha256File(path: string, algorithm: 'sha1' | 'sha256'): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function fileBytes(path: string): Promise<number> {
  return (await stat(path)).size;
}

async function verifyArtifactFile(
  path: string,
  expectedSha1: string | undefined,
  expectedSize: number | undefined,
  label: string
): Promise<{ bytes: number; sha1: string }> {
  const bytes = await fileBytes(path);
  if (expectedSize !== undefined && expectedSize > 0 && bytes !== expectedSize) {
    throw new Error(`${label} size mismatch: expected ${expectedSize}, received ${bytes}`);
  }
  const sha1 = await sha1OrSha256File(path, 'sha1');
  if (expectedSha1 && sha1 !== expectedSha1) {
    throw new Error(`${label} SHA-1 mismatch: expected ${expectedSha1}, received ${sha1}`);
  }
  return { bytes, sha1 };
}

class ImmutableArtifactCache {
  readonly root: string;
  private readonly downloadTimeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(root: string, options: { downloadTimeoutMs?: number; fetch?: typeof fetch } = {}) {
    this.root = resolve(root);
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 120_000;
    this.fetcher = options.fetch ?? fetch;
  }

  private destination(sha1: string, name: string, url?: string): string {
    let fileName = basename(name);
    if (name.includes(':') || !extname(fileName)) {
      try {
        fileName = mavenFileName(name);
      } catch {
        try {
          const urlFileName = url ? basename(new URL(url).pathname) : '';
          if (urlFileName && extname(urlFileName)) fileName = urlFileName;
        } catch {
          // Keep the sanitized coordinate as a last-resort cache name.
        }
      }
    }
    const safeName = fileName.replaceAll(/[^A-Za-z0-9._-]/g, '_');
    return join(this.root, 'sha1', sha1, safeName);
  }

  private async tryCached(
    sha1: string | undefined,
    name: string,
    expectedSize: number | undefined,
    url: string | undefined
  ): Promise<ResolvedRuntimeArtifact | undefined> {
    if (!sha1) return undefined;
    const path = this.destination(sha1, name, url);
    try {
      const checked = await verifyArtifactFile(path, sha1, expectedSize, `Cached artifact ${name}`);
      return { path, cachePath: path, bytes: checked.bytes, actualSha1: checked.sha1 } as ResolvedRuntimeArtifact;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      await rm(path, { force: true });
      return undefined;
    }
  }

  private async downloadTo(url: string, target: string): Promise<void> {
    if (url.startsWith('file://')) {
      const localPath = new URL(url);
      await copyFile(localPath, target);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.downloadTimeoutMs);
    try {
      const response = await this.fetcher(url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
      }
      const body = response.body as unknown as ReadableStream<Uint8Array>;
      await pipeline(Readable.fromWeb(body as any), createWriteStream(target, { flags: 'wx' }));
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolve(request: RuntimeArtifactRequest, download = true): Promise<ResolvedRuntimeArtifact> {
    await mkdir(this.root, { recursive: true });
    const cached = await this.tryCached(request.sha1, request.name, request.size, request.url);
    if (cached) return { ...request, ...cached };
    if (!download && request.source === 'download') {
      throw new Error(`Artifact ${request.name} is not cached and downloading is disabled`);
    }
    if (request.source === 'local' && !request.localPath) {
      throw new Error(`Local artifact ${request.name} has no source path`);
    }
    const temporaryDirectory = join(this.root, 'tmp');
    await mkdir(temporaryDirectory, { recursive: true });
    const temporaryPath = join(temporaryDirectory, `.artifact-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
      if (request.source === 'local') await copyFile(request.localPath!, temporaryPath);
      else await this.downloadTo(request.url!, temporaryPath);
      const checked = await verifyArtifactFile(temporaryPath, request.sha1, request.size, request.name);
      const destination = this.destination(checked.sha1, request.name, request.url);
      await mkdir(dirname(destination), { recursive: true });
      try {
        const existing = await verifyArtifactFile(destination, checked.sha1, checked.bytes, `Cached artifact ${request.name}`);
        await rm(temporaryPath, { force: true });
        return { ...request, path: destination, cachePath: destination, bytes: existing.bytes, actualSha1: existing.sha1 };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await rm(destination, { force: true });
      }
      await chmod(temporaryPath, 0o444);
      await rename(temporaryPath, destination);
      return { ...request, path: destination, cachePath: destination, bytes: checked.bytes, actualSha1: checked.sha1 };
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

function defaultIdentity(identity: ResolveRuntimeOptions['identity']): RuntimeIdentity {
  const username = identity?.username ?? process.env.GTNH_OFFLINE_USERNAME ?? 'GTNH';
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
    throw new Error(`Offline username must contain 1-16 ASCII letters, digits, or underscores: ${username}`);
  }
  const uuid = identity?.uuid ?? offlineUuid(username);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid)) {
    throw new Error(`Invalid offline UUID ${uuid}`);
  }
  return {
    username,
    uuid: uuid.toLowerCase(),
    accessToken: identity?.accessToken ?? '0',
    userProperties: identity?.userProperties ?? '{}',
    userType: identity?.userType ?? 'legacy'
  };
}

/** Minecraft's standard UUID.nameUUIDFromBytes("OfflinePlayer:" + name) identity. */
export function offlineUuid(username: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x30;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parse the legacy space-separated minecraftArguments field with basic quote/escape support. */
export function splitRuntimeArguments(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        result.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  if (quote) throw new Error('Unterminated quote in minecraftArguments');
  if (current) result.push(current);
  return result;
}

function argumentValues(argument: RuntimeArgument, platform: RuntimePlatform): string[] {
  if (typeof argument === 'string') return [argument];
  if (!isAllowedByRuntimeRules(argument.rules, platform)) return [];
  return Array.isArray(argument.value) ? argument.value : [argument.value];
}

function substituteRuntimeArgument(value: string, identity: RuntimeIdentity, resolution: {
  version: string;
  gameDirectory: string;
  assetsDirectory: string;
  assetIndex: string;
}): string {
  const substitutions: Record<string, string> = {
    auth_player_name: identity.username,
    auth_uuid: identity.uuid,
    auth_access_token: identity.accessToken,
    user_properties: identity.userProperties,
    user_type: identity.userType,
    version_name: resolution.version,
    game_directory: resolution.gameDirectory,
    assets_root: resolution.assetsDirectory,
    assets_index_name: resolution.assetIndex,
    user_property_map: identity.userProperties,
    auth_session: identity.accessToken
  };
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => substitutions[key] ?? match);
}

function buildRuntimeArguments(
  metadata: RuntimePackMetadata,
  identity: RuntimeIdentity,
  platform: RuntimePlatform,
  gameDirectory: string,
  assetsDirectory: string,
  assetIndex: string,
  version: string
): { jvmArgs: string[]; gameArgs: string[] } {
  const jvmArgs: string[] = [];
  const gameArgs: string[] = [];
  let minecraftArguments: string | undefined;
  for (const { patch } of metadata.patches) {
    if (typeof patch.minecraftArguments === 'string') minecraftArguments = patch.minecraftArguments;
    const modernArguments = patch.arguments;
    for (const argument of modernArguments?.jvm ?? []) jvmArgs.push(...argumentValues(argument, platform));
    for (const argument of modernArguments?.game ?? []) gameArgs.push(...argumentValues(argument, platform));
    const patchJvmArgs = patch['+jvmArgs'];
    if (Array.isArray(patchJvmArgs)) jvmArgs.push(...patchJvmArgs.filter((value): value is string => typeof value === 'string'));
    const patchGameArgs = patch['+gameArgs'];
    if (Array.isArray(patchGameArgs)) gameArgs.push(...patchGameArgs.filter((value): value is string => typeof value === 'string'));
    const patchMinecraftArgs = patch['+minecraftArguments'];
    if (typeof patchMinecraftArgs === 'string') gameArgs.push(...splitRuntimeArguments(patchMinecraftArgs));
    else if (Array.isArray(patchMinecraftArgs)) gameArgs.push(...patchMinecraftArgs.filter((value): value is string => typeof value === 'string'));
    for (const tweaker of patch['+tweakers'] ?? []) {
      if (typeof tweaker === 'string') gameArgs.push('--tweakClass', tweaker);
    }
  }
  if (minecraftArguments) {
    const legacy = splitRuntimeArguments(minecraftArguments).map((value) => substituteRuntimeArgument(value, identity, {
      version,
      gameDirectory,
      assetsDirectory,
      assetIndex
    }));
    gameArgs.unshift(...legacy);
  }
  return {
    jvmArgs,
    gameArgs: gameArgs.map((value) => substituteRuntimeArgument(value, identity, {
      version,
      gameDirectory,
      assetsDirectory,
      assetIndex
    }))
  };
}

async function extractNatives(
  artifacts: readonly ResolvedRuntimeArtifact[],
  nativesDirectory: string,
  unzipCommand: string
): Promise<void> {
  await mkdir(nativesDirectory, { recursive: true });
  for (const artifact of artifacts) {
    if (!artifact.isNative) continue;
    await execFile(unzipCommand, ['-q', '-o', artifact.path, '-d', nativesDirectory]);
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const result: R[] = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      result[index] = await mapper(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, values.length || 1)) }, worker));
  return result;
}

function safeAssetPath(root: string, logicalName: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, logicalName);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`Asset path escapes its root: ${logicalName}`);
  }
  return target;
}

async function materializeAsset(
  source: string,
  target: string,
  sha1: string,
  size: number,
  label: string
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  try {
    await verifyArtifactFile(target, sha1, size, label);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await rm(target, { force: true });
  }
  await copyFile(source, target);
}

async function resolveAssetIndex(
  descriptor: RuntimePatch['assetIndex'],
  cache: ImmutableArtifactCache,
  gameDirectory: string,
  download: boolean,
  concurrency: number
): Promise<RuntimeAssetIndex> {
  if (!descriptor) throw new Error('No assetIndex metadata found in component patches');
  const id = asString(descriptor.id, 'assetIndex.id');
  const descriptorArtifact = artifactSource(descriptor.downloads?.artifact);
  const source: RuntimeArtifactRequest = {
    name: `asset-index-${id}.json`,
    url: descriptorArtifact.url ?? optionalString(descriptor.url),
    sha1: descriptorArtifact.sha1 ?? normalizeSha1(optionalString(descriptor.sha1)),
    size: descriptorArtifact.size ?? optionalNumber(descriptor.size),
    source: 'download',
    isNative: false
  };
  if (!source.url) throw new Error(`Asset index ${id} has no download URL`);
  const resolved = await cache.resolve(source, download);
  const document = await readJson<AssetIndexDocument>(resolved.path);
  if (!document.objects || typeof document.objects !== 'object') throw new Error(`Asset index ${id} has no objects map`);
  const assetsDirectory = join(gameDirectory, 'assets');
  const objectsDirectory = join(assetsDirectory, 'objects');
  const virtualName = document.virtual === true
    ? 'legacy'
    : typeof document.virtual === 'string' && document.virtual.length > 0
      ? document.virtual
      : undefined;
  const virtualDirectory = virtualName ? join(assetsDirectory, 'virtual', virtualName) : undefined;
  const resourcesDirectory = document.map_to_resources === true
    ? join(assetsDirectory, 'resources')
    : undefined;
  const entries = Object.entries(document.objects).sort(([left], [right]) => left.localeCompare(right));
  const objectResults = await mapWithConcurrency(entries, concurrency, async ([name, object]) => {
    const hash = normalizeSha1(optionalString(object?.hash));
    const size = optionalNumber(object?.size);
    if (!hash || size === undefined || size < 0) throw new Error(`Invalid asset object ${name} in index ${id}`);
    const objectRequest: RuntimeArtifactRequest = {
      name: `asset-object-${hash}`,
      url: `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
      sha1: hash,
      size,
      source: 'download',
      isNative: false
    };
    const cachedObject = await cache.resolve(objectRequest, download);
    const target = join(objectsDirectory, hash.slice(0, 2), hash);
    await mkdir(dirname(target), { recursive: true });
    await materializeAsset(cachedObject.path, target, hash, size, `Asset object ${name}`);
    const materializedPaths = [target];
    if (virtualDirectory) {
      const virtualTarget = safeAssetPath(virtualDirectory, name);
      await materializeAsset(cachedObject.path, virtualTarget, hash, size, `Virtual asset ${name}`);
      materializedPaths.push(virtualTarget);
    }
    if (resourcesDirectory) {
      const resourcesTarget = safeAssetPath(resourcesDirectory, name);
      await materializeAsset(cachedObject.path, resourcesTarget, hash, size, `Resource asset ${name}`);
      materializedPaths.push(resourcesTarget);
    }
    return {
      name,
      hash,
      size,
      path: target,
      cachePath: cachedObject.path,
      materializedPaths
    } satisfies RuntimeAssetObject;
  });
  return {
    id,
    path: resolved.path,
    sha1: resolved.actualSha1,
    bytes: resolved.bytes,
    objects: objectResults,
    assetsDirectory,
    virtualDirectory,
    resourcesDirectory
  };
}

function patchVersion(metadata: RuntimePackMetadata): string {
  const minecraft = metadata.patches.find(({ patch }) => patch.uid === 'net.minecraft')?.patch;
  const component = metadata.components.find((candidate) => candidate.uid === 'net.minecraft');
  return optionalString(minecraft?.version) ?? optionalString(component?.version) ?? 'unknown';
}

export async function resolveRuntime(options: ResolveRuntimeOptions): Promise<RuntimeResolution> {
  const cacheDirectory = resolve(options.cacheDirectory ?? DEFAULT_CACHE_DIRECTORY);
  const packRoot = await resolvePackRootInput(options.root, cacheDirectory);
  const metadata = await readRuntimePackMetadata(packRoot);
  const platform = options.platform ?? LINUX_X86_64;
  if (platform.name !== 'linux' || platform.arch !== 'x86_64') {
    throw new Error(`This runtime currently supports Linux x86_64 only, received ${platform.name}/${platform.arch}`);
  }
  const minecraftDirectory = join(packRoot, '.minecraft');
  const minecraftDirectoryStat = await stat(minecraftDirectory).catch(() => undefined);
  const gameDirectory = resolve(options.gameDirectory ?? (minecraftDirectoryStat?.isDirectory() ? minecraftDirectory : packRoot));
  const nativesDirectory = resolve(options.nativesDirectory ?? join(gameDirectory, 'natives'));
  const cache = new ImmutableArtifactCache(cacheDirectory, {
    downloadTimeoutMs: options.downloadTimeoutMs,
    fetch: options.fetch
  });
  const collected = await collectArtifactRequests(metadata, packRoot, platform);
  if (!collected.mainJar) throw new Error('No mainJar metadata found in component patches');
  const download = options.download ?? true;
  const artifacts = await mapWithConcurrency(collected.requests, 4, (request) => cache.resolve(request, download));
  const mainJar = await cache.resolve(collected.mainJar, download);
  artifacts.push(mainJar);
  const assetIndex = await resolveAssetIndex(
    collected.assetIndex,
    cache,
    gameDirectory,
    download,
    options.assetConcurrency ?? DEFAULT_ASSET_CONCURRENCY
  );
  if (options.extractNatives ?? true) await extractNatives(artifacts, nativesDirectory, options.unzipCommand ?? 'unzip');
  const mainClass = [...metadata.patches]
    .map(({ patch }) => optionalString(patch.mainClass))
    .filter((value): value is string => value !== undefined)
    .at(-1);
  if (!mainClass) throw new Error('No mainClass metadata found in component patches');
  const identity = defaultIdentity(options.identity);
  const argumentsResult = buildRuntimeArguments(
    metadata,
    identity,
    platform,
    gameDirectory,
    assetIndex.assetsDirectory,
    assetIndex.id,
    patchVersion(metadata)
  );
  const classpath = artifacts.filter((artifact) => !artifact.isNative).map((artifact) => artifact.path);
  argumentsResult.jvmArgs.push(
    `-Djava.library.path=${nativesDirectory}`,
    `-Dorg.lwjgl.librarypath=${nativesDirectory}`,
    // Forge 1.7.10's legacy security-manager bootstrap is rejected by Java 18+
    // unless this compatibility switch is explicitly enabled.
    '-Djava.security.manager=allow'
  );
  return {
    schemaVersion: 1,
    packRoot,
    minecraftDirectory,
    gameDirectory,
    cacheDirectory,
    nativesDirectory,
    platform,
    patches: metadata.patches.map(({ file, patch }) => ({
      file,
      uid: optionalString(patch.uid),
      version: optionalString(patch.version),
      order: Number.isFinite(patch.order) ? Number(patch.order) : 0
    })),
    artifacts,
    classpath,
    mainClass,
    jvmArgs: argumentsResult.jvmArgs,
    gameArgs: argumentsResult.gameArgs,
    identity,
    assetIndex
  };
}

export function createLaunchPlan(resolution: RuntimeResolution, options: LaunchPlanOptions = {}): RuntimeLaunchPlan {
  const java = options.java ?? process.env.JAVA ?? 'java';
  const useXvfb = options.useXvfb ?? true;
  const xvfbRun = options.xvfbRun ?? process.env.GTNH_XVFB_RUN ?? 'xvfb-run';
  const xvfbArgs = options.xvfbArgs ?? ['-a'];
  const javaCommand = [java, ...resolution.jvmArgs, '-cp', resolution.classpath.join(':'), resolution.mainClass, ...resolution.gameArgs];
  const command = useXvfb ? [xvfbRun, ...xvfbArgs, ...javaCommand] : javaCommand;
  return {
    ...resolution,
    java,
    xvfbRun: useXvfb ? xvfbRun : undefined,
    xvfbArgs: useXvfb ? xvfbArgs : [],
    command,
    timeoutMs: options.timeoutMs,
    statusFile: options.statusFile
  };
}

async function writeLaunchStatus(path: string, status: RuntimeLaunchStatus): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

export async function launchRuntime(plan: RuntimeLaunchPlan, options: LaunchOptions = {}): Promise<RuntimeLaunchStatus> {
  const statusFile = options.statusFile ?? plan.statusFile;
  const update = async (status: RuntimeLaunchStatus): Promise<void> => {
    if (statusFile) await writeLaunchStatus(statusFile, status);
    options.onStatus?.(status);
  };
  const started: RuntimeLaunchStatus = {
    schemaVersion: 1,
    state: 'starting',
    updatedAt: new Date().toISOString()
  };
  await update(started);
  const { spawn } = await import('node:child_process');
  const child = spawn(plan.command[0]!, plan.command.slice(1), {
    cwd: plan.gameDirectory,
    env: { ...process.env, ...options.env },
    stdio: 'inherit'
  });
  const abortChild = () => {
    child.kill('SIGTERM');
  };
  if (options.signal?.aborted) abortChild();
  else options.signal?.addEventListener('abort', abortChild, { once: true });
  const running: RuntimeLaunchStatus = {
    schemaVersion: 1,
    state: 'running',
    pid: child.pid,
    updatedAt: new Date().toISOString()
  };
  await update(running);
  return new Promise<RuntimeLaunchStatus>((resolveLaunch, rejectLaunch) => {
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    if ((options.timeoutMs ?? plan.timeoutMs) !== undefined && (options.timeoutMs ?? plan.timeoutMs)! > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        void update({
          schemaVersion: 1,
          state: 'timeout',
          pid: child.pid,
          updatedAt: new Date().toISOString()
        });
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }, options.timeoutMs ?? plan.timeoutMs);
    }
    child.once('error', (error) => {
      if (timeout) clearTimeout(timeout);
      void update({
        schemaVersion: 1,
        state: 'failed',
        pid: child.pid,
        updatedAt: new Date().toISOString(),
        error: error.message
      }).finally(() => rejectLaunch(error));
    });
    child.once('exit', (exitCode, signal) => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortChild);
      const finalStatus: RuntimeLaunchStatus = {
        schemaVersion: 1,
        state: timedOut ? 'timeout' : exitCode === 0 ? 'exited' : 'failed',
        pid: child.pid,
        exitCode,
        signal,
        updatedAt: new Date().toISOString(),
        ...(timedOut ? { error: 'Runtime launch timed out' } : {})
      };
      void update(finalStatus).finally(() => resolveLaunch(finalStatus));
    });
  });
}

export async function waitForRuntimeStatus(
  statusFile: string,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<RuntimeLaunchStatus> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const status = await readJson<RuntimeLaunchStatus>(statusFile);
      if (['exited', 'failed', 'timeout'].includes(status.state)) return status;
    } catch {
      // The status file may be in the middle of its atomic replacement.
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  throw new Error(`Timed out waiting for runtime status file ${statusFile}`);
}

export function runtimePlanJson(plan: RuntimeLaunchPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
