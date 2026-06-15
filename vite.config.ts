/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  // Served from the domain root for now (hosting is decided later). If the app is
  // ever hosted under a sub-path, change this to '/sub-path/'.
  base: '/',
  // Stamp the build time into the bundle so the home screen can show which build
  // is running (lets you spot a stale cache after a deploy).
  define: { __BUILD_AT__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    tsconfigPaths(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Coco',
        short_name: 'Coco',
        description: 'Личный помощник: финансы, заметки, люди, одежда, калькулятор',
        lang: 'ru',
        theme_color: '#7B4B2A',
        background_color: '#f3ede5',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/eruda-*.js'], // debug-only, big — don't precache
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'coco-uploads',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'esnext',
  },
  server: {
    // Expose the dev server on the local network so a phone / ngrok can reach it.
    host: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.js'],
  },
});
