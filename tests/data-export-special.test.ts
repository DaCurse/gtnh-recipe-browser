import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  SPECIAL_CATEGORY_IDS,
  SpecialDataError,
  canonicalizeSpecialData,
  readSpecialSidecar,
  serializeSpecialData,
  specialDataSha256,
  specialGoodsIds,
  validateCropsNhSeedReferences,
  type SpecialData
} from '../tools/data-export/special';

const fixturePath = 'tests/fixtures/nei-special-v1/browser-nei-special.json';

async function fixture(): Promise<SpecialData> {
  return readSpecialSidecar(fixturePath, { requireNonEmptyCategories: true });
}

type JsonFixture = null | string | boolean | number | JsonFixture[] | { [key: string]: JsonFixture };

function quoteJavaJson(value: string): string {
  let output = '"';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '"') output += '\\"';
    else if (character === '\\') output += '\\\\';
    else if (character === '\n') output += '\\n';
    else if (character === '\r') output += '\\r';
    else if (character === '\t') output += '\\t';
    else if (character.charCodeAt(0) < 0x20) {
      output += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    } else output += character;
  }
  return `${output}"`;
}

function legacyJavaJson(value: JsonFixture): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quoteJavaJson(value);
  if (typeof value === 'boolean' || typeof value === 'number') return value.toString();
  if (Array.isArray(value)) return `[${value.map((entry) => legacyJavaJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${quoteJavaJson(key)}:${legacyJavaJson(value[key]!)}`).join(',')}}`;
}

function streamedJavaJson(value: JsonFixture): string {
  const chunks: string[] = [];
  const append = (entry: JsonFixture): void => {
    if (entry === null) { chunks.push('null'); return; }
    if (typeof entry === 'string') { chunks.push(quoteJavaJson(entry)); return; }
    if (typeof entry === 'boolean' || typeof entry === 'number') { chunks.push(entry.toString()); return; }
    if (Array.isArray(entry)) {
      chunks.push('[');
      entry.forEach((child, index) => { if (index > 0) chunks.push(','); append(child); });
      chunks.push(']');
      return;
    }
    chunks.push('{');
    Object.keys(entry).sort().forEach((key, index) => {
      if (index > 0) chunks.push(',');
      chunks.push(quoteJavaJson(key), ':');
      append(entry[key]!);
    });
    chunks.push('}');
  };
  append(value);
  chunks.push('\n');
  return chunks.join('');
}

describe('NEI special sidecar contract', () => {
  it('accepts every requested category and preserves rich payloads', async () => {
    const data = await fixture();
    expect(data.categories).toEqual([...SPECIAL_CATEGORY_IDS]);
    expect(new Set(data.records.map((record) => record.category))).toEqual(new Set(SPECIAL_CATEGORY_IDS));
    expect(data.records.find((record) => record.category === 'meteor-ritual')?.payload).toMatchObject({
      lpCost: 50000,
      radius: 3,
      reagents: [{ goodsId: 'i:BloodMagic:slate:0', amount: 1, effect: 'stabilize' }]
    });
    expect(data.records.find((record) => record.category === 'gt-ore-processing')?.payload).toMatchObject({
      edges: expect.arrayContaining([
        expect.objectContaining({ machine: 'chemical-bath' }),
        expect.objectContaining({ machine: 'sifting' })
      ])
    });
    expect(data.serviceIcons.every((icon) => icon.searchable === false)).toBe(true);
  });

  it('canonicalizes record order, aliases, object keys, and reference arrays', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const records = source.records as Array<Record<string, unknown>>;
    source.records = [...records].reverse().map((record) => ({
      ...record,
      category: record.category === 'crop-outputs' ? 'crop-output' : record.category,
      goodsIds: [...(record.goodsIds as string[])].reverse()
    }));
    const first = canonicalizeSpecialData(source);
    const second = canonicalizeSpecialData(JSON.parse(serializeSpecialData(source)) as unknown);
    expect(serializeSpecialData(first)).toBe(serializeSpecialData(second));
    expect(first.records.map((record) => record.id)).toEqual([
      'crop:blazereed',
      'pool:nether-stars',
      'breeding:blazereed',
      'vein:deep-iron',
      'small-ore:certus',
      'meteor:iron-focus',
      'lootbag:common',
      'vending:steel-for-coins',
      'worldgen:forge-chest',
      'ore-processing:iron'
    ]);
    expect(first.records[0]?.goodsIds).toEqual(['i:gregtech:gt.metaitem.01:2816']);
  });

  it('rejects missing categories, unresolved goods, lookups, and service icons', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const records = source.records as Array<Record<string, unknown>>;
    source.categories = (source.categories as string[]).filter((category) => category !== 'lootbags');
    expect(() => canonicalizeSpecialData(source)).toThrow(new SpecialDataError('missing requested category loot-bag'));

    source.categories = [...(source.categories as string[]), 'lootbags'];
    records[0]!.goodsIds = ['i:missing:item:0'];
    expect(() => canonicalizeSpecialData(source, { knownGoodsIds: new Set(['i:gregtech:gt.metaitem.01:2816']) }))
      .toThrow(/unresolved goods ID i:missing:item:0/);

    records[0]!.goodsIds = ['i:gregtech:gt.metaitem.01:2816'];
    records[0]!.recipesLookupId = 'special:missing';
    expect(() => canonicalizeSpecialData(source, {
      knownRecipeLookupIds: new Set(['special:crop:blazereed:recipes'])
    })).toThrow(/unresolved Recipes lookup special:missing/);

    records[0]!.recipesLookupId = 'special:crop:blazereed:recipes';
    records[0]!.serviceIconId = 'service:missing';
    expect(() => canonicalizeSpecialData(source)).toThrow(/references unknown icon service:missing/);
  });

  it('rejects duplicate IDs and invalid service-only search state', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const records = source.records as Array<Record<string, unknown>>;
    source.records = [...records, { ...records[0] }];
    expect(() => canonicalizeSpecialData(source)).toThrow(/duplicate special record ID crop:blazereed/);

    source.records = records;
    const icons = source.serviceIcons as Array<Record<string, unknown>>;
    icons[0]!.searchable = true;
    expect(() => canonicalizeSpecialData(source)).toThrow(/searchable must be false/);
  });

  it('rejects empty ore-dictionary references before pack processing', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const records = source.records as Array<Record<string, unknown>>;
    const vending = records.find((record) => record.category === 'vending-trades')!;
    const payload = vending.payload as Record<string, unknown>;
    const inputs = payload.inputs as Array<Record<string, unknown>>;
    inputs[0]!.oreDictionary = '';
    expect(() => canonicalizeSpecialData(source)).toThrow(/oreDictionary must be a non-empty string/);
  });

  it('rejects raw NESQL keys instead of accepting them as browser goods IDs', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const records = source.records as Array<Record<string, unknown>>;
    records[0]!.goodsIds = ['i~gregtech~gt.metaitem.01~2816'];
    expect(() => canonicalizeSpecialData(source)).toThrow(
      /invalid canonical goods ID i~gregtech~gt\.metaitem\.01~2816/
    );

    records[0]!.goodsIds = ['f:cropsnh:cropsnh:jagi'];
    expect(() => canonicalizeSpecialData(source)).not.toThrow();
  });

  it('normalizes runtime ore-dictionary IDs to the browser catalog identity', async () => {
    const source = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const records = source.records as Array<Record<string, unknown>>;
    records[0]!.goodsIds = [...(records[0]!.goodsIds as string[]), 'od~oreIron'];
    const payload = records[0]!.payload as Record<string, unknown>;
    payload.outputs = [{ goodsId: 'od~dustIron', weight: 1 }];

    const data = canonicalizeSpecialData(source);
    expect(data.records[0]!.goodsIds).toContain('o:oreIron');
    expect(data.records[0]!.payload.outputs).toEqual([
      { goodsId: 'o:dustIron', weight: 1 }
    ]);
    expect(specialGoodsIds(data)).not.toContain('od~oreIron');
  });

  it('retains nested goods references and produces a stable sidecar hash', async () => {
    const data = await fixture();
    const goods = specialGoodsIds(data);
    expect(goods).toContain('i:BloodMagic:slate:0');
    expect(goods).toContain('f:gregtech:hydrogen');
    expect(specialDataSha256(data)).toBe(specialDataSha256(JSON.parse(serializeSpecialData(data))));
    expect(serializeSpecialData(data)).toMatch(/\n$/);
  });

  it('audits CropsNH lookup goods across outputs, pools, and breeding records', async () => {
    const data = await fixture();
    const seed = 'i:cropsnh:genericSeed:0:0000000000000000000000000000000000000000';
    for (const record of data.records) {
      if (['crop-output', 'mutation-pool', 'crop-breeding'].includes(record.category)) {
        record.goodsIds.push(seed);
      }
    }
    expect(() => validateCropsNhSeedReferences(data)).not.toThrow();

    const missing = data.records.find((record) => record.category === 'crop-output')!;
    missing.goodsIds = missing.goodsIds.filter((goodsId) => goodsId !== seed);
    expect(() => validateCropsNhSeedReferences(data)).toThrow(
      /CropsNH records are missing DEFAULT_ANALYZED generic-seed goods IDs: crop:blazereed/
    );
  });

  it('keeps the maintained overlay outside both read-only upstream submodules', async () => {
    const patch = await readFile('tools/data-export/patches/nei-special-overlay.patch', 'utf8');
    expect(patch).toContain('NeiSpecialOverlay.export(repositoryDirectory, exporterState, activePlugins)');
    expect(patch).toContain('No NEI special-data adapters installed');
    expect(patch).toContain('requireId(searchText, "record search text")');
    expect(patch).toContain('record.put("searchText", searchText)');
    expect(patch).toContain('return browserItemId(item)');
    expect(patch).toContain('MessageDigest.getInstance("SHA-1")');
    expect(patch).toContain('return "f:" + fluid.getModId()');
    expect(patch).toContain('CropsNH", "2.0.91"');
    expect(patch).toContain('GT5-Unofficial", "5.09.54.20"');
    expect(patch).toContain('BloodMagic", "1.9.4"');
    expect(patch).toContain('EnhancedLootBags", "1.3.4"');
    expect(patch).toContain('VendingMachine", "0.4.95"');
    expect(patch).toContain('NEICustomDiagram", "1.8.30"');
    expect(patch).toContain('RoguelikeDungeons", "1.6.6-GTNH"');
    expect(patch).toContain('TwilightForest", "2.7.36"');
    expect(patch).not.toContain('nesql-exporter@ShadowTheAge/');
    const prepare = await readFile('tools/data-export/prepare.ts', 'utf8');
    expect(prepare).toContain('nei-special-overlay.patch');
    expect(prepare).toContain('specialOverlayPatchSha256');
  });

  it('pins and wires the maintained runtime adapter for every special category', async () => {
    const adapter = await readFile('tools/data-export/overlay/RuntimeSpecialAdapter.java', 'utf8');
    for (const category of SPECIAL_CATEGORY_IDS) {
      expect(adapter).toContain(`category(sink, "${category}"`);
    }
    expect(adapter).toContain('getIndexedModList');
    expect(adapter).toContain('pin.getValue().equals(display)');
    expect(adapter).toContain('implements NeiSpecialOverlay.Adapter');
    expect(adapter).toContain('searchText("gregtech", "gt-ore-processing"');
    expect(adapter).toContain('detectPrefix');
    expect(adapter).toContain('getTotalListWeight');
    expect(adapter).toContain('estimatedMeteorAmounts');
    expect(adapter).toContain('dimensionOverrides');
    expect(adapter).toContain('dimensionDisplayGoods');
    expect(adapter).toContain('getDimAbbreviatedName');
    expect(adapter).toContain('oreVeinToProbabilityInDimension');
    expect(adapter).toContain('retainMaterialOreDictionary');
    expect(adapter).toContain('getSeedItem');
    expect(adapter).toContain('SeedStats", "DEFAULT_ANALYZED"');
    expect(adapter).toContain('StatCollector.translateToLocal');
    expect(adapter).toContain('payload.put("poolId", poolId)');
    expect(adapter).toContain('getSoilsForNEI", true');
    expect(adapter).toContain('getBlocksUnderForNEI", true');
    expect(adapter).toContain('returned no DEFAULT_ANALYZED seed item');
    expect(adapter).toContain('SmallOreDrops');
    expect(adapter).toContain('recipeChance');
    expect(adapter).toContain('machineLabel');
    expect(adapter).toContain('GameRegistry.findUniqueIdentifierFor');
    expect(adapter).toContain('GameRegistry.findUniqueIdentifierFor failed for registry name');
    expect(adapter).toContain('Skipping unresolvable ItemStack');
    expect(adapter).toContain('if (inputGoods == null || outputGoods == null) return;');
    expect(adapter).toContain('recipeStacks');
    expect(adapter).toContain('hasCompactSlots');
    expect(adapter).toContain('stableTagName');
    expect(adapter).toContain('stableTagValue');
    expect(adapter).toContain('materialPart');
    expect(adapter).toContain('provenanceByKey');
    expect(adapter).toContain('rootCandidates');
    expect(adapter).toContain('outputBelongsTo');
    expect(adapter).toContain('MAX_ORE_GRAPH_EDGES');
    expect(adapter).toContain('GT ore provenance closure recipes=');
    expect(adapter).toContain('if (!oreDictionary.isEmpty()) payload.put("oreDictionary", oreDictionary);');
    expect(adapter).not.toContain('materialByKey');

    const overlay = await readFile('tools/data-export/patches/nei-special-overlay.patch', 'utf8');
    expect(overlay).toContain('serviceIcon.put("goodsId", references.get(0))');

    const prepare = await readFile('tools/data-export/prepare.ts', 'utf8');
    expect(prepare).toContain('extractPinnedRuntimeJars');
    expect(prepare).toContain('export-automation.patch');
    expect(prepare).toContain('NeiSpecialOverlay$Adapter');
    expect(prepare).toContain('exportAutomationPatchSha256');
  });

  it('keeps the maintained Java overlay hunk length synchronized', async () => {
    const patch = await readFile('tools/data-export/patches/nei-special-overlay.patch', 'utf8');
    const start = patch.indexOf('diff --git a/src/main/java/com/github/dcysteine/nesql/exporter/special/NeiSpecialOverlay.java');
    expect(start).toBeGreaterThanOrEqual(0);
    const sourcePatch = patch.slice(start);
    const header = sourcePatch.match(/^@@ -0,0 \+1,(\d+) @@$/m);
    expect(header).not.toBeNull();
    const addedLines = sourcePatch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    expect(addedLines).toHaveLength(Number(header?.[1]));
    expect(addedLines.at(-1)).toBe('+}');
  });

  it('emits the nested sourceVersions object required by the sidecar validator', async () => {
    const patch = await readFile('tools/data-export/patches/nei-special-overlay.patch', 'utf8');
    const javaSource = patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n');
    expect(javaSource).toContain('Map<String, Object> SOURCE_VERSIONS');
    expect(javaSource).toContain('versions.put("gtnhVersion", "2.9.0-beta-2")');
    expect(javaSource).toContain('versions.put("exporter", exporter)');
    expect(javaSource).toContain('versions.put("overlay", overlay)');
    expect(javaSource).toContain('versions.put("mods", mods)');
    expect(javaSource).toContain('exporter.put("repository", "https://github.com/ShadowTheAge/nesql-exporter")');
    expect(javaSource).toContain('exporter.put("commit", "b9279b39f2f439da78eebd70fab272b028947371")');
    expect(javaSource).not.toContain('versions.put("gtnh",');
    expect(javaSource).not.toContain('versions.put("overlay", "nei-special-v1")');
  });

  it('keeps streamed overlay JSON byte-equivalent and atomically replaces the sidecar', async () => {
    const sample: JsonFixture = {
      z: 'quote" slash\\ line\n tab\t control\u0001',
      array: [null, true, 2.5, { b: 'é', a: 'first' }],
      a: 'first'
    };
    const legacy = `${legacyJavaJson(sample)}\n`;
    const streamed = streamedJavaJson(sample);
    expect(streamed).toBe(legacy);
    expect(streamed).toMatch(/^\{"a":"first","array":/);
    expect(streamed).toContain('quote\\" slash\\\\ line\\n tab\\t control\\u0001');

    const patch = await readFile('tools/data-export/patches/nei-special-overlay.patch', 'utf8');
    const javaSource = patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n');
    expect(javaSource).toContain('static void write(Writer output, Object value) throws IOException');
    expect(javaSource).toContain('Json.write(writer, root)');
    expect(javaSource).not.toContain('Json.encode(root)');
    expect(javaSource).not.toContain('new StringBuilder()');
    expect(javaSource).toContain('Files.newBufferedWriter');
    expect(javaSource).toContain('Files.createTempFile');
    expect(javaSource).toContain('StandardCopyOption.ATOMIC_MOVE');
    expect(javaSource).toContain('Files.deleteIfExists(temporary)');
  });

  it('requires the sidecar for special exports and preserves the GT-tool sanity predicate', async () => {
    const process = await readFile('tools/data-export/process.ts', 'utf8');
    expect(process).toContain('NESQL export is missing ${sidecarPath}');
    expect(process).toContain("await access(sidecarPath)");
    expect(process).not.toContain('allow-missing-special');
    expect(process).toContain("item.mod.toLowerCase() === 'gregtech'");
    expect(process).toContain('validateCropsNhSeedReferences(specialData)');
    expect(process).not.toContain('filter((item) => (item) =>');
  });

  it('fails preparation before archive or client mutation when the live provider is absent', async () => {
    const prepare = await readFile('tools/data-export/prepare.ts', 'utf8');
    const providerCheck = prepare.indexOf('const specialProviderSource = join(');
    const archiveStat = prepare.indexOf('const archiveStat = await stat(archivePath);');
    const instanceMutation = prepare.indexOf('await mkdir(workDirectory, { recursive: true });');
    expect(providerCheck).toBeGreaterThan(-1);
    expect(providerCheck).toBeLessThan(archiveStat);
    expect(providerCheck).toBeLessThan(instanceMutation);
    expect(prepare).toContain('the maintained live NEI special-data provider is missing');
    expect(prepare).toContain('refusing to create a guaranteed-broken instance');
    expect(prepare).toContain('implements NeiSpecialOverlay.Adapter');
  });

  it('builds the disposable exporter without leaving a Gradle daemon behind', async () => {
    const prepare = await readFile('tools/data-export/prepare.ts', 'utf8');
    expect(prepare).toContain("run('bash', ['./gradlew', '--no-daemon', 'build'], patchedExporter);");
  });

  it('retains sidecar item/fluid and ore-dictionary references before projection', async () => {
    const retention = await readFile('tools/data-export/patches/SpecialRetention.cs', 'utf8');
    expect(retention).toContain('item.touched = true');
    expect(retention).toContain('candidate.oreDictNames.Contains(name)');
    expect(retention).toContain('references unknown item');
    const patch = await readFile('tools/data-export/patches/special-retention.patch', 'utf8');
    expect(patch).toContain('SpecialRetention.Mark(generator.DatabasePath, items, fluids)');
    expect(patch).toContain('SpecialRetention.MarkOreDictionaries(generator.DatabasePath, igroups)');
  });
});
