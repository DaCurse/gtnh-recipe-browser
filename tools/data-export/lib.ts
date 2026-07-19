import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface ExportSession {
  schemaVersion: 1;
  gtnhVersion: string;
  createdAt: string;
  workDirectory: string;
  instanceDirectory: string;
  archive: {
    path: string;
    bytes: number;
    sha256: string;
  };
  exporter: {
    repository: string;
    commit: string;
    patchSha256: string;
    mainJar: string;
    mainJarSha256: string;
    dependenciesJar: string;
    dependenciesJarSha256: string;
  };
  processor: {
    repository: string;
    commit: string;
  };
  toolchains: {
    java: string;
    dotnetSdk: string;
  };
}

export interface VersionsIndexEntry {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  publishedAt: string;
  packManifestUrl: string;
  catalogBytes: number;
  offlineBytes: number;
}

export interface VersionsIndex {
  schemaVersion: 1;
  generatedAt: string;
  versions: VersionsIndexEntry[];
}

export function argumentsMap(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

export function requiredArgument(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`Missing required argument --${key}`);
  return value;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function combinedRevision(data: Uint8Array, atlas: Uint8Array): string {
  return createHash('sha256').update(data).update(atlas).digest('hex').slice(0, 12);
}

export async function findFiles(root: string, filename: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === filename) matches.push(path);
    }
  };
  await visit(root);
  return matches.sort();
}

export async function assertPathMissing(path: string, label: string): Promise<void> {
  try {
    await stat(path);
    throw new Error(`${label} already exists: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function readExportSession(path: string): Promise<ExportSession> {
  const session = JSON.parse(await readFile(path, 'utf8')) as ExportSession;
  if (session.schemaVersion !== 1) throw new Error(`Unsupported export session ${session.schemaVersion}`);
  return session;
}

export async function validateCombinedTooltipSchema(
  scriptPath: string,
  requiredPlugins: string[] = []
): Promise<void> {
  const lines = createInterface({
    input: createReadStream(scriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  let itemSchema = '';
  let collectionSchema = false;
  const activePlugins = new Set<string>();
  for await (const line of lines) {
    if (line.startsWith('CREATE MEMORY TABLE PUBLIC.ITEM(')) itemSchema = line;
    if (line.startsWith('CREATE MEMORY TABLE PUBLIC.ITEM_TOOLTIP(')) collectionSchema = true;
    const plugin = /^INSERT INTO METADATA_ACTIVE_PLUGINS VALUES\(\d+,'([^']+)'\)$/.exec(line);
    if (plugin?.[1]) activePlugins.add(plugin[1]);
  }
  lines.close();
  if (!itemSchema) throw new Error('NESQL export has no PUBLIC.ITEM table');
  if (!/\bTOOLTIP\b/.test(itemSchema) || collectionSchema) {
    throw new Error('NESQL tooltip compatibility patch was not applied: expected one TOOLTIP column');
  }
  const missingPlugins = requiredPlugins.filter((plugin) => !activePlugins.has(plugin));
  if (missingPlugins.length > 0) {
    throw new Error(`NESQL export is missing required active plugins: ${missingPlugins.join(', ')}`);
  }
}

export function withPublishedVersion(
  index: VersionsIndex,
  version: VersionsIndexEntry,
  generatedAt: string
): VersionsIndex {
  if (index.schemaVersion !== 1) throw new Error(`Unsupported versions index ${index.schemaVersion}`);
  return {
    schemaVersion: 1,
    generatedAt,
    versions: [version, ...index.versions.filter((candidate) => candidate.datasetId !== version.datasetId)]
  };
}

export async function directoryDigest(root: string): Promise<string> {
  const files: string[] = [];
  const visit = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  await visit(root, '');
  files.sort();
  const hash = createHash('sha256');
  for (const relative of files) {
    hash.update(relative);
    hash.update('\0');
    hash.update(await readFile(join(root, relative)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
