import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { serializeSpecialData, type SpecialData } from './special';

/** A source-row identity and the browser ID generated from that row. */
export interface CanonicalGoodsId {
  rawId: string;
  canonicalId: string;
  kind: 'item' | 'fluid';
}

interface GoodsIdMapResult {
  mappings: Map<string, CanonicalGoodsId>;
  itemRows: number;
  fluidRows: number;
  requestedRows: number;
}

export interface SpecialRecoveryResult {
  data: SpecialData;
  referencedRawIds: string[];
  replacedIds: string[];
  unresolvedRawIds: string[];
}

/**
 * The HSQL script uses SQL string literals, with doubled single quotes and
 * Java-style unicode escapes for control characters.  NESQL writes one INSERT
 * statement per line, but this parser still tracks quote state so commas and
 * parentheses in NBT/tooltips cannot change column boundaries.
 */
export function parseHsqlValues(line: string): string[] | undefined {
  const marker = 'VALUES(';
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const valuesStart = markerIndex + marker.length;
  let valuesEnd = line.length;
  while (valuesEnd > valuesStart && /\s/.test(line[valuesEnd - 1]!)) valuesEnd--;
  if (line[valuesEnd - 1] !== ')') return undefined;

  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = valuesStart; index < valuesEnd - 1; index++) {
    const character = line[index]!;
    if (quoted) {
      if (character === "'") {
        if (line[index + 1] === "'") {
          current += "'";
          index++;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === "'") {
      quoted = true;
    } else if (character === ',') {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  if (quoted) throw new Error(`Unterminated SQL string in ${line.slice(0, 80)}`);
  return values;
}

/** Decode the escape form emitted by HSQLDB's script writer. */
export function decodeHsqlString(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16)));
}

export function canonicalItemId(
  modId: string,
  internalName: string,
  itemDamage: number,
  nbt: string
): string {
  const base = `i:${modId}:${internalName}:${itemDamage}`;
  if (!nbt) return base;
  return `${base}:${createHash('sha1').update(nbt, 'utf8').digest('hex')}`;
}

export function canonicalFluidId(modId: string, internalName: string): string {
  return `f:${modId}:${internalName}`;
}

function integerColumn(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${context} is not an integer: ${value}`);
  return parsed;
}

function addMapping(
  mappings: Map<string, CanonicalGoodsId>,
  mapping: CanonicalGoodsId
): void {
  const previous = mappings.get(mapping.rawId);
  if (previous && previous.canonicalId !== mapping.canonicalId) {
    throw new Error(
      `HSQL script maps ${mapping.rawId} to both ${previous.canonicalId} and ${mapping.canonicalId}`
    );
  }
  mappings.set(mapping.rawId, mapping);
}

/**
 * Read only the ITEM and FLUID rows needed by a sidecar.  Keeping this pass
 * streaming is intentional: a real 2.9 export's script is hundreds of MB and
 * must not be duplicated in memory just to recover the already-exported JSON.
 */
async function readCanonicalGoodsIds(
  scriptPath: string,
  requestedIds?: ReadonlySet<string>
): Promise<GoodsIdMapResult> {
  const mappings = new Map<string, CanonicalGoodsId>();
  const lines = createInterface({
    input: createReadStream(scriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  let itemRows = 0;
  let fluidRows = 0;
  for await (const line of lines) {
    const table = line.startsWith('INSERT INTO ITEM VALUES(')
      ? 'item'
      : line.startsWith('INSERT INTO FLUID VALUES(')
        ? 'fluid'
        : undefined;
    if (!table) continue;
    const values = parseHsqlValues(line);
    if (!values) throw new Error(`Unable to parse ${table} row: ${line.slice(0, 120)}`);
    if (table === 'item') {
      itemRows++;
      if (values.length !== 12) throw new Error(`Expected 12 ITEM columns, received ${values.length}`);
      const rawId = values[0]!;
      if (requestedIds && !requestedIds.has(rawId)) continue;
      const modId = decodeHsqlString(values[8]!);
      const internalName = decodeHsqlString(values[2]!);
      const itemDamage = integerColumn(values[3]!, `ITEM ${rawId} damage`);
      const nbt = decodeHsqlString(values[9]!);
      addMapping(mappings, {
        rawId,
        canonicalId: canonicalItemId(modId, internalName, itemDamage, nbt),
        kind: 'item'
      });
    } else {
      fluidRows++;
      if (values.length !== 13) throw new Error(`Expected 13 FLUID columns, received ${values.length}`);
      const rawId = values[0]!;
      if (requestedIds && !requestedIds.has(rawId)) continue;
      addMapping(mappings, {
        rawId,
        canonicalId: canonicalFluidId(
          decodeHsqlString(values[8]!),
          decodeHsqlString(values[5]!)
        ),
        kind: 'fluid'
      });
    }
  }
  lines.close();
  return {
    mappings,
    itemRows,
    fluidRows,
    requestedRows: requestedIds?.size ?? mappings.size
  };
}

function collectRawIds(value: unknown, result: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('i~') || value.startsWith('f~')) result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRawIds(entry, result));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectRawIds(entry, result));
  }
}

function replaceRawIds(value: unknown, mappings: ReadonlyMap<string, CanonicalGoodsId>): unknown {
  if (typeof value === 'string') return mappings.get(value)?.canonicalId ?? value;
  if (Array.isArray(value)) return value.map((entry) => replaceRawIds(entry, mappings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceRawIds(child, mappings)])
    );
  }
  return value;
}

/** Replace raw NESQL IDs everywhere in a special sidecar and validate it. */
export function recoverSpecialGoodsIds(
  raw: unknown,
  mappings: ReadonlyMap<string, CanonicalGoodsId>
): SpecialRecoveryResult {
  const referenced = new Set<string>();
  collectRawIds(raw, referenced);
  const unresolvedRawIds = [...referenced].filter((id) => !mappings.has(id)).sort();
  if (unresolvedRawIds.length > 0) {
    throw new Error(
      `HSQL script has no row for ${unresolvedRawIds.length} raw special goods IDs: `
      + unresolvedRawIds.slice(0, 10).join(', ')
    );
  }
  const recovered = replaceRawIds(raw, mappings);
  const data = JSON.parse(serializeSpecialData(recovered)) as SpecialData;
  return {
    data,
    referencedRawIds: [...referenced].sort(),
    replacedIds: [...referenced].sort(),
    unresolvedRawIds
  };
}

export async function recoverSpecialSidecar(
  sidecarPath: string,
  scriptPath: string
): Promise<SpecialRecoveryResult> {
  const raw = JSON.parse(await readFile(sidecarPath, 'utf8')) as unknown;
  const requestedIds = new Set<string>();
  collectRawIds(raw, requestedIds);
  const { mappings } = await readCanonicalGoodsIds(scriptPath, requestedIds);
  return recoverSpecialGoodsIds(raw, mappings);
}
