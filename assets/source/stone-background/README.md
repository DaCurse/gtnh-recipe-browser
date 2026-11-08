# Minecraft stone background

The source is the original 16×16 stone texture from the verified Minecraft Java
Edition 1.7.10 client used by the disposable GTNH export runtime:
`assets/minecraft/textures/blocks/stone.png`. The archive SHA-1 and source/output
SHA-256 digests are in `provenance.json`. This is a Mojang/Microsoft game asset,
not a Shadow UI texture or part of that pack's CC licence.

`public/assets/stone-background.png` is a 32×32 nearest-neighbour copy (326 bytes).
Upscaling ahead of time preserves the original pixels at 2× without applying an
image-rendering rule to every image in the document. No pixels are recoloured.
The shared CSS `--page-background` layers a dark blue-grey tint over the tile.

Recreate the public tile from the retained source:

```sh
node --input-type=module -e "import sharp from 'sharp'; await sharp('assets/source/stone-background/stone.png').resize(32,32,{kernel:'nearest'}).png().toFile('public/assets/stone-background.png');"
```

The body paints the background once; the landing page, catalogue and recipe
detail surfaces are transparent. The mobile sticky direction tabs and machine
ruler paint the same opaque tinted tile so recipe labels remain covered during
scrolling. Cards, search fields, native recipe panels and buttons retain their
own surfaces. The tiny tile is included in the service-worker precache for
offline navigation. Faint secondary labels are brighter to maintain at least
4.5:1 contrast against the brightest tile pixels and catalogue hover surface.
