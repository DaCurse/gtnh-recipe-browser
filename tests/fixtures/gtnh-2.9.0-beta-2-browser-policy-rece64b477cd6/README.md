# GTNH 2.9.0-beta-2 ore-dictionary parity excerpt

`parity.json` is an immutable format-v5 compatibility excerpt. It pins complete named Forge dictionary aliases, a distinct anonymous recipe ingredient
group, representative GregTech tools and recipes, tooltip effects, and sprite-audit totals.

The fixture records SHA-256 digests of the complete processed `data.bin` and `atlas.webp`. Tests use only this compact
JSON and never depend on the private NESQL database, network access, or mutable ShadowTheAge revisions. Older fixture
directories remain unchanged as historical compatibility evidence.
