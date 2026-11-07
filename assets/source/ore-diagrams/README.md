# Native ore-processing diagrams

The browser renders the live `GregTechOreProcessing.generate()` output from
**NEI Custom Diagram 1.8.36**, used by the validated GTNH 2.9.0 export. Source:
[GTNewHorizons/nei-custom-diagram at 042a8c7](https://github.com/GTNewHorizons/nei-custom-diagram/tree/042a8c7f643b26e2645252ef58dea9bdf41a34c6/src/main/java/com/github/dcysteine/neicustomdiagram/generators/gregtech5/oreprocessing).

`BrowserOreDiagramExporter.java` captures each diagram's selected layouts,
slot groups, item/fluid alternatives, quantities, chance annotations, machine
labels, tooltip notes, orthogonal segments, arrowheads and directional matcher.
The mod decides which optional routes exist for each material. The browser
does not infer new routes by walking co-occurring recipe ingredients.

This includes GregTech, BartWorks and GT++ ores, mercury and sodium persulfate
baths, sifting, electromagnetic separation, additional recipes, and distinct
thermal centrifuge routes when crushed/purified outputs differ. The validated
snapshot contains **331 diagrams**. Raw snapshots remain private in
`.export-work`; `provenance.json` pins their digest and the immutable dataset.

The original geometry and generator are under **LGPL-3.0**, attributed to
dcysteine and the GTNewHorizons contributors. The complete LGPL and GPL
licenses are included in `../machine-ui/`. Diagram slot textures use Shadow UI
5.47 under its separate CC-BY-NC-SA-4.0 license; originals are preserved in
`../machine-ui/special/ore-slots.png` and source/attribution in that directory.

Reproduce in a fresh disposable GTNH client using
`tools/machine-ui-export/setup.py`, then `npm run ui:extract` and
`npm run ui:ore-diagrams -- <snapshot.json> <published-pack>`. The builder
resolves every displayed reference against the actual published catalogue,
normalizes runtime fluid-display items to named fluids, verifies matcher
references, and writes two lossless gzip assets. It also emits the tiny
dataset-bound registry in `src/lib/generated/ore-diagrams.json`.

The native index and scene data are verified, fetched lazily, cached in the
existing asset store and accounted against their owning dataset. Existing
recipe packs and their manifests remain unchanged. Unsupported releases keep
the old inferred graphs disabled; a new release needs a matching snapshot.
The dataset publisher retains registered companion assets while their exact
base manifest remains published, and releases them when that owner is retired.
