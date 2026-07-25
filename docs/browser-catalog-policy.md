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

## GTNH 2.9.0-beta-2 audit

The raw export contains 60,812 items matched by the upstream blacklist and 59,806 recipes whose output would be
removed. Counts are diagnostic rather than hard-coded behavior:

| Family | Filtered items | Output recipes | Feasibility |
| --- | ---: | ---: | --- |
| Tinkers’ Construct tools and parts | 29,054 | 23,907 | Retain; group NBT variants |
| GregTech `gt.metatool.01` | 19,152 | 19,882 | Retain; required for turbines and GT tools |
| TGregworks tool parts | 4,104 | 12,160 | Retain; group NBT variants |
| Other conditional GregTech entries | 4,394 | 3,533 | Retain exact stacks |
| Forestry genetics | 2,119 | 6 | Retain when relationship-reachable |
| Gendustry genetics | 1,107 | 0 | Usually pruned by reachability |
| Tinkers’ Defense | 364 | 0 | Usually pruned by reachability |
| Botania wands | 272 | 256 | Retain; some dynamic icons may be unavailable upstream |
| Forbidden Magic | 157 | 1 | Retain when reachable |
| Witchery | 54 | 41 | Retain when reachable |
| Gadomancy | 31 | 20 | Retain when reachable |
| Miscellaneous GT++ tools | 4 | 0 | Usually pruned by reachability |

More than 65,536 retained sprites also exposes an upstream atlas-row wrap. The committed browser-policy patch makes
the already allocated atlas use a linear Y coordinate; the pack builder samples the resulting lossless sprite sheets
against that atlas. Missing paths in the exporter’s `image.zip` remain explicit transparent/missing-icon states and
must not be replaced with guessed artwork.
