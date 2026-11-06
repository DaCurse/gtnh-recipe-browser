# Native UI sprite provenance

Original PNGs in `textures/` are extracted without pixel changes from the GTNH
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
