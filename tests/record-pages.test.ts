import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { encode, decode } from '@msgpack/msgpack';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRecordPages, readLogicalAsset } from '../tools/pack-builder/recordPages';
import type { GeneratedPackManifest, ImmutableAsset } from '../tools/pack-builder/manifest';
import { assembleRecordPages } from '../src/lib/recordPages';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'record-pages-'));
  directories.push(path);
  return path;
}
async function asset(directory: string, records: unknown[]): Promise<ImmutableAsset> {
  const bytes = gzipSync(encode({ schemaVersion: 5, kind: 'recipeShard', logicalId: 'test', recipes: records }), { level: 9 });
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory, hash), bytes);
  return { id: 'test', sha256: hash, bytes: bytes.length, encoding: 'gzip', mediaType: 'application/msgpack', url: hash };
}
describe('immutable record pages', () => {
  it('reuses frozen records after insertions, deletion, modification and reordering without a base manifest', async () => {
    const first = await directory();
    const records = Array.from({ length: 500 }, (_, id) => ({ id: `recipe-${id}`, value: 'content'.repeat(100) }));
    const original = await asset(first, records);
    const pages = await buildRecordPages([original], first, '../..', []);
    const prior = { recordPages: pages } as GeneratedPackManifest;
    for (const changed of [
      [...records, { id: 'inserted', value: 'new' }],
      records.slice(1),
      records.map((record, i) => i === 20 ? { ...record, value: 'modified' } : record),
      records.toReversed()
    ]) {
      const next = await directory();
      const logical = await asset(next, changed);
      const nextPages = await buildRecordPages([logical], next, '../..', [{ manifest: prior, assetsDirectory: first }]);
      expect(pages.every((page) => nextPages.some((nextPage) => nextPage.sha256 === page.sha256))).toBe(true);
      expect(nextPages.filter((page) => !pages.some((previous) => previous.sha256 === page.sha256)).length).toBeLessThanOrEqual(1);
      const result = await readLogicalAsset(logical, { recordPages: nextPages } as GeneratedPackManifest, next);
      expect((decode(result) as { recipes: unknown[] }).recipes).toEqual(changed);
      for (const page of pages) expect(await readFile(join(next, page.sha256))).toEqual(await readFile(join(first, page.sha256)));
    }
  });
  it('keeps an oversized singleton intact and rejects invalid selections and missing membership', async () => {
    const path = await directory();
    const logical = await asset(path, [{ id: 'large', text: 'x'.repeat(2_500_000) }]);
    const pages = await buildRecordPages([logical], path, '../..', []);
    expect(pages.some((page) => page.oversizedSingleton)).toBe(true);
    expect((decode(await readLogicalAsset(logical, { recordPages: pages } as GeneratedPackManifest, path)) as { recipes: unknown[] }).recipes).toHaveLength(1);
    await expect(readLogicalAsset(logical, { recordPages: [] } as unknown as GeneratedPackManifest, path)).rejects.toThrow('absent from manifest');
    expect(() => assembleRecordPages({ ...logical, segments: [[9, 0, 1]] }, new Map())).toThrow();
    expect(() => assembleRecordPages({ ...logical, segments: [[0, -1, 1]] }, new Map([[0, [new Uint8Array(1)]]]))).toThrow();
  });
});
