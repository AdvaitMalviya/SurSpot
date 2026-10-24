import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { cloudflare } from "@cloudflare/vite-plugin";

// The app lives in web/ and reads the resolved catalog straight from data/catalog.json.
// base './' keeps the build portable (GitHub Pages subpath, Cloudflare Pages, any static host).
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react(), cloudflare()],
  build: { outDir: '../dist', emptyOutDir: true },
});