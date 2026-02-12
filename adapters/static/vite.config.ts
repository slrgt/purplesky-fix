/**
 * Vite config for the Static Site Generation (SSR → HTML) build.
 *
 * Used by `npm run build.server` to produce static HTML via Qwik's static adapter.
 * This runs AFTER the client build and generates pre-rendered HTML pages.
 */

import { defineConfig, type Plugin } from 'vite';
import { qwikVite } from '@builder.io/qwik/optimizer';
import { qwikCity } from '@builder.io/qwik-city/vite';
import { staticAdapter } from '@builder.io/qwik-city/adapters/static/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

const base = process.env.VITE_BASE_PATH ?? '/purplesky-fix/';
const origin = process.env.VITE_ORIGIN ?? 'https://github.io';

/**
 * Vite plugin that rewrites manifest.json after the build copies it,
 * replacing "./" with the actual base path so PWA install
 * works correctly on any domain / subpath.
 */
function pwaManifestPlugin(basePath: string): Plugin {
  return {
    name: 'pwa-manifest-base',
    apply: 'build',
    async writeBundle(opts) {
      const outDir = opts.dir;
      if (!outDir) return;
      const { readFileSync, writeFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const manifestPath = join(outDir, 'manifest.json');
      if (!existsSync(manifestPath)) return;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (manifest.start_url === './' || manifest.start_url === '.') manifest.start_url = basePath;
        if (manifest.scope === './' || manifest.scope === '.') manifest.scope = basePath;
        if (Array.isArray(manifest.icons)) {
          for (const icon of manifest.icons) {
            if (typeof icon.src === 'string' && icon.src.startsWith('./')) {
              icon.src = basePath + icon.src.slice(2);
            }
          }
        }
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      } catch { /* leave manifest unchanged if parse fails */ }
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    qwikCity(),
    qwikVite(),
    wasm(),
    topLevelAwait(),
    staticAdapter({
      origin,
    }),
    pwaManifestPlugin(base),
  ],
  resolve: {
    alias: {
      '~': '/src',
    },
  },
  build: {
    ssr: true,
    outDir: 'server',
    rollupOptions: {
      input: ['src/entry.ssr.tsx', '@qwik-city-plan'],
    },
  },
  optimizeDeps: {
    exclude: ['purplesky-wasm'],
  },
});
