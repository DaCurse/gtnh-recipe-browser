import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'assets/inventory-slot.webp', 'assets/Minecraft.ttf', 'assets/gtnh-logo.png', 'assets/gtnh-logo-192.png'],
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
        globPatterns: ['**/*.{js,css,html,ttf}'],
        navigateFallback: 'index.html'
      }
    })
  ]
});
