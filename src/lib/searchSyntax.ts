type SearchField = 'any' | 'mod' | 'tooltip' | 'ore' | 'identifier';
interface SearchTerm {
  field: SearchField;
  negated: boolean;
  value: string;
  pattern: string;
}
interface SearchSpan { text: string; format: string }
export interface SearchExpression {
  clauses: SearchTerm[][];
  spans: SearchSpan[];
  needsOreDictionary: boolean;
}

// GTNH NEI ItemInfo.addSearchProviders / SearchTextFormatter. See docs/search.md.
const providers: Record<string, { field: SearchField; format: string }> = {
  '@': { field: 'mod', format: 'd' },
  '#': { field: 'tooltip', format: 'e' },
  '$': { field: 'ore', format: 'b' },
  '&': { field: 'identifier', format: '6' }
};

/** One lexer supplies both matching and lossless input highlighting. */
export function parseSearchExpression(source: string): SearchExpression {
  const clauses: SearchTerm[][] = [[]];
  const spans: SearchSpan[] = [];
  let index = 0;
  let needsOreDictionary = false;
  const append = (text: string, format = '') => {
    if (!text) return;
    const last = spans.at(-1);
    if (last?.format === format) last.text += text;
    else spans.push({ text, format });
  };
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) { append(character); index++; continue; }
    if (character === '|') { append(character, '7'); clauses.push([]); index++; continue; }
    let negated = false;
    if (character === '!' || character === '-') {
      negated = true;
      append(character, '9');
      index++;
    }
    const provider = providers[source[index] ?? ''];
    const field = provider?.field ?? 'any';
    const format = provider?.format ?? '';
    if (provider) { append(source[index]!, format); index++; }
    let value = '';
    let quoted = false;
    while (index < source.length) {
      const next = source[index]!;
      if (!quoted && (next === '|' || /\s/.test(next))) break;
      if (next === '\\' && source[index + 1] === '"') {
        append(source.slice(index, index + 2), format);
        value += '"';
        index += 2;
      } else if (next === '"') {
        quoted = !quoted;
        append(next, '6');
        index++;
      } else {
        append(next, format);
        value += next;
        index++;
      }
    }
    // An unfinished positive prefix matches nothing; an empty exclusion is ignored.
    if (value || (provider && !negated)) {
      clauses.at(-1)!.push({ field, negated, value, pattern: normalizePattern(value) });
      if (field === 'ore') needsOreDictionary = true;
    }
  }
  return { clauses: clauses.filter(clause => clause.length > 0), spans, needsOreDictionary };
}

function normalizePattern(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9@:+.*?-]+/g, ' ').trim();
}

/** NEI extended mode: ? consumes one character, * consumes one or more.
 * Dynamic programming avoids executing user-provided regular expressions. */
function patternMatches(text: string, pattern: string): boolean {
  if (!pattern) return false;
  if (!/[?*]/.test(pattern)) return text.includes(pattern);
  let previous = new Uint8Array(pattern.length + 1);
  previous[0] = 1;
  for (const character of text) {
    const next = new Uint8Array(pattern.length + 1);
    next[0] = 1; // Search anywhere within the field, like Pattern.find().
    for (let index = 1; index <= pattern.length; index++) {
      const token = pattern[index - 1]!;
      next[index] = token === '*'
        ? (previous[index - 1]! | previous[index]!)
        : token === '?' || token === character ? previous[index - 1]! : 0;
    }
    if (next[pattern.length]) return true;
    previous = next;
  }
  return false;
}

export function searchExpressionMatches(
  expression: Pick<SearchExpression, 'clauses'>,
  fields: Record<SearchField, readonly string[]>
): boolean {
  return expression.clauses.length === 0 || expression.clauses.some(clause => clause.every(term => {
    const matches = fields[term.field].some(text => patternMatches(text, term.pattern));
    return term.negated ? !matches : matches;
  }));
}
