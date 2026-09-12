import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  buildSharedIcons,
  canonicalSharedIconPixels,
  sharedIconPixelHash,
  sharedIconPixelsEquivalent,
  type SharedIconOwner,
  type SharedIconSheetAsset
} from '../tools/pack-builder/sharedIcons';

const temporaryDirectories: string[] = [];

async function writeAtlas(
  directory: string,
  name: string,
  sprites: ReadonlyMap<number, Buffer>
): Promise<string> {
  const width = 8192;
  const height = 32;
  const raw = Buffer.alloc(width * height * 4);
  for (const [iconId, pixels] of sprites) {
    const x = (iconId % 256) * 32;
    const y = Math.floor(iconId / 256) * 32;
    for (let row = 0; row < 32; row++) {
      pixels.copy(raw, ((y + row) * width + x) * 4, row * 128, row * 128 + 128);
    }
  }
  const path = join(directory, `${name}.webp`);
  await sharp(raw, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toFile(path);
  return path;
}

function sprite(red: number, transparentRgb = false): Buffer {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = 32;
    pixels[index + 2] = 64;
    pixels[index + 3] = 255;
  }
  if (transparentRgb) {
    pixels[0] = 255;
    pixels[1] = 254;
    pixels[2] = 253;
    pixels[3] = 0;
  }
  return pixels;
}

function owners(...entries: Array<[string, number]>): SharedIconOwner[] {
  return entries.map(([id, iconId]) => ({ id, iconId }));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('content-addressed shared icon pages', () => {
  it('deduplicates identical pixels and canonicalizes invisible RGB', async () => {
    const directory = await mkdtemp('/tmp/gtnh-shared-icons-test-');
    temporaryDirectories.push(directory);
    const common = sprite(10, true);
    const invisibleRgb = sprite(10, true);
    invisibleRgb[0] = 1;
    invisibleRgb[1] = 2;
    invisibleRgb[2] = 3;
    const atlasPath = await writeAtlas(directory, 'source', new Map([
      [0, common],
      [1, invisibleRgb],
      [2, sprite(20)]
    ]));
    const result = await buildSharedIcons({
      atlasPath,
      owners: owners(['owner-a', 0], ['owner-b', 1], ['owner-c', 2]),
      outputDirectory: join(directory, 'pack')
    });

    expect(result.stats).toMatchObject({
      ownerCount: 3,
      uniqueSpriteCount: 2,
      reusedSpriteCount: 0,
      newSpriteCount: 2,
      newSheetCount: 1
    });
    expect(result.assets).toHaveLength(1);
    expect(result.slots.get('owner-a')).toEqual(result.slots.get('owner-b'));
    expect(result.slots.get('owner-a')?.spriteHash).toBe(sharedIconPixelHash(canonicalSharedIconPixels(common)));
    expect('spriteHashes' in result.assets[0]!).toBe(false);
    expect(result.slots.get('owner-a')?.index).toBeLessThan(result.assets[0]?.iconCount ?? 0);
    expect(result.slots.get('owner-c')?.index).toBeLessThan(result.assets[0]?.iconCount ?? 0);
  });

  it('keeps old slots and pages frozen while appending a changed sprite', async () => {
    const directory = await mkdtemp('/tmp/gtnh-shared-icons-test-');
    temporaryDirectories.push(directory);
    const firstAtlas = await writeAtlas(directory, 'first', new Map([
      [0, sprite(10)],
      [1, sprite(20)]
    ]));
    const first = await buildSharedIcons({
      atlasPath: firstAtlas,
      owners: owners(['owner-a', 0], ['owner-b', 1]),
      outputDirectory: join(directory, 'first-pack')
    });
    const firstAsset = first.assets[0]!;
    const blankBytes = await sharp(Buffer.alloc(1024 * 1024 * 4), {
      raw: { width: 1024, height: 1024, channels: 4 }
    }).webp({ lossless: true }).toBuffer();
    const blankSha = createHash('sha256').update(blankBytes).digest('hex');
    await mkdir(join(directory, 'first-pack', 'assets', 'sha256'), { recursive: true });
    await writeFile(join(directory, 'first-pack', 'assets', 'sha256', blankSha), blankBytes);
    const unusedDescriptor: SharedIconSheetAsset = {
      id: blankSha,
      url: `./assets/sha256/${blankSha}`,
      bytes: blankBytes.byteLength,
      sha256: blankSha,
      encoding: 'identity',
      mediaType: 'image/webp',
      kind: 'iconSheet',
      iconCount: 0,
      columns: 32,
      rows: 32,
      spriteSize: 32
    };
    const secondAtlas = await writeAtlas(directory, 'second', new Map([
      [0, sprite(10)],
      [1, sprite(20)],
      [2, sprite(30)]
    ]));
    const second = await buildSharedIcons({
      atlasPath: secondAtlas,
      owners: owners(['owner-a', 0], ['owner-b', 1], ['owner-c', 2]),
      previous: [{
        manifest: [firstAsset, unusedDescriptor],
        assetDirectory: join(directory, 'first-pack', 'assets', 'sha256')
      }],
      outputDirectory: join(directory, 'second-pack')
    });

    expect(second.stats).toMatchObject({
      uniqueSpriteCount: 3,
      reusedSpriteCount: 2,
      newSpriteCount: 1,
      selectedPreviousSheetCount: 1,
      newSheetCount: 1
    });
    expect(second.assets).toHaveLength(2);
    expect(second.assets.every((asset) => !('spriteHashes' in asset))).toBe(true);
    expect(second.slots.get('owner-a')).toEqual(first.slots.get('owner-a'));
    expect(second.slots.get('owner-b')).toEqual(first.slots.get('owner-b'));
    expect(second.assets.some((asset) => asset.sha256 === blankSha)).toBe(false);
    const appended = second.assets.find((asset) => asset.sha256 !== firstAsset.sha256);
    expect(appended?.iconCount).toBe(1);
    expect(second.slots.get('owner-c')?.index).toBeLessThan(appended?.iconCount ?? 0);
    expect(second.slots.get('owner-c')?.sheetId).toBe(appended?.id);
  });

  it('reuses the owner slot for sub-visible renderer noise', async () => {
    const directory = await mkdtemp('/tmp/gtnh-shared-icons-test-');
    temporaryDirectories.push(directory);
    const firstAtlas = await writeAtlas(directory, 'first-noise', new Map([[0, sprite(40)]]));
    const first = await buildSharedIcons({
      atlasPath: firstAtlas,
      owners: owners(['owner-a', 0]),
      outputDirectory: join(directory, 'first-noise-pack')
    });
    const noisy = sprite(41);
    const secondAtlas = await writeAtlas(directory, 'second-noise', new Map([[0, noisy]]));
    const second = await buildSharedIcons({
      atlasPath: secondAtlas,
      owners: owners(['owner-a', 0]),
      previous: [{
        manifest: first.assets,
        ownerSlots: first.slots,
        assetDirectory: join(directory, 'first-noise-pack', 'assets', 'sha256')
      }],
      outputDirectory: join(directory, 'second-noise-pack')
    });
    expect(second.stats).toMatchObject({ reusedSpriteCount: 1, newSpriteCount: 0, newSheetCount: 0 });
    expect(second.slots.get('owner-a')).toMatchObject({
      sheetId: first.slots.get('owner-a')?.sheetId,
      index: first.slots.get('owner-a')?.index
    });
  });

  it('does not hide a localized texture edit behind the mean tolerance', () => {
    const original = sprite(40);
    const changed = Buffer.from(original);
    changed[0] = 80;
    expect(sharedIconPixelHash(changed)).not.toBe(sharedIconPixelHash(original));
    expect(sharedIconPixelsEquivalent(original, changed)).toBe(false);
  });

  it('is independent of owner order and uses SHA-sorted new pages', async () => {
    const directory = await mkdtemp('/tmp/gtnh-shared-icons-test-');
    temporaryDirectories.push(directory);
    const atlasPath = await writeAtlas(directory, 'source', new Map([
      [0, sprite(10)],
      [1, sprite(20)],
      [2, sprite(30)]
    ]));
    const first = await buildSharedIcons({
      atlasPath,
      owners: owners(['z-owner', 2], ['a-owner', 0], ['m-owner', 1]),
      outputDirectory: join(directory, 'first-pack')
    });
    const second = await buildSharedIcons({
      atlasPath,
      owners: owners(['m-owner', 1], ['z-owner', 2], ['a-owner', 0]),
      outputDirectory: join(directory, 'second-pack')
    });

    expect(second.assets).toEqual(first.assets.map((asset) => ({
      ...asset,
      url: asset.url
    })));
    expect([...second.slots.entries()]).toEqual([...first.slots.entries()]);
    expect(first.slots.get('a-owner')?.index).toBeLessThan(first.slots.get('m-owner')?.index ?? 0);
    expect(first.slots.get('m-owner')?.index).toBeLessThan(first.slots.get('z-owner')?.index ?? 0);
  });
});
