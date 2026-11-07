# Complete machine capabilities

The format-v5 processor stores a representative machine for each voltage tier
in `singleblocks`. That array is suitable for choosing a recipe icon, but it
cannot represent multiple machine families at the same tier. In
`PackPreProcessor.CalculateMachines`, `sb[tier] = i` overwrites earlier
catalysts. For the GTNH 2.9.0 Furnace category, microwaves therefore displaced
the electric-furnace and electric-oven families.

The format-v5 decoder also removed null tier slots before assigning tiers by
array position. Categories starting at HV or with gaps therefore received
incorrect limits. Single-block references now keep their explicit source
`maxVoltageTier`; compact display lists no longer change machine voltage.

`tools/data-export/machine-crafters.py` reads the complete `RECIPE_TYPE_ITEM`
relationships from the validated original HSQLDB export. It preserves all GT
recipe catalysts, deduplicates per category, retains canonical item/NBT IDs,
and determines a single-block machine's tier from its **Voltage IN** line.
Other tier labels such as Voltage OUT cannot lower its input limit. Deprecated
catalysts remain excluded as in the original processor.

The normal `export:process` pipeline creates `machine-crafters.json` before
building a pack. `--machine-crafters <file>` is also accepted by `pack` and
`verify-pack`. Canonical recipe types preserve missing candidates in
`additionalCrafters`, including their role and voltage ceiling, while leaving
the legacy display representatives intact. Shared helpers supply the complete
valid-machine list and derive machine usages from all candidates. Verification
checks every source catalyst and its tier against the encoded recipe types.
The annotation bytes participate in the immutable revision hash.

## Published-data recovery

The current immutable 2.9.0 pack is not rewritten. Its complete original source
contains 845 GT catalysts across 168 categories. Comparing them to the pack
finds 17 lost machines, all in Furnace. The dataset-bound generated
`src/lib/generated/machine-crafters.json` restores those exact source bindings
and corrects 38 compacted voltage tiers across six other categories (55
bindings across seven categories in total).
`assets/source/machine-crafters/provenance.json` records the source database and
base manifest digests; no machine IDs or counts are guessed from display names.

Reproduce the recovery:

```sh
python3 tools/data-export/machine-crafters.py \
  --script <validated-export>/nesql-db.script \
  --output .export-work/machine-crafters/source.json
npm run recover:machine-crafters -- \
  .export-work/machine-crafters/source.json \
  public/data/2.9.0-v7-rbd0b48ae8ad7
```

`DatasetRepository` applies recovered type bindings after opening either a cold
or prepared catalogue. It merges their capabilities after detail hydration,
so old cached zero-capability records cannot suppress the restored machine
usages. Ore-dictionary groups inherit their members' restored capabilities.
New packs encode them directly and need no dataset-specific recovery. Other
datasets are not modified by this recovery registry.

Machine-usage recipe cards show the selected concrete machine when it is among
the recipe's valid crafters. The chooser still includes every family and tier.
Tests cover same-tier collisions, voltage ceilings, annotation validation,
source parsing, the restored current-release bindings, correct machine context,
and cached offline reloads for electric furnaces and electric ovens.
