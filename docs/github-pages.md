# GitHub Pages and search visibility

The primary public address is https://dacurse.github.io/gtnh-recipe-browser/.
The source repository's `Publish GitHub Pages` workflow builds every push to
`master`, uploads the `dist` artifact, and deploys it to the `github-pages`
environment using GitHub's official Pages actions. It can also be run manually
from Actions. Repository Settings > Pages must use **GitHub Actions** as its
source. No separate deployment repository or long-lived deploy credential is needed.

The relative Vite base preserves both the `/gtnh-recipe-browser/` deployment and
the existing Netlify deployment. Query-based item, finder, and chain links
retain that base. Service workers are scoped to the project path. PostHog is
enabled only for this Pages project path.

The Pages address is canonical; the former Netlify entry point redirects here. The initial HTML includes
descriptive content, crawlable tool links, title and description, social preview
metadata, and WebApplication structured data. The interactive home page also
shows the introduction. The sitemap deliberately lists the main entry point,
not every filter combination or transient query. These changes improve crawling
and presentation; a hosting provider change does not guarantee better rankings.

Submit https://dacurse.github.io/gtnh-recipe-browser/sitemap.xml to Google Search
Console using a URL-prefix property for
https://dacurse.github.io/gtnh-recipe-browser/. This requires access to the owner's
Search Console account. A project site's `/gtnh-recipe-browser/robots.txt` is not
the origin-level `/robots.txt` used by crawlers; the included file also serves the
Netlify root, while Pages sitemap discovery uses direct submission or links.
No unrelated user-site repository or root robots file is modified.

Verification: `npm run quality`, deployment smoke tests against the subpath,
and browser checks for fonts, icons, worker requests, query links, service
worker scope, offline refresh, and analytics host/path filtering.
