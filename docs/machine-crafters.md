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

Machine-usage recipe cards show the selected concrete machine when it is among
the recipe's valid crafters. The chooser still includes every family and tier.
Tests cover same-tier collisions, voltage ceilings, annotation validation,
source parsing, correct machine context,
and cached offline reloads for electric furnaces and electric ovens.
