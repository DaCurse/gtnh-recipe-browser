# Beta 2 / beta 3 shared-pack analysis

This is the measured format-6 design review for the local direct exports
`2.9.0-beta-2-r2e44dca28916` and `2.9.0-beta-3-rcb4153c995d9`. The figures come
from `tools/pack-analysis/compare-packs.ts` and the final generated packs.
Bytes are compressed payload bytes unless stated otherwise.

## Why the earlier goods result looked wrong

The earlier comparison treated every field in a catalog goods row as item
identity. That included generated and version-sensitive metadata: numeric NEI
indices, rendered tooltips, search masks, recipe lookup indexes, special lookup
indexes, and counts. It reported only 6,204 exact rows out of 105,099 beta-3
rows (about 5.9%), which is not evidence that half the items were authored
differently.

The format-6 analysis separates stable item identity from that metadata:

| Goods record view | Beta 2 | Beta 3 | Identical | Modified | Added | Removed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| intrinsic identity | 104,729 | 105,099 | 104,443 | 35 | 621 | 251 |
| display/search/relation metadata | 104,729 | 105,099 | 52,611 | 51,867 | 621 | 251 |

Thus 99.38% of beta-3 intrinsic goods rows are byte-identical. The 50.06%
metadata figure is dominated by generated indexes, not broad item redesign.
The changed-field counts are:

| Metadata field | Rows changed |
| --- | ---: |
| numericId | 47,822 |
| tooltip | 21,796 |
| searchMask | 4,643 |
| name | 1,878 |
| usageCount | 1,720 |
| usageShards | 1,927 |
| specialProductionLookupIds / specialUsageLookupIds | 992 / 992 |
| specialProductionCount / specialUsageCount | 976 / 976 |
| specialProductionShards / specialUsageShards | 871 / 871 |
| productionShards | 555 |
| productionCount | 436 |

The same record-level comparison found 96.58% identical recipes, 98.43%
identical ore dictionaries, and 81.46% identical recipe types. Special records
are more volatile: 61.67% are exact because their generated lookup payloads
change when handlers or indexes change.

## Before and after

The old format-4 beta-2 and beta-3 packs contain 117,895,569 logical bytes in
590 private objects. They share no exact asset hash, so beta 3 requires all
59,061,505 bytes after beta 2.

The rejected first shared implementation (format 5) made logical shards
content-addressed, but a changed record still rewrote its entire shard. It also
repacked nearly every rendered icon into different sheets. Its beta pair used
135,600,817 unique asset bytes—15% more than the two old packs—and beta 3 added
67,675,528 bytes after beta 2. That result prompted the format-6 redesign.

The final format-6 packs remain complete and independently selectable. Logical
lookup shards select complete encoded records from frozen physical pages; icon
owners select cells from frozen content-addressed sheets. Dataset identity stays
in the manifest. Measurements include the manifests themselves:

| Measurement | Beta 2 | Beta 3 |
| --- | ---: | ---: |
| referenced asset bytes | 69,364,889 | 80,874,793 |
| physical objects | 253 | 294 |
| manifest bytes | 496,338 | 999,746 |
| recipe-shard page fan-out, median / p95 / max | 5 / 7 / 8 | 5 / 8 / 9 |
| recipe lookup page fan-out, median / p95 / max | 7 / 15 / 44 | 8 / 17 / 49 |
| usage lookup page fan-out, median / p95 / max | 7 / 27 / 56 | 9 / 31 / 61 |

Across both manifests, 294 unique objects occupy 80,874,793 bytes. Adding both
manifests produces 82,370,877 stored bytes, 35,524,692 bytes (30.13%) below the
old private-pack asset total even under the conservative comparison that did
not count old manifest bytes. All 253 objects referenced by beta 2 are also
referenced by beta 3. Installing beta 3 therefore adds 41 objects and
11,509,904 asset bytes, or 12,509,650 bytes including its manifest—78.82% less
than the old 59,061,505-byte beta-3 install.

The historical 2.8.0 dataset was tested as another reuse base and rejected:
the greater record distance made its complete manifest reference 72,587,924
asset bytes. Building it standalone uses 32,848,222 bytes in 111 objects,
close to its old 32,366,020 bytes. Reuse inputs are therefore generic but
measurement-driven; unrelated releases are not forced into one lineage.

The final union layout uses these targets:

| Family | Target |
| --- | ---: |
| recipe shards | 1 MiB |
| intrinsic goods shards | 160 KiB |
| goods metadata shards | 512 KiB |
| special shards | 1 MiB |
| ore-dictionary shards | 1 MiB |
| physical record pages | 2 MiB uncompressed |

It contains 191 stable recipe-type namespaces, 267 recipe partitions, 258
goods partitions, 16 ore-dictionary partitions, and 25 special partitions
across 10 views. Logical shard count controls lookups; physical page count
controls storage and downloads, so changing one record no longer rewrites the
whole logical shard.

Icon pixels required separate treatment. Although both source atlases are
lossless WebP files, only 11.03% of common owners have byte-identical RGBA
pixels between the two exports. The distribution reveals renderer/export
noise rather than widespread texture changes: 94.73% are within 1/255 mean
channel difference, while the top 1% jump to at least 32.10/255. Format 6
reuses an earlier owner cell only when mean RGBA difference is at most 2/255,
mean alpha difference is at most 0.5/255, and no channel differs by more than
16/255. The last bound prevents a localized texture edit from disappearing
inside a low whole-sprite mean. Larger changes produce new
sprites. The verifier independently enforces the same bound against the source
atlas. Beta 3 consequently needs eight new icon sheets rather than 89.

The theoretical exact-record upper bounds are 279,365,435 canonical bytes,
139,040,016 bytes when each common record is independently compressed, and
30,793,070 bytes when common records are compressed as one canonical
collection. These are deliberately upper bounds: collection wrappers,
references, secondary indexes, and sprites still need their own stable model.

## Chunking comparison

The analyzer compares persistent union hash-prefix partitioning with
record-aware content-defined chunking (CDC). Both keep boundaries between
complete records. The simulation targets are 512 KiB for goods and recipes and
256 KiB for special data; the production layout above uses the measured,
operationally chosen targets.

| Class | Scheme | B2 chunks | B3 chunks | Shared chunks | B3 incremental | Smallest chunk | Largest chunk |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| goods | union hash-prefix | 16 | 16 | 0 | 2,253,684 | 132.6 KiB | 140.7 KiB |
| recipes | union hash-prefix | 336 | 338 | 78 | 19,885,175 | 348 B | 436.0 KiB |
| special | union hash-prefix | 25 | 25 | 2 | 1,747,154 | 10.6 KiB | 119.4 KiB |
| goods | record-aware CDC | 51 | 51 | 14 | 1,398,201 | 5.6 KiB | 66.6 KiB |
| recipes | record-aware CDC | 556 | 559 | 9 | 19,913,830 | 353 B | 76.5 KiB |
| special | record-aware CDC | 134 | 133 | 14 | 1,637,704 | 2.3 KiB | 41.5 KiB |

CDC wins a small amount of simulated incremental space for goods and special
data, but needs 8.6 times as many goods objects and roughly 1.7 times as many
recipe objects. Its independently chosen boundaries also move after an
insertion, deletion, or reorder, making logical shard references unstable.
Persistent hash-prefix routing gives predictable logical lookup fan-out. Frozen
record pages beat both alternatives for physical storage because exact records
keep their existing page location after insertions, deletions, modifications,
and reorderings; pages may be appended but are never repacked or merged.

## Chosen format

Each manifest owns dataset identity (`datasetId`, GTNH version, revision, and
display name) and maps stable logical shard IDs to runs in immutable record
pages by compact manifest-local page indexes. Reusable payloads do not contain
a dataset owner. The publisher stores physical pages and sheets under
`public/assets/sha256/<full-sha256>` and publishes each complete manifest under
`public/data/<dataset-id>/`. Existing objects are accepted only when their
bytes have the requested SHA.

The verifier and browser replace dataset ownership checks with manifest
membership, strong SHA verification, schema/kind/logical-ID checks, prefix and
recipe-type/category checks, sorted record IDs, reference validation, and
catalog partition coverage. The manifest also records the compact published
prefix map and fingerprints it; the publisher checks append-only lineage against
every existing format-6 manifest. The browser's existing SHA-keyed IndexedDB store
is the physical object store: two installed manifests keep one cached copy,
and deletion removes a blob only when no other dataset references its hash.
Offline accounting reports each dataset's logical unique total and the cache's
physical byte/object totals separately.

Catalog core metadata is split into stable roles rather than one volatile
monolith. Intrinsic goods, generated goods metadata, and icon references are
separate typed record families. Recipe types retain presentation order as
metadata while their logical IDs omit the old positional component. A recipe
edit therefore changes its own record and the minimum derived metadata, not an
unrelated item's identity or sprite record.

## Persistent layout invariant

The prefix trie is immutable once published. Every published prefix remains a
valid, stable partition identity for every future dataset. A later dataset may
continue using an existing prefix, or add descendants beneath it when the
records in that partition require more capacity. It must never merge published
prefixes, reassign records to another existing prefix, or rebuild the tree from
scratch because a later dataset is smaller or differently distributed. This is
what keeps old manifests' logical shard references meaningful and reusable.

A bucket or physical page containing one complete record may still exceed its
target cap. It is marked as an explicit `oversizedSingleton`; prefix splitting
cannot reduce a singleton. If the oversized value is actually a large
secondary index, that index should become its own record family instead of
distorting the trie. Builder, verifier, and browser reject over-cap multi-record
pages and reject missing or spurious singleton markers.

The synthetic layout tests cover insertion, deletion, modification, reorder,
parent retention, descendant splitting, and oversized-singleton diagnostics.
The real beta-2/beta-3 union currently produces no oversized singleton.

## Status

Format 6 is now the only builder, verifier, publisher, cache, and runtime pack
contract. The published dataset directories contain only their format-6
manifests, and the global object pool has been pruned to the objects referenced
by those manifests. Browser migration removes all old-format rows and orphaned
cache blobs after the first successful format-6 catalog load. Historical
format-4 and failed format-5 numbers remain only as comparison data.
