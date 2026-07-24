import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  argumentsMap,
  combinedRevision,
  validateCombinedTooltipSchema,
  withPublishedVersion,
  type VersionsIndex
} from '../tools/data-export/lib';

describe('data export tooling', () => {
  it('parses paired CLI arguments and rejects incomplete input', () => {
    expect(argumentsMap(['--version', '2.9.0-beta-2']).get('version')).toBe('2.9.0-beta-2');
    expect(() => argumentsMap(['--version'])).toThrow(/Invalid argument/);
  });

  it('derives a stable revision from both processed source assets', () => {
    const data = new TextEncoder().encode('data');
    const atlas = new TextEncoder().encode('atlas');

    expect(combinedRevision(data, atlas)).toBe(combinedRevision(data, atlas));
    expect(combinedRevision(data, atlas)).not.toBe(combinedRevision(atlas, data));
    expect(combinedRevision(data, atlas)).toMatch(/^[a-f0-9]{12}$/);
  });

  it('accepts the combined tooltip schema and rejects the ordered-list shape', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gtnh-export-schema-'));
    try {
      const compatible = join(directory, 'compatible.script');
      await writeFile(
        compatible,
        [
          'CREATE MEMORY TABLE PUBLIC.ITEM(ID VARCHAR,TOOLTIP VARCHAR)',
          "INSERT INTO METADATA_ACTIVE_PLUGINS VALUES(0,'THAUMCRAFT')"
        ].join('\n'),
        'utf8'
      );
      await expect(validateCombinedTooltipSchema(compatible, ['THAUMCRAFT'])).resolves.toBeUndefined();

      const incompatible = join(directory, 'incompatible.script');
      await writeFile(
        incompatible,
        [
          'CREATE MEMORY TABLE PUBLIC.ITEM(ID VARCHAR)',
          'CREATE MEMORY TABLE PUBLIC.ITEM_TOOLTIP(ITEM_ID VARCHAR,TOOLTIP VARCHAR)'
        ].join('\n'),
        'utf8'
      );
      await expect(validateCombinedTooltipSchema(incompatible)).rejects.toThrow(
        /compatibility patch was not applied/
      );

      await expect(validateCombinedTooltipSchema(compatible, ['QUEST'])).rejects.toThrow(
        /missing required active plugins: QUEST/
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains the final gameplay tooltip line in the browser processor policy', async () => {
    const patch = await readFile(
      join(process.cwd(), 'tools/data-export/patches/browser-catalog-policy.patch'),
      'utf8'
    );

    expect(patch).toContain('for (var i = 1; i < parts.Length; i++)');
    expect(patch).toContain('cleanedPart.Equals("shift"');
    expect(patch).toContain('final line frequently contains real');
  });

  it('handles dangling quest prerequisites without pinning an individual quest ID', async () => {
    const patch = await readFile(
      join(process.cwd(), 'tools/data-export/patches/combined-tooltips.patch'),
      'utf8'
    );

    expect(patch).toContain('Skipping missing required quest {} referenced by quest {}');
    expect(patch).toContain('findQuestOrNull(requiredQuestId)');
    expect(patch).toContain('com.github.GTNewHorizons:AspectRecipeIndex:');
    expect(patch).toContain('THAUMCRAFT_NEI("aspectrecipeindex")');
    expect(patch).not.toMatch(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i);
  });

  it('supports both upstream aspect icon providers without pinning an item ID', async () => {
    const patch = await readFile(
      join(process.cwd(), 'tools/data-export/patches/processor-2.9.patch'),
      'utf8'
    );

    expect(patch).toContain('x.mod == "thaumcraftneiplugin"');
    expect(patch).toContain('x.mod == "aspectrecipeindex"');
    expect(patch).toContain('x.internalName == "aspect"');
    expect(patch).toContain('items.TryGetValue(aspectModel.IconId');
    expect(patch).toContain('aspectIcon.touched = true');
    expect(patch).toContain('dbParser = null');
    expect(patch).toContain('GC.WaitForPendingFinalizers()');
    expect(patch).toContain('Managed heap before recipe remaps');
    expect(patch).toContain('Indexed {indexedRecipeCount} current recipes');
    expect(patch).toContain('Matched {matchedRecipeCount} historical recipes');
    expect(patch).toContain('+                var idFrom = ReadString(dataBin, intBuffer, remap)');
    expect(patch).toContain('-                var idFrom = ReadString(dataBin, intBuffer, intBuffer[remap])');
    expect(patch).not.toMatch(/\bi:[A-Za-z0-9:_-]+/);
  });

  it('retains recipe-connected browser items without editing the upstream banlist', async () => {
    const patch = await readFile(
      join(process.cwd(), 'tools/data-export/patches/browser-catalog-policy.patch'),
      'utf8'
    );

    expect(patch).toContain('BrowserCatalogPolicy.RetainRecipeConnectedItems');
    expect(patch).toContain('return false;');
    expect(patch).toContain("PackConverter's existing touched-item pass");
    expect(patch).toContain('i >> IconAtlas.DimensionBits');
    expect(patch).not.toContain('+                    var positionY = ((i & IconAtlas.YMask)');
    expect(patch).not.toMatch(/\bi:[A-Za-z0-9:_-]+/);
  });

  it('bounds processor GC heap growth during full recipe remapping', async () => {
    const processSource = await readFile(
      join(process.cwd(), 'tools/data-export/process.ts'),
      'utf8'
    );

    expect(processSource).toContain("DOTNET_GCHeapHardLimitPercent: '0x32'");
    expect(processSource).toContain('...process.env');
    expect(processSource).toContain("args.get('resume-processed') === 'true'");
  });

  it('publishes a new default without removing historical datasets', () => {
    const existing: VersionsIndex = {
      schemaVersion: 1,
      generatedAt: 'old',
      versions: [{
        datasetId: '2.8.0-r1',
        gtnhVersion: '2.8.0',
        revision: '1',
        publishedAt: 'old',
        packManifestUrl: './data/2.8.0-r1/pack-manifest.json',
        catalogBytes: 10,
        offlineBytes: 20
      }]
    };
    const latest = {
      datasetId: '2.9.0-beta-2-r2',
      gtnhVersion: '2.9.0-beta-2',
      revision: '2',
      publishedAt: 'now',
      packManifestUrl: './data/2.9.0-beta-2-r2/pack-manifest.json',
      catalogBytes: 30,
      offlineBytes: 40
    };

    expect(withPublishedVersion(existing, latest, 'now').versions.map((entry) => entry.datasetId))
      .toEqual(['2.9.0-beta-2-r2', '2.8.0-r1']);
  });

  it('replaces an existing immutable identity instead of duplicating the index entry', () => {
    const existing: VersionsIndex = {
      schemaVersion: 1,
      generatedAt: 'old',
      versions: [{
        datasetId: 'same',
        gtnhVersion: 'old',
        revision: 'old',
        publishedAt: 'old',
        packManifestUrl: 'old',
        catalogBytes: 1,
        offlineBytes: 1
      }]
    };
    const replacement = {
      ...existing.versions[0]!,
      gtnhVersion: 'new',
      publishedAt: 'now'
    };

    expect(withPublishedVersion(existing, replacement, 'now').versions).toEqual([replacement]);
  });
});
