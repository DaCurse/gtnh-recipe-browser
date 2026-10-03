import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// One token identifies the shell and worker, including changes to either side.
function shellSources(directory: string): string {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => entry.isDirectory() ? shellSources(`${directory}/${entry.name}`)
      : readFileSync(`${directory}/${entry.name}`, 'utf8')).join('');
}
const shellRevision = createHash('sha256').update(shellSources('src'))
  .update(readFileSync('public/sw-takeover.js')).digest('hex').slice(0, 16);

export default defineConfig({
  define: { __SHELL_REVISION__: JSON.stringify(shellRevision) },
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: [
        'favicon.ico',
        'assets/inventory-slot.webp',
        'assets/gtnh-logo.png',
        'assets/gtnh-logo-192.png'
      ],
      manifest: {
        name: 'GTNH Recipe Browser',
        short_name: 'GTNH Recipes',
        description: 'A fast, offline-friendly GTNH recipe browser',
        theme_color: '#17181b',
        background_color: '#111214',
        display: 'standalone',
        start_url: './',
        icons: [
          {
            src: 'assets/gtnh-logo-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'assets/gtnh-logo.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        clientsClaim: false,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,otf}'],
        navigateFallback: 'index.html',
        importScripts: [`sw-takeover.js?revision=${shellRevision}`]
      }
    })
  ]
});
