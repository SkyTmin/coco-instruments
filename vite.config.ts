/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  // Served from the domain root for now (hosting is decided later). If the app is
  // ever hosted under a sub-path, change this to '/sub-path/'.
  base: '/',
  plugins: [
    react(),
    tsconfigPaths(),
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
    include: ['src/**/*.test.ts'],
  },
});
