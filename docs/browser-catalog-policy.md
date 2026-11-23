# Browser catalog retention policy

ShadowTheAge’s processor intentionally filters configurable tools and other high-cardinality item families. That is
a reasonable tradeoff for a production calculator, but it removes valid browseable objects and any recipe whose
output is filtered. GTNH Recipe Browser therefore disables `ItemBanlist` only in the disposable processor copy used
by `tools/data-export/process.ts`. The upstream submodule remains unchanged.

The policy does not blindly publish every NEI state. `PackConverter` still retains only items touched by recipes,
ore dictionaries, fluid containers, crafter metadata, or other exported relationships. Exact stable IDs, damage,
NBT, icons, and recipe directions are preserved. The client groups NBT-distinguished stacks sharing a registry name
and damage value for browsing, then asks the user to select an exact variant.

GregTech generated ores receive a second, equally browse-only grouping rule. Legacy `gt.blockores` and current
`gt.blockores2`–`gt.blockores7` stacks encode the material as `damage % 1000`; their block series and thousands
digit identify the host stone. The client collapses matching GT stacks with the same material and exported name,
cycles their exact sprites, and labels the picker with host stones such as Stone, Moon, Mars, and Deepslate. It does
not merge other mods' ores or infer families from ore-dictionary membership. Unknown block series, hidden
natural/small metadata, and singletons remain exact rows until explicitly supported.

## Atlas limits

More than 65,536 retained sprites also exposes an upstream atlas-row wrap. The committed browser-policy patch makes
the already allocated atlas use a linear Y coordinate; the pack builder samples the resulting lossless sprite sheets
against that atlas. Missing paths in the exporter’s `image.zip` remain explicit transparent/missing-icon states and
must not be replaced with guessed artwork.
