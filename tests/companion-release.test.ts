import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  retireCompanionReleases,
  writeCompanionRelease,
} from '../tools/pack-builder/companionRelease';

it('retains older companion registrations and their exact provenance when another dataset is exported', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'companion-release-'));
  try {
    const registry = join(directory, 'generated/registry.json');
    const provenance = join(directory, 'source');
    const oldDescriptor = { sha256: 'old', bytes: 10 };
    const nextDescriptor = { sha256: 'next', bytes: 20 };
    await writeCompanionRelease(registry, provenance, oldDescriptor, {
      datasetId: '2.9.0-old',
      assets: [oldDescriptor],
    });
    const oldBytes = await readFile(join(provenance, 'provenance.json'), 'utf8');
    await writeCompanionRelease(registry, provenance, nextDescriptor, {
      datasetId: '2.9.0-next',
      assets: [nextDescriptor],
    });
    expect(JSON.parse(await readFile(registry, 'utf8')).releases).toEqual({
      '2.9.0-old': oldDescriptor,
      '2.9.0-next': nextDescriptor,
    });
    expect(await readFile(join(provenance, 'releases/2.9.0-old.json'), 'utf8')).toBe(oldBytes);
    expect(await readFile(join(provenance, 'releases/2.9.0-next.json'), 'utf8')).toBe(
      await readFile(join(provenance, 'provenance.json'), 'utf8'),
    );
    await expect(
      writeCompanionRelease(registry, provenance, nextDescriptor, { datasetId: '../outside' }),
    ).rejects.toThrow(/identity/);
    await retireCompanionReleases(registry, ['2.9.0-old'], provenance);
    expect(JSON.parse(await readFile(registry, 'utf8')).releases).toEqual({
      '2.9.0-next': nextDescriptor,
    });
    await expect(readFile(join(provenance, 'releases/2.9.0-old.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
