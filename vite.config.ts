import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives in web/ and reads the resolved catalog straight from data/catalog.json.
// base './' keeps the build portable (GitHub Pages subpath, Cloudflare Pages, any static host).
// Two pages, both in web/: the game, and the stats page (served at /stats).
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  // 'localhost' is IPv6-only on macOS, so pin the address the README and the room server (127.0.0.1:8787) use.
  server: { host: '127.0.0.1' },
  build: { outDir: '../dist', emptyOutDir: true, rolldownOptions: { input: { main: 'index.html', stats: 'stats.html' } } },
});
