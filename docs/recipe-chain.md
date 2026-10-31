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
The tool shows up to ten distinct verified routes per target on the initial search, with Previous/Next route controls.
Extra-ingredient mode prefers shorter discovered routes; strict mode also looks for alternative proofs
by excluding steps from its first proof. Neither mode claims to enumerate every solution or minimize
total machines, resources, or energy. Additional route recipes load only when selected. **Search more routes** raises the requested count to 25, then 50, and widens retained histories and exploration budgets. Existing results and the selected route remain visible; **Stop searching** cancels expansion without discarding them. Displayed counts describe discovered routes, never the total number of possible solutions. Search depth is adjustable from 6 to 32;
the default is 12. A failed bounded search reports the bound rather than claiming no chain exists.
Proofs larger than 128 recipes get an explicit display-limit message.

Extra-ingredient searches retain separate histories for each intermediate, including which consumed
co-inputs were borrowed. A borrowed material cannot be recovered and credited as a conversion product
of the starting material. Candidate targets are also checked against a counterfactual closure of the displayed procedure plus
single-consumed-input processing/form changes: if the borrowed consumed inputs alone can make the
target through those steps, without the supplied source, that candidate is rejected. Unrelated
multi-reactant synthesis elsewhere in the pack does not disqualify a genuinely source-dependent
procedure. Non-consumed tools do not count as
borrowed source material. This is a conservative causal check, not atomic or stoichiometric tracing.

An optimistic reverse graph prunes directions that cannot reach a target within the depth bound.
Best-first exploration favors shorter proofs with fewer borrowed materials. Sibling fractions can
be processed to supply a co-input of the current frontier before they are recombined.
Initial extra-ingredient searches are bounded to 20,000 processed labels and three million exploration
checks. Histories per intermediate are twice the requested route count (up to 100); equivalent
histories can reach the requested count rather than being silently cut off at three. The initial
12,000-state frontier is trimmed to its best half when necessary. Broader requests scale work and
processed-state budgets, with at most a 24,000-state pending frontier. Strict search explores
combinations of excluded proof steps, rather than only one-step exclusions from its first proof.
Results say **more may
exist** when route/history caps apply. If the budget is reached without a verified route, the page says
so explicitly; it does not claim there is no possible conversion.

On screens at least 1,000 pixels wide, recipe steps run left to right in a dedicated horizontal scroll
region. Smaller screens retain the vertical step list.

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

Regression examples include the invalid Pu241 → borrowed/recovered tungsten → Pu239 path and the
invalid oil → lubricant → recovered cell → externally supplied diesel path. The actual 2.9.0 oil
search now finds source-dependent distillation/fuel-processing/mixing procedures; their co-inputs
remain explicit. This is still a conservative procedural dependency test, not molecular tracing.

The broader-search regression compares a synthetic 18-route graph with a shared intermediate, verifies
all 18 are recoverable with a 25-route request, and covers strict enumeration beyond five alternatives.
On actual 2.9.0 oil → cetane-boosted diesel data, the previous deployment found 2 routes; the broader
initial search found 8, the 25-route request found 20, and the 50-route request found 23 in controlled
repository tests. These remain bounded procedural results, not an exhaustive census.
