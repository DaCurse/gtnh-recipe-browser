# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the Svelte 5 + TypeScript application. Reusable UI and data modules live in `src/lib/`; the search worker is in `src/workers/`.
- `tools/pack-builder/` decodes ShadowTheAge format-v5 exports and creates deterministic MessagePack recipe shards and WebP sprite sheets.
- `tests/` contains Vitest suites. Immutable upstream compatibility inputs and provenance are under `tests/fixtures/`.
- `public/` contains the PWA assets, version index, and generated real-data pack served by Vite.
- `assets/source/` preserves supplied source artwork. Use optimized copies from `public/assets/` in the app.
- `gtnh@ShadowTheAge/` is a read-only upstream submodule. Do not edit or commit changes inside it.

## Build, Test, and Development Commands

```sh
npm install          # Install locked dependencies
npm run dev          # Start local Vite development
npm run dev:lan      # Expose HTTP development server to phones on the LAN
npm run check        # Run Svelte and TypeScript diagnostics
npm test             # Run all Vitest suites once
npm run build        # Produce the PWA in dist/
```

Use `npm run pack -- --help` conventions documented in `README.md` to generate datasets. Run `npm run verify-pack -- --pack <dir> --atlas <file>` before publishing or committing generated assets.

## Coding Style & Naming Conventions

Use TypeScript with strict types and two-space indentation. Prefer small Svelte components, plain interfaces, and descriptive camelCase functions and variables. Components use PascalCase filenames such as `RecipeGrid.svelte`; tests use `*.test.ts`.

No automatic formatter or linter is configured. Match surrounding style, use semicolons in TypeScript, and run `npm run check` before committing. Never use raw upstream tooltip HTML without explicit sanitization.

## Testing Guidelines

Vitest is the unit-test framework. Add focused tests for decoder validation, search behavior, recipe slot layouts, hashes, and deterministic output. Preserve existing format fixtures when introducing a new upstream shape; add a new versioned fixture directory instead of replacing one.

## Dataset Export Work

Before preparing or publishing a GTNH dataset, read `docs/agent-data-export-runbook.md`. Keep both ShadowTheAge submodules read-only, use native WSL dependencies, and stop at the documented manual Prism checkpoint rather than touching an existing player instance.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects, primarily `feat:` and `fix:`. Keep commits scoped and imperative, for example `fix: preserve shaped recipe slots`.

Pull requests should include a concise behavior summary, verification commands, related issue links, and desktop/mobile screenshots for visual changes. Call out generated pack changes, asset-size impact, schema changes, and compatibility-fixture additions explicitly.
