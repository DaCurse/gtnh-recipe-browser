# Pocket NEI Pixel web font

Originals here are from Idrees Hassan's Minecraft-Font, commit
`261ac77fbf28796ca09c22eb83ecdfe386c4b838`, under SIL OFL 1.1.
`provenance.json` records the source hashes. LICENSE is preserved unchanged from upstream. These are an open recreation, not Mojang's font assets.

The web derivatives are renamed Pocket NEI Pixel. Run:

```sh
python -m venv .export-work/font-tools
.export-work/font-tools/bin/pip install 'fonttools[woff]' brotli
.export-work/font-tools/bin/python tools/build-minecraft-font.py
```

The builder converts the source outlines to TrueType WOFF2, normalizes their
half-cell bearings/tracking, uses a conventional 1800-unit em and retains glyph
shapes. Use 9px/18px multiples with integer line baselines and no fractional
letter spacing. Original source timestamps make output reproducible. Bold uses
the upstream Minecraft-style pixel-overstrike glyphs. Italics use CSS synthesis.
