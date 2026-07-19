# ShadowTheAge format-v5 compatibility fixture

These two files are immutable local regression inputs. They intentionally do not depend on the current checkout of
the `gtnh@ShadowTheAge` submodule, because that project and its nested data submodule may move to a newer format.

When a new upstream format is supported, add a new sibling fixture directory instead of replacing this one. Keep
the decoder tests for every supported input format and record exact provenance, byte sizes, and SHA-256 hashes.

The data includes names, tooltips, recipes, and icons originating from Minecraft, GTNH, and individual mods. It is
retained solely for non-commercial interoperability and regression testing; this repository claims no ownership.
