# Recipe chain mode

Open **Recipe finder → Recipe chain**, supply at least one available input and one target output,
and search across every ordinary recipe in the selected release. Inputs can be items or fluids.
Each requested output gets a route from the available inputs; not every starting input has to be used.
The selected identities and chain mode are stored in the URL.

**Allow additional ingredients** is enabled by default. A route follows a consumed starting material
through real recipes and lists other required ingredients, molds, circuits, and tools under **Also needs**.
Disable it to require every input kind and tool to be supplied initially or produced by an earlier step.
This stricter search includes branching dependencies and displays them in dependency order.

This is a reachability tool, not a factory balance calculator. It ignores quantities, energy, voltage
tiers, machine ownership, and throughput. A chance output is a possible result, not guaranteed production.
Extra-ingredient mode prefers the first minimum-hop reachable route; strict mode provides an available
proof, without claiming to minimize total machines or recipes. Search depth is adjustable from 6 to 32;
the default is 12. A failed bounded search reports the bound rather than claiming no chain exists.
Proofs larger than 128 recipes get an explicit display-limit message.

## Material forms and exact identity

The current export does not carry an authoritative GregTech material-to-form API projection. The solver
therefore does not merge material names, isotope names, formulas, NBT variants, or same-named fluids.
It searches the complete recipe graph, so real melting, solidifying, grinding, chemical, and isotope
steps are naturally considered, including intermediate forms not selected by the user.

Named ore dictionaries and anonymous accepted-ingredient groups are represented explicitly. A matching
member can satisfy a grouped input. This does **not** grant free conversion into the other group members.
Tools and catalysts with zero consumed quantity cannot initiate a conversion path. Zero-chance outputs
are not reachable edges. Every shown step is resolved back to its original verified recipe record.

For example, the 2.9.0 data has **Molten Iron → Iron Ingot → Iron Dust**, through a Fluid Solidifier and
Macerator. The required ingot mold is shown as an additional tool. Strict mode rejects the route without
that mold and accepts it when the mold is also supplied.

## Data and runtime

`npm run build:chain-index` derives indices for every release in `public/versions-v7.json` from its
published format-7 recipe/group/goods assets. Every physical page and reconstructed logical asset is
hash-verified by the existing pack reader. The build rejects unknown references, duplicate recipe IDs,
invalid quantities/probabilities, and incomplete recipe coverage. Two builds must produce identical hashes.
Run this command after publishing a new selectable dataset and include its generated files in the deployment.

`public/recipe-chain-index.json` maps dataset IDs to compressed MessagePack projections. Each projection
binds to the SHA-256 of `JSON.stringify` of the parsed source manifest and has its own full byte hash and
size. Its content-addressed bytes live separately under `public/assets/recipe-chains/`. Existing pack
manifests, source objects, dataset revisions, and rollout epochs are unchanged. The 2.9.0 projection covers
287,414 recipes / 135,962 exact goods and group nodes in 4,743,580 compressed bytes.

The graph downloads only after a chain has both a start and target. Verified compressed bytes are cached
in the dataset's disposable runtime cache and deleted with its other projections. A normal offline dataset
installation does not prefetch this optional graph; use chain mode once to cache it. It is never shell
precache content. Decompression, MessagePack decoding, incidence-index construction, and graph traversal
run in a dedicated worker. Subsequent searches reuse the graph. Selected route recipe shards remain lazy
and use the existing verified facade and ingredient-group hydration.

Traversal yields to newer requests, guards stale generations, and terminates on mode exit or clear.
Browser tests cover the actual two-step fluid-to-dust route, strict/tool semantics, graph reuse and cached
refresh, shareable mode, mobile layout, and stale-query clearing. Unit tests cover form changes, exact
identity, alternatives, cycles, branching proofs, depth limits, cancellation, and index validation.

## Published coverage

| Dataset | Recipes | Nodes | Compressed bytes |
| --- | ---: | ---: | ---: |
| 2.9.0 | 287,414 | 135,962 | 4,743,580 |
| 2.9.0-RC-1 | 286,630 | 135,703 | 4,703,131 |
| 2.9.0-beta-3 | 286,455 | 135,596 | 4,701,142 |
| 2.9.0-beta-2 | 285,691 | 135,206 | 4,688,189 |
| 2.8.0 | 190,080 | 43,265 | 2,123,555 |
