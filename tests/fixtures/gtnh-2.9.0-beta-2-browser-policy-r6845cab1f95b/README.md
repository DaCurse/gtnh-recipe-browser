# GTNH 2.9.0-beta-2 corrected sprite parity excerpt

`parity.json` is an immutable excerpt decoded from the local format-v5 output that produced dataset
`2.9.0-beta-2-r6845cab1f95b`. It preserves representative GregTech tools, their Assembler recipes, tooltip effects,
and full alpha-audit totals for every retained searchable `gregtech:gt.metatool.01` variant.

The fixture records SHA-256 digests of the complete processed `data.bin` and `atlas.webp`. Tests use only this compact
JSON and never depend on the private NESQL database, network access, or mutable ShadowTheAge revisions. The previous
fixture remains unchanged as historical evidence of the pre-fix dataset.
