import { describe, expect, it } from 'vitest';
import { minecraftHtmlPlainText, parseMinecraftHtml } from '../src/lib/minecraftText';

describe('Minecraft tooltip formatting', () => {
  it('extracts plain text without materializing formatting segments', () => {
    expect(minecraftHtmlPlainText('<span class="fmt-a">Line one</span><br>Line &amp; two'))
      .toBe('Line one\nLine & two');
  });

  it('preserves colors, styles, new lines, and intentional blank lines', () => {
    expect(parseMinecraftHtml(
      'The Souls of the Damned<br>do not like stone...<br><br>' +
      '<span class="fmt-9 fmt-l">+10 Attack Damage</span><br>'
    )).toEqual({
      lines: [
        { segments: [{ text: 'The Souls of the Damned', formats: [] }] },
        { segments: [{ text: 'do not like stone...', formats: [] }] },
        { segments: [] },
        { segments: [{ text: '+10 Attack Damage', formats: ['9', 'l'] }] }
      ],
      plainText: 'The Souls of the Damned\ndo not like stone...\n\n+10 Attack Damage'
    });
  });

  it('decodes exporter entities and discards unrecognized markup safely', () => {
    expect(parseMinecraftHtml(
      'Blood Letter&#39;s Pack<img src=x onerror=alert(1)>' +
      '<span class="fmt-d unsafe">Protected &amp; pink</span><script>bad()</script>'
    )).toEqual({
      lines: [{
        segments: [
          { text: "Blood Letter's Pack", formats: [] },
          { text: 'Protected & pink', formats: ['d'] },
          { text: 'bad()', formats: [] }
        ]
      }],
      plainText: "Blood Letter's PackProtected & pinkbad()"
    });
  });

  it('accepts all exporter format codes and ignores arbitrary classes', () => {
    const parsed = parseMinecraftHtml(
      '<span class="fmt-a fmt-n fmt-o other">Styled</span>' +
      '<span class="fmt-z"> plain</span>'
    );
    expect(parsed.lines[0].segments).toEqual([
      { text: 'Styled', formats: ['a', 'n', 'o'] },
      { text: ' plain', formats: [] }
    ]);
  });
});
