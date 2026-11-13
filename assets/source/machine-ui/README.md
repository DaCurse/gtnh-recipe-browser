# Native UI sprite provenance

Recipe panels use **GTNH Shadow UI 5.47 (standard GTNH 2.9.X)** by
Ranzu/Ranzuu. Release, verified ZIP digest and edition are pinned in
`shadow-ui-provenance.json`. Original overridden PNGs are preserved in
`textures/`; the `resourcePack` field in `textures.json` identifies them.
They are under **CC-BY-NC-SA-4.0**, with the complete licence included in
`Shadow-UI-CC-BY-NC-SA-4.0.txt`. The lossless browser atlas repacks these images
without recolouring them. The pack's `pack.mcmeta` supplies the GUI text colours
and shadow settings. This resource-pack licence is separate from the licences
of the underlying mods and the browser's source code.

[Author and source](https://github.com/Ranzuu/Shadow-UI) ·
[Pinned release](https://github.com/Ranzuu/Shadow-UI/releases/tag/v2.9.X/v5.47)

`buttons/` preserves the same pack's Minecraft `widgets.png` and exact crop
provenance for the normal, hovered and disabled web controls. These crops use
the same CC-BY-NC-SA-4.0 licence. Reproduction and text colours are documented
in `docs/minecraft-controls.md`.

Original non-overridden PNGs in `textures/` are extracted without pixel changes from the GTNH
2.9.0 mod jars listed in `textures.json`. Each entry records the original resource
path, file SHA-256 and jar filename. `runtime.json` records jar digests and runtime
snapshot provenance; `atlas.json` records the lossless sprite placement.

These sprites originate in GTNewHorizons/GT5-Unofficial, including its bundled
GUIs, GTNewHorizons/ModularUI, and GTNewHorizons/CropsNH, under LGPL-3.0. Copies of LGPL-3.0 and GPL-3.0
are included here. The browser atlas repacks the original pixels without
recolouring them. Original source and texture history:

- https://github.com/GTNewHorizons/GT5-Unofficial/tree/5.09.54.265/src/main/resources/assets
- https://github.com/GTNewHorizons/ModularUI/tree/1.3.4/src/main/resources/assets/modularui/textures/gui/slot
- https://github.com/GTNewHorizons/CropsNH/tree/2.0.140/src/main/resources/assets/cropsnh

Prism RC2 sprites were inspected as a reference; published files use the final
2.9.0 release. See `docs/machine-recipe-ui.md` for reproduction instructions.

`thaumcraft/` preserves the original Thaumcraft 4.2.3.5 research-book overlay used
by Aspect Recipe Index 1.1.6. It is not a Shadow UI texture. Its provenance and
reproducible extraction are documented in `docs/machine-recipe-ui.md`.
