type NumericType = 'b' | 's' | 'i' | 'l' | 'f' | 'd';
type NbtNode = ['compound', Array<[string, NbtNode]>] | ['list', NbtNode[]]
  | ['string', string] | [NumericType, string | number];

/** Vanilla SNBT, preserving long precision and numeric types. */
function parseNbt(source: string): NbtNode {
  let at = 0;
  const whitespace = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  function token(): string {
    whitespace();
    const start = at;
    if (source[at] === '"' || source[at] === "'") {
      const quote = source[at++];
      let value = '';
      while (at < source.length) {
        const char = source[at++];
        if (char === quote) return value;
        if (char !== '\\') { value += char; continue; }
        const escaped = source[at++];
        if (escaped === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(at, at + 4))) {
          value += String.fromCharCode(Number.parseInt(source.slice(at, at + 4), 16)); at += 4;
        } else value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[escaped ?? ''] ?? escaped ?? '';
      }
      throw new Error('Unclosed SNBT string');
    }
    while (at < source.length && !/[\s,:[\]{}]/.test(source[at])) at++;
    if (start === at) throw new Error(`Invalid SNBT at ${at}`);
    return source.slice(start, at);
  }
  function value(): NbtNode {
    whitespace();
    const char = source[at];
    if (char === '{') {
      at++;
      const fields: Array<[string, NbtNode]> = [];
      whitespace();
      while (source[at] !== '}') {
        const key = token(); whitespace();
        if (source[at++] !== ':') throw new Error('Invalid SNBT compound');
        fields.push([key, value()]); whitespace();
        if (source[at] !== ',') break;
        at++;
      }
      if (source[at++] !== '}') throw new Error('Unclosed SNBT compound');
      return ['compound', fields.sort(([a], [b]) => a.localeCompare(b))];
    }
    if (char === '[') {
      at++;
      const elements: NbtNode[] = [];
      whitespace();
      while (source[at] !== ']') {
        // Vanilla 1.7 serializes list elements with explicit integer indices.
        const index = source.slice(at).match(/^\d+\s*:/);
        if (index) at += index[0].length;
        elements.push(value()); whitespace();
        if (source[at] !== ',') break;
        at++;
      }
      if (source[at++] !== ']') throw new Error('Unclosed SNBT list');
      return ['list', elements];
    }
    const quoted = char === '"' || char === "'";
    const raw = token();
    const numeric = !quoted && raw.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([bsldf]?)$/i);
    if (!numeric) return ['string', raw];
    const suffix = (numeric[2].toLowerCase() || 'i') as NumericType;
    return [suffix, suffix === 'l' ? BigInt(numeric[1]).toString() : Number(numeric[1])];
  }
  const result = value(); whitespace();
  if (at !== source.length) throw new Error(`Trailing SNBT at ${at}`);
  return result;
}

/** Canonical semantic identity, independent of compound key order. Optional
 * field defaults are explicit caller policy; raw stack identity omits none. */
export function nbtIdentity(source: string, defaults: readonly { path: readonly string[]; value: string }[] = []): string {
  const root = parseNbt(source);
  for (const { path, value } of defaults) {
    let parent: NbtNode | undefined = root;
    for (const key of path.slice(0, -1)) {
      parent = parent?.[0] === 'compound' ? parent[1].find(([name]) => name === key)?.[1] : undefined;
    }
    if (parent?.[0] !== 'compound') continue;
    const index = parent[1].findIndex(([name, child]) => name === path.at(-1) && JSON.stringify(child) === JSON.stringify(parseNbt(value)));
    if (index >= 0) parent[1].splice(index, 1);
  }
  return JSON.stringify(root);
}

export function formatNbt(source: string): string {
  const format = (node: NbtNode, depth: number): string => {
    const indent = '  '.repeat(depth), childIndent = indent + '  ';
    if (node[0] === 'compound') return node[1].length
      ? `{\n${node[1].map(([key, child]) => `${childIndent}${JSON.stringify(key)}: ${format(child, depth + 1)}`).join(',\n')}\n${indent}}` : '{}';
    if (node[0] === 'list') return node[1].length
      ? `[\n${node[1].map(child => childIndent + format(child, depth + 1)).join(',\n')}\n${indent}]` : '[]';
    if (node[0] === 'string') return JSON.stringify(node[1]);
    return `${node[1]}${node[0] === 'i' ? '' : node[0] === 'l' ? 'L' : node[0]}`;
  };
  return format(parseNbt(source), 0);
}

export function nbtScalar(source: string, path: readonly string[]): string | number | undefined {
  let node: NbtNode | undefined = parseNbt(source);
  for (const key of path) node = node?.[0] === 'compound' ? node[1].find(([name]) => name === key)?.[1] : undefined;
  return node && node[0] !== 'compound' && node[0] !== 'list' ? node[1] : undefined;
}

/** BetterQuesting ItemComparison.CompareNBTTag: compounds require their named
 * fields, lists match unordered entries, and numeric tag widths are compatible.
 * This is intentionally separate from exact exported-stack identity. */
export function questNbtMatches(required: string | undefined, sample: string | undefined, partial: boolean): boolean {
  const empty = (node: NbtNode) => (node[0] === 'compound' || node[0] === 'list') && node[1].length === 0;
  const compare = (left: NbtNode, right: NbtNode): boolean => {
    if (empty(left) || empty(right)) return empty(left) && empty(right);
    if (left[0] === 'compound') {
      if (right[0] !== 'compound') return false;
      return left[1].every(([key, value]) => {
        const actual = right[1].find(([name]) => name === key)?.[1];
        return actual !== undefined && compare(value, actual);
      });
    }
    if (left[0] === 'list') return right[0] === 'list'
      && left[1].length <= right[1].length && (partial || left[1].length === right[1].length)
      && left[1].every(value => right[1].some(actual => compare(value, actual)));
    if (left[0] === 'string') return right[0] === 'string' && left[1] === right[1];
    if (right[0] === 'compound' || right[0] === 'list' || right[0] === 'string') return false;
    return ['f','d'].includes(left[0]) || ['f','d'].includes(right[0])
      ? Number(left[1]) === Number(right[1]) : BigInt(left[1]) === BigInt(right[1]);
  };
  try { return compare(parseNbt(required || '{}'), parseNbt(sample || '{}')); } catch { return false; }
}
