import { readFile } from 'node:fs/promises';

const serviceWorker = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
const urls = [...serviceWorker.matchAll(/\burl:"([^"]+)"/g)].map((match) => match[1]);
const duplicates = [...new Set(urls.filter((url, index) => urls.indexOf(url) !== index))];

if (duplicates.length > 0) {
  throw new Error(`Duplicate service-worker precache entries: ${duplicates.join(', ')}`);
}

const document = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (!document.includes('data-startup-shell') || !document.includes('Your Pocket NEI')) {
  throw new Error('Missing prerendered startup shell');
}
if (/\b(?:src|href)="\/assets\//.test(document)) {
  throw new Error('Startup assets must work under the GitHub Pages subdirectory');
}
for (const font of ['minecraft-pixel.woff2', 'minecraft-pixel-bold.woff2']) {
  if (
    !Array.from(document.matchAll(/<link\b[^>]*>/g), ([tag]) => tag).some(
      (tag) => tag.includes(`href="./assets/${font}"`) && /\bas="font"/.test(tag),
    )
  )
    throw new Error(`Missing font preload: ${font}`);
}

if (document.includes('\u00e2\u20ac') || document.includes('\u00c2\u00b7')) {
  throw new Error('Incorrect UTF-8 encoding in the startup document');
}
