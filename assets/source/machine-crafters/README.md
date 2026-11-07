# Recovered machine crafter bindings

See [`docs/machine-crafters.md`](../../../docs/machine-crafters.md) for the root
cause, source tables, canonical model, reproduction and validation.

These bindings come from the validated GTNH 2.9.0 NESQL database used by the
published pack. The private database remains under `.export-work`.
`provenance.json` pins its digest and the unchanged pack manifest. The generated
runtime registry restores all 17 discarded electric-furnace/oven catalysts
and corrects 38 existing voltage limits shifted by compacted tier arrays.
It repairs the authoritative bindings rather than patching one item or its
displayed count.
