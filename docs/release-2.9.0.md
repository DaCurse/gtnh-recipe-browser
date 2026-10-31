# GTNH 2.9.0 final dataset release

## Reviewed client source

On 2026-10-31 the official modpack GitHub release provided a config-only `2.9.0.zip`,
not a runnable client: 211,452,849 bytes, SHA-256
`b94765dcc410187e3f595c2c8482e269755691018490406185fea3cc7ed5f65f`, zero JARs.
The existing downloads.gtnewhorizons.com client URLs returned HTTP 404.

The export therefore uses a **locally assembled client from official pinned release inputs**.
It is not represented as an upstream-published client ZIP or a daily build.

- Assembler: [DreamAssemblerXXL at 1b62ef0](https://github.com/GTNewHorizons/DreamAssemblerXXL/tree/1b62ef00ad679c51ab0ec67f8a8e42778a059ce6).
- Release selection: [2.9.0 manifest](https://github.com/GTNewHorizons/DreamAssemblerXXL/blob/1b62ef00ad679c51ab0ec67f8a8e42778a059ce6/releases/manifests/2.9.0.json),
  SHA-256 `e2c7396c7121c86668ce3f93216f2bde71984a7ecd34ed5d231f8888ce3d13fa`.
- Config: [official 2.9.0 release asset](https://github.com/GTNewHorizons/GT-New-Horizons-Modpack/releases/download/2.9.0/2.9.0.zip),
  verified against the GitHub release API digest above.
- Assembly: official `PrismAssembler`, `Side.CLIENT_JAVA9`, with the complete selected client/both mod set
  checked against the manifest. Exact tagged assets came from the official asset catalog; external mods use
  the catalog's actual download URLs rather than their browser landing pages.
- Four unavailable GitHub repositories (Catwalks-2, Galaxy-Space-GTNH, harvestcraft, Automagy-GTNH) were
  resolved at their exact versions in GTNH's official Maven repository. Each downloaded JAR matches that
  repository's published SHA-256. Automagy uses Maven group `tuhljin.automagy`.
- All downloaded ZIP/JAR inputs passed ZIP CRC checks. The input report contains 254 archive inputs,
  including 242 JARs and the selected translation/config/launcher archives.

Output: `GT_New_Horizons_2.9.0_Java_17-26.zip`, 747,604,764 bytes,
SHA-256 `dba6da2daa53925f12755172fd7d508ebcc5d23aa3c28a36c57db8e30070aa44`.
The direct-export profile pins this exact local archive. Reassembling a ZIP can change its bytes because
ZIP metadata and translation assets are not all immutable; never silently replace the pinned checksum.
Review any later upstream-published client as a separate source.

The assembly script, full input URL/size/SHA-256 report, downloaded inputs and logs are retained privately under
`.export-work/release-2.9.0-source/`. No raw NESQL output is published.

## Runtime pins

The downloaded JAR metadata independently confirms:

| Adapter source | Version |
| --- | --- |
| CropsNH | 2.0.140 |
| GT5-Unofficial | 5.09.54.265 |
| BloodMagic | 1.9.16 |
| EnhancedLootBags | 1.3.5 |
| VendingMachine | 0.4.103 |
| NEICustomDiagram | 1.8.36 |
| RoguelikeDungeons | 1.6.6-GTNH |
| TwilightForest | 2.7.45 |

## Export command

Run from the repository in WSL using the retained reviewed archive:

```sh
npm run export:direct -- \
  --version 2.9.0 \
  --shared-layout tools/pack-builder/layouts/2.9.0.json \
  --reuse-packs public/data/2.9.0-RC-1-v7-rbf5fd70ecad0,public/data/2.9.0-beta-3-v7-r131dafd54f93 \
  --java /usr/lib/jvm/java-21-openjdk/bin/java
```

The profile resolves the archive under `.export-work/release-2.9.0-source/DreamAssemblerXXL/releases/multi_poly/`.
Use `--archive <path>` if the exact pinned file is stored elsewhere. As with other direct exports, the target
`.export-work/2.9.0-direct/` must be fresh. Follow `agent-data-export-runbook.md` and
`exporting-current-data.md` for all processing, verification, staging and activation gates.

## Verified dataset

Dataset: `2.9.0-v7-rbd0b48ae8ad7` (revision `bd0b48ae8ad7`). The controller reported explicit completion,
and the launcher exited cleanly. Both deterministic builds matched. Verification passed for 1,282 assets,
95,238,413 asset bytes, 287,414 browser recipes, 105,223 goods, all ten special categories (1,974 records),
and 100 source-sprite samples. These browser counts include normalized/generated entries and differ from
raw NESQL recipe/item counts.

The initial reuse layout met the byte limit but needed 20 bootstrap pages. The record-page builder now
consolidates selected bootstrap records when reuse would exceed the 16-page startup budget. It retains
predecessor objects and lazy-page reuse; a regression test verifies reconstruction and lazy-object identity.
The validated processed inputs were reused without changing any exporter/processor patch or rerunning Minecraft.

Final storage analysis: 8,048,473 bootstrap bytes in 7 pages; p95 detail partition hydration is 4 pages.
Adding the final dataset alongside RC1 needs 27,955,273 additional stored bytes (including its manifest).
Identical-file sharing between RC1 and final saves 69,104,973 bytes. The persistent layout is extended
append-only; frozen v6 bridge files remain unchanged.

The full quality suite passes: 38 test files, 229 tests, no Svelte/TypeScript errors or warnings.
Run logs and complete source/build provenance are retained under `.export-work/release-2.9.0-source/`
and `.export-work/2.9.0-direct/`.

The final mobile profile (390x844, 4x CPU throttling) measured cold startup at 5,934 ms and warm startup at
2,375 ms. Warm refresh made zero dataset-asset requests and read zero bootstrap pages. Startup fetched no
lazy pages, item selection stayed within the detail fan-out limit, and the item deep link restored without errors.
Production preview was used because watching the accumulated export workspaces exhausts the dev-server watcher limit.

## Release status

Staged commit `89b3735` was deployed by Netlify deployment `6ae619d673fe3d939d25e081`.
The deployed-origin smoke test fetched and verified all 1,282 final-dataset assets successfully before activation.
The version index now configures rollout epoch 3 targeting `2.9.0-v7-rbd0b48ae8ad7`. RC1, both betas and
2.8.0 remain selectable; no datasets or shared objects were removed. The rollout applies once and preserves
subsequent deliberate version choices.

Activation commit `e5baadf` was deployed successfully by Netlify deployment `6ae61b0485cb755b087f5c96`.
Live checks passed for the default final manifest, epoch-3 migration with item preservation, explicit-link and
dataset-manager choices across refresh, real service-worker warm/offline/stalled-network startup, cached item
hydration with zero compressed-page reads, and desktop/mobile loading states with deliberately delayed details.
No browser errors were reported.

The rollout test models receipt of the actual live policy in the returning client's metadata cache. This avoids
racing its own synthetic old index against the app's 150 ms cached-startup budget. A client still holding an old
index may finish that startup on its saved version while the background index request completes; a subsequent
startup applies the newly received rollout policy. Service workers are blocked only in this synthetic routing
test; `test-cached-startup.mjs` separately exercises the real deployed service worker and offline cache.
