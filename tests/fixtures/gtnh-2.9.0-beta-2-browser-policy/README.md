# GTNH 2.9.0-beta-2 browser-policy parity excerpt

`parity.json` is a compact, immutable excerpt decoded from the local format-v5 output that produced dataset
`2.9.0-beta-2-r080719a85854`. It pins representative GregTech tool variants and their real Assembler recipes without
requiring the private NESQL database, a network request, or a mutable ShadowTheAge checkout during tests.

The JSON records SHA-256 digests of the complete processed `data.bin` and `atlas.webp`, full decoded records for the
Ichorium turbine blade, four Ichorium turbine sizes, a second real turbine variant, a potion-bearing item whose
effect occupies the final tooltip line, and every production recipe for those four turbines. Regenerate it only
for a new sibling fixture using
`tools/data-export/create-browser-policy-fixture.ts`; do not replace this file in place when upstream data changes.
