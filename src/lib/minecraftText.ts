type MinecraftFormatCode =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7'
  | '8' | '9' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
  | 'k' | 'l' | 'm' | 'n' | 'o';

interface MinecraftTextSegment {
  text: string;
  formats: MinecraftFormatCode[];
}

export interface MinecraftTextLine {
  segments: MinecraftTextSegment[];
}

export interface MinecraftText {
  lines: MinecraftTextLine[];
  plainText: string;
}

export type MinecraftFormattingSpan = [start: number, end: number, codes: string];

/** Text is already in bootstrap; lazy details retain only its formatting spans. */
export function minecraftFormattingSpans(html: string | null | undefined): MinecraftFormattingSpan[] {
  const parsed = parseMinecraftHtml(html);
  if (parsed.plainText !== minecraftHtmlPlainText(html)) throw new Error('Tooltip text/formatting mismatch');
  const spans: MinecraftFormattingSpan[] = [];
  let offset = 0;
  for (const line of parsed.lines) {
    for (const segment of line.segments) {
      if (segment.formats.length) spans.push([offset, offset + segment.text.length, segment.formats.join('')]);
      offset += segment.text.length;
    }
    offset++;
  }
  return spans;
}

export function restoreMinecraftFormatting(text: string, spans: readonly MinecraftFormattingSpan[]): MinecraftTextLine[] {
  for (const [start, end, codes] of spans) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
      || end > text.length || !/^[0-9a-fklmno]+$/.test(codes)) throw new Error('Invalid tooltip formatting span');
  }
  let offset = 0;
  return text.split('\n').map((line) => {
    const start = offset;
    const end = start + line.length;
    const relevant = spans.filter(([a, b]) => a < end && b > start);
    const boundaries = [...new Set([start, end, ...relevant.flatMap(([a, b]) => [Math.max(start, a), Math.min(end, b)])])].sort((a, b) => a - b);
    const segments: MinecraftTextSegment[] = [];
    for (let index = 1; index < boundaries.length; index++) {
      const a = boundaries[index - 1]!;
      const b = boundaries[index]!;
      if (a === b) continue;
      const formats = relevant.find(([from, to]) => from <= a && to >= b)?.[2] ?? '';
      segments.push({ text: text.slice(a, b), formats: formats.split('') as MinecraftFormatCode[] });
    }
    offset = end + 1;
    return { segments };
  });
}

const validFormat = /^[0-9a-fklmno]$/;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    const numeric = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
  });
}

export function minecraftHtmlPlainText(html: string | null | undefined): string {
  if (!html) return '';
  let result = '';
  for (const match of html.matchAll(/<[^>]*>|[^<]+/g)) {
    const token = match[0];
    if (!token.startsWith('<')) result += decodeEntities(token);
    else if (/^<br\s*\/?>$/i.test(token)) result += '\n';
  }
  return result.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

function sameFormats(left: MinecraftFormatCode[], right: MinecraftFormatCode[]): boolean {
  return left.length === right.length && left.every((format, index) => format === right[index]);
}

export function plainMinecraftText(text: string): MinecraftText {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => ({
    segments: line ? [{ text: line, formats: [] }] : []
  }));
  return { lines, plainText: text.replace(/\r\n?/g, '\n') };
}

/**
 * Parses only the output grammar of ShadowTheAge's MinecraftTextConverter.
 * Unknown tags and attributes are discarded; returned text is always rendered
 * through normal Svelte text nodes.
 */
export function parseMinecraftHtml(html: string | null | undefined): MinecraftText {
  if (!html) return plainMinecraftText('');
  const lines: MinecraftTextLine[] = [{ segments: [] }];
  let formats: MinecraftFormatCode[] = [];
  const append = (rawText: string) => {
    const parts = decodeEntities(rawText).replace(/\r\n?/g, '\n').split('\n');
    for (const [index, text] of parts.entries()) {
      if (index > 0) lines.push({ segments: [] });
      if (!text) continue;
      const segments = lines[lines.length - 1].segments;
      const previous = segments[segments.length - 1];
      if (previous && sameFormats(previous.formats, formats)) previous.text += text;
      else segments.push({ text, formats: [...formats] });
    }
  };

  for (const match of html.matchAll(/<[^>]*>|[^<]+/g)) {
    const token = match[0];
    if (!token.startsWith('<')) {
      append(token);
      continue;
    }
    if (/^<br\s*\/?>$/i.test(token)) {
      lines.push({ segments: [] });
      formats = [];
      continue;
    }
    if (/^<\/span\s*>$/i.test(token)) {
      formats = [];
      continue;
    }
    const span = token.match(/^<span\s+class=(["'])([^"']*)\1\s*>$/i);
    if (span) {
      formats = span[2]
        .split(/\s+/)
        .map((className) => className.match(/^fmt-([0-9a-fklmno])$/i)?.[1].toLowerCase())
        .filter((code): code is MinecraftFormatCode => code !== undefined && validFormat.test(code));
    }
  }

  while (lines.length > 1 && lines[lines.length - 1].segments.length === 0) lines.pop();
  return {
    lines,
    plainText: lines.map((line) => line.segments.map((segment) => segment.text).join('')).join('\n')
  };
}
