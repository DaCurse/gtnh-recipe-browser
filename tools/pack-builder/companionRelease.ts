import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Keep older dataset companions usable when another export of the same game
 * version is added. The legacy provenance path remains the latest release. */
export async function writeCompanionRelease(
  registryPath: string,
  provenanceDirectory: string,
  descriptor: { sha256: string; bytes: number },
  provenance: { datasetId: string } & Record<string, unknown>,
): Promise<void> {
  const readOptional = (path: string) =>
    readFile(path, 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    });
  const archive = join(provenanceDirectory, 'releases');
  await mkdir(archive, { recursive: true });
  const save = async (bytes: string) => {
    const { datasetId } = JSON.parse(bytes) as { datasetId: string };
    if (typeof datasetId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(datasetId))
      throw new Error('Invalid companion dataset identity');
    await writeFile(join(archive, `${datasetId}.json`), bytes);
  };
  const provenancePath = join(provenanceDirectory, 'provenance.json');
  const previous = await readOptional(provenancePath);
  if (previous) await save(previous);
  const bytes = JSON.stringify(provenance, null, 2) + '\n';
  await save(bytes);
  await writeFile(provenancePath, bytes);
  const registry = JSON.parse(
    (await readOptional(registryPath)) ?? '{"schemaVersion":1,"releases":{}}',
  ) as {
    schemaVersion: number;
    releases: Record<string, { sha256: string; bytes: number }>;
  };
  if (registry.schemaVersion !== 1 || !registry.releases)
    throw new Error('Invalid companion registry');
  registry.releases[provenance.datasetId] = descriptor;
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(registry) + '\n');
}

/** Retired datasets must not leave companion indexes pointing at pruned assets.
 * Git history retains provenance for retired releases. */
export async function retireCompanionReleases(
  registryPath: string,
  datasetIds: readonly string[],
  provenanceDirectory: string,
): Promise<void> {
  if (!datasetIds.length) return;
  const bytes = await readFile(registryPath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!bytes) return;
  const registry = JSON.parse(bytes) as {
    schemaVersion: number;
    releases: Record<string, unknown>;
  };
  if (registry.schemaVersion !== 1 || !registry.releases)
    throw new Error('Invalid companion registry');
  for (const id of datasetIds) {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Invalid companion dataset identity');
    delete registry.releases[id];
    await rm(join(provenanceDirectory, 'releases', `${id}.json`), { force: true });
  }
  await writeFile(registryPath, JSON.stringify(registry) + '\n');
}
