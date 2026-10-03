# GTNH 2.9.0 RC1 release

The urgent format-7 shell takeover shipped independently in commit `f21e767`. The generated worker claims clients
and probes current shells after activation. Legacy windows navigate automatically with their existing URL, even if
v6 catalog loading is stalled. Two-tab tests against the previous production shell and worker passed with exactly
one navigation per tab, including a run with old app reload handling suppressed. Offline warm reload also passed.

## Reviewed source

The official `GT_New_Horizons_2.9.0-RC-1_Java_17-26.zip` archive is 727,184,781 bytes. Its SHA-256 is
`a665e7cfdfa79cd260a7c60816658a75a3c58eaacf9268478ac07e3413241368`.

Archive URL: https://downloads.gtnewhorizons.com/Multi_mc_downloads/betas/GT_New_Horizons_2.9.0-RC-1_Java_17-26.zip

The eight runtime adapter pins were inspected in that archive; disposable preparation validated each JAR's
`mcmod.info` against the profile:

| Adapter mod | RC1 version |
| --- | --- |
| CropsNH | 2.0.129 |
| GT5-Unofficial | 5.09.54.183 |
| BloodMagic | 1.9.13 |
| EnhancedLootBags | 1.3.5 |
| VendingMachine | 0.4.100 |
| NEI Custom Diagram | 1.8.35 |
| Roguelike Dungeons | 1.6.6-GTNH |
| Twilight Forest | 2.7.42 |

The direct-export workflow used Java 21 and Xvfb in `.export-work/2.9.0-RC-1-direct/`. Both upstream submodules
and player installations remained untouched. The controller reached `complete` with 57,025 NEI items. Processing
initially exposed a verifier mismatch between raw and normalized sidecar digests. After correcting the verifier to
apply the builder's canonicalization, service-icon repairs, and ore aliases, processing resumed from the completed
source files with `--resume-processed true`; no exporter or processor patch changed.

## Dataset verification

The dataset is `2.9.0-RC-1-v7-rbf5fd70ecad0`. It contains 105,208 searchable entries, 286,630 recipes, and 1,941
special records across all ten categories. Source data remains format 5; published assets use format 7.

The persistent layout was append-only extended using RC1 processed records before both deterministic builds.
The builds reuse `public/data/2.9.0-beta-3-v7-r131dafd54f93`. Their directory digest is
`43964557dc6f9562a9fd4a3eb9730b0c7378e3dde14086655525c75e37af3827`.
Source sprite parity was verified with 100 samples; all physical hashes and logical shard membership were checked.

| Measurement | RC1 |
| --- | ---: |
| Bootstrap compressed bytes | 10,034,591 (9.57 MiB) |
| Bootstrap physical pages | 13 |
| Detail hydration p95/max physical pages | 3 / 3 |
| Referenced physical assets | 1,002 |
| Referenced physical asset bytes | 88,802,044 |
| Manifest bytes | 1,753,728 |
| Incremental stored bytes after beta-3, including manifest | 29,543,814 |
| Shared asset bytes saved across beta-3 and RC1 | 61,011,958 |

Mobile-sized profiling at 390×844 confirmed zero lazy recipe/special/detail page requests before selection,
zero dataset-asset requests on settled warm reload, one read per bootstrap page on warm startup, three detail
pages on selection, preserved selected-item deep links, and no browser errors. Timings are local-host measurements,
not a guarantee for mobile hardware. The production-build preview measured 3.16 seconds cold and
2.99 seconds warm, including the profiler's 500 ms settling delay.

## Deployment policy

Stage immutable RC1 assets while the index still defaults to beta-3. Verify every staged asset on Netlify before
activating the index with rollout epoch 2 targeting RC1. The rollout applies once to saved startup selections;
other explicit supported links remain deliberate choices. URL links repeating a saved active version may migrate.
After successful activation, IndexedDB records the epoch and later manual switches persist. An unavailable target
bootstrap retains the active v7 cache and leaves the epoch pending. Matching item links survive migration; missing
items return to browsing.

The frozen v6 index, manifests, and referenced assets remain in place. No immutable dataset URL is replaced.

The staged production-build preview passed a browser migration from saved beta-3/epoch 1 to RC1/epoch 2,
retaining `i:EnderIO:itemEnderFood:0`. Explicit version-link choices and dataset-manager switches persisted across
subsequent reloads, with no browser errors.

Immutable RC1 assets were staged in `3416eb9` and successfully deployed by `19578ce` after an initial failed
Netlify build. All 1,002 deployed physical assets passed size and SHA-256 verification before the index change.
The staged manifest matched the verified local bytes exactly. The configured Node 22 build and precache check
also passed locally. Activation sets RC1 first in `versions-v7.json` and advances the rollout epoch from 1 to 2.
