import { parseMinecraftCodes } from '../minecraftText';
import { questLinkId } from './types';

export interface QuestTextRun {
  text: string;
  codes: string;
  link?: { type: 'url' | 'quest'; target: string };
  image?: { resource: string; height: number };
}
const formatting: Record<string, string> = {
  note: '§b',
  warn: '§c',
  quest: '§a§n',
  bold: '§l',
  italic: '§o',
  underline: '§n',
  strikethrough: '§m',
  obfuscated: '§k',
  url: '§9§n',
  questlink: '§9§n',
};

/** BQ FormattingTag/PanelTextBox grammar. Unknown tags remain literal text. */
export function questText(
  source: string,
  questName?: (id: string) => string | undefined,
): QuestTextRun[] {
  const output: QuestTextRun[] = [];
  const stack: { name: string; codes: string }[] = [];
  const append = (text: string, link?: QuestTextRun['link']) => {
    if (text) output.push({ text, codes: stack.map((tag) => tag.codes).join(''), link });
  };
  const tokens =
    /\[img height=([1-9]\d*)\]([\s\S]*?)\[\/img\]|\[(url|questlink)(?: link=([^\] ]+))?\]([\s\S]*?)\[\/\3\]|\[(\/?)([a-z]+)\]/gi;
  let last = 0;
  for (const match of source.matchAll(tokens)) {
    append(source.slice(last, match.index));
    last = match.index! + match[0].length;
    if (match[1]) {
      output.push({
        text: '',
        codes: '',
        image: { resource: match[2].trim(), height: Math.min(1200, Number(match[1])) },
      });
    } else if (match[3]) {
      const type = match[3].toLowerCase();
      const content = match[5];
      const plain = parseMinecraftCodes(content).plainText;
      let target: string | undefined,
        label = content;
      if (type === 'url') {
        try {
          const url = new URL(match[4] ?? plain);
          if (url.protocol === 'http:' || url.protocol === 'https:') target = url.href;
        } catch {
          /* Inert invalid link. */
        }
      } else {
        const [id, ...name] = plain.split(' ');
        target = questLinkId(id);
        label = name.join(' ') || (target && questName?.(target)) || 'Quest not found';
      }
      stack.push({ name: type, codes: formatting[type] });
      append(label, target ? { type: type === 'url' ? 'url' : 'quest', target } : undefined);
      stack.pop();
    } else {
      const name = match[7].toLowerCase();
      if (!formatting[name]) append(match[0]);
      else if (!match[6]) stack.push({ name, codes: formatting[name] });
      else if (stack.at(-1)?.name === name) stack.pop();
    }
  }
  append(source.slice(last));
  return output;
}

export function plainQuestText(source: string): string {
  return questText(source)
    .map((run) => parseMinecraftCodes(run.text).plainText)
    .join('');
}
