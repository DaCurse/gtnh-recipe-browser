# GTNH Recipe Browser

[Open the browser](https://dacurse.github.io/gtnh-recipe-browser/)

An out-of-game recipe and quest browser for GregTech: New Horizons.

- **Item catalogue.** Searchable items and fluids with tooltips, machine-specific recipe layouts, and Recipes, Usages, and Machine Usages tabs.
- **Recipe Finder.** Add any known inputs or outputs to find matching recipes across machines. Switch to **Recipe Chain** to explore a sequence of recipes from a starting ingredient to a target.
- **Quest Book.** Browse the GTNH quest book.
- **Offline browsing.** Choose a GTNH version from the version menu and download its dataset for use without a connection.

## Development

This project uses AI assistance to accelerate development and iterate quickly.

With Node.js 22:

```sh
npm ci
npm run dev
npm run quality
```

Use `npm run pack -- --help` for pack builder options. [Data export guide](docs/exporting-current-data.md) · [Export runbook](docs/agent-data-export-runbook.md) · [Architecture](docs/architecture.md) · [GitHub Pages deployment](docs/github-pages.md)

## Credits and analytics

- Upstream exporter and browser work by ShadowTheAge ([MIT license](gtnh@ShadowTheAge/LICENSE)).
- [GTNH Shadow UI](https://github.com/Ranzuu/Shadow-UI) by Ranzu, CC BY-NC-SA 4.0. [Texture credits](assets/source/machine-ui/README.md)
- [Minecraft Font](https://github.com/IdreesInc/Minecraft-Font) by Idrees Hassan, SIL OFL 1.1. [Font credits](assets/source/minecraft-pixel-font/PROVENANCE.md)
- Minecraft, GTNH, and mod assets belong to their respective owners.
- Production uses PostHog. [Analytics and collection controls](docs/analytics.md)
