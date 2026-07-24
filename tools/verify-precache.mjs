import { readFile } from 'node:fs/promises';

const serviceWorker = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
const urls = [...serviceWorker.matchAll(/\burl:"([^"]+)"/g)].map((match) => match[1]);
const duplicates = [...new Set(urls.filter((url, index) => urls.indexOf(url) !== index))];

if (duplicates.length > 0) {
  throw new Error(`Duplicate service-worker precache entries: ${duplicates.join(', ')}`);
}
