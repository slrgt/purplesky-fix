import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// GitHub Pages: base path is repo name. Override with ASTRO_BASE_PATH env in CI.
const base = process.env.ASTRO_BASE_PATH ?? '/purplesky-fix/';

export default defineConfig({
  base,
  site: process.env.ASTRO_ORIGIN ?? 'https://github.io',
  integrations: [preact()],
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    resolve: {
      alias: {
        '~': '/src',
      },
    },
    build: {
      target: 'es2020',
    },
  },
});
