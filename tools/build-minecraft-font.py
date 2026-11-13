"""Build pixel-aligned web fonts from the preserved OFL Minecraft-Font sources.

Requires fonttools[woff] (with Brotli). Originals are never changed.
"""

from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
for bold in [False, True]:
    source = TTFont(
        root
        / "assets/source/minecraft-pixel-font"
        / ("Minecraft-Bold.otf" if bold else "Minecraft.otf")
    )
    original = source.getGlyphSet()
    glyphs, metrics = {}, {}
    for name in source.getGlyphOrder():
        advance, bearing = source["hmtx"].metrics[name]
        # Upstream outlines use two design units per pixel and an odd left
        # bearing. Remove that half-pixel offset and half-pixel tracking.
        shift = 1 if bearing % 2 else 0
        pen = TTGlyphPen(original)
        original[name].draw(TransformPen(pen, (100, 0, 0, 100, -shift * 100, 0)))
        glyphs[name] = pen.glyph()
        metrics[name] = ((advance - shift) * 100, (bearing - shift) * 100)
    builder = FontBuilder(1800, isTTF=True)
    builder.setupGlyphOrder(source.getGlyphOrder())
    builder.setupCharacterMap(source.getBestCmap())
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=1600, descent=-200)
    style = "Bold" if bold else "Regular"
    builder.setupNameTable(
        {
            "familyName": "Pocket NEI Pixel",
            "styleName": style,
            "uniqueFontIdentifier": f"PocketNEIPixel-{style}-1",
            "fullName": f"Pocket NEI Pixel {style}",
            "psName": f"PocketNEIPixel-{style}",
            "version": "Version 1.0",
            "copyright": source["name"].getDebugName(0)
            or "Copyright 2022 Idrees Hassan",
            "licenseDescription": (
                root / "assets/source/minecraft-pixel-font/LICENSE"
            ).read_text(),
            "licenseInfoURL": "https://openfontlicense.org/",
        }
    )
    builder.setupOS2(
        version=4,
        sTypoAscender=1600,
        sTypoDescender=-200,
        sTypoLineGap=0,
        usWinAscent=2000,
        usWinDescent=600,
        usWeightClass=700 if bold else 400,
        fsSelection=(0x20 if bold else 0x40) | 0x80,
    )
    builder.setupPost()
    builder.font["head"].created = source["head"].created
    builder.font["head"].modified = source["head"].modified
    builder.font.recalcTimestamp = False
    builder.font["head"].macStyle = 1 if bold else 0
    builder.font.flavor = "woff2"
    target = (
        root
        / "public/assets"
        / ("minecraft-pixel-bold.woff2" if bold else "minecraft-pixel.woff2")
    )
    builder.font.save(target)
    print(target.name, target.stat().st_size, "bytes")
