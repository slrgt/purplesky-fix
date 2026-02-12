/**
 * Static Site Generation for PurpleSky.
 *
 * Creates an HTML shell that boots the Qwik app client-side.
 * All data loading happens in useVisibleTask$ (browser only),
 * so we only need the HTML shell + Qwik loader + asset references.
 */

import { writeFileSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const basePath = process.env.VITE_BASE_PATH || '/purplesky-1/';
const clientDir = join(root, 'dist', basePath.replace(/^\/|\/$/g, ''));
const outDir = join(root, 'dist');

function generate() {
  if (!existsSync(clientDir)) {
    console.error('Client build not found at', clientDir);
    process.exit(1);
  }

  // Read the q-manifest for CSS injections
  const manifestPath = join(clientDir, 'q-manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : {};

  // Collect CSS from manifest injections
  const cssLinks = (manifest.injections || [])
    .filter(i => i.tag === 'link' && i.attributes?.rel === 'stylesheet')
    .map(i => i.attributes.href);

  // Read Qwik loader source for inline embedding
  const qwikLoaderPath = join(root, 'node_modules/@builder.io/qwik/dist/qwikloader.js');
  const qwikLoader = existsSync(qwikLoaderPath) ? readFileSync(qwikLoaderPath, 'utf-8') : '';

  // Collect entry bundles for prefetching
  const bundles = Object.keys(manifest.bundles || {});
  const prefetch = bundles.slice(0, 30).map(f => `${basePath}build/${f}`);

  const html = `<!DOCTYPE html>
<html lang="en" q:container="paused" q:version="${manifest.version || '1.12.1'}" q:render="static" q:base="${basePath}build/">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#7C3AED" />
  <title>PurpleSky</title>
  <meta name="description" content="PurpleSky – Bluesky PWA for art, forums, consensus and collaboration" />
  <link rel="icon" href="${basePath}icon.svg" type="image/svg+xml" />
  <link rel="manifest" href="${basePath}manifest.json" />
  <link rel="apple-touch-icon" href="${basePath}icon.svg" />
${cssLinks.map(h => `  <link rel="stylesheet" href="${h}" />`).join('\n')}
${prefetch.map(h => `  <link rel="modulepreload" href="${h}" />`).join('\n')}
  <style>
    body{margin:0;background:#0D0D0F;color:#E0DEE6;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .boot-center{display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px}
    .boot-spinner{width:32px;height:32px;border:3px solid rgba(124,58,237,.3);border-top-color:#7C3AED;border-radius:50%;animation:sp .7s linear infinite}
    @keyframes sp{to{transform:rotate(360deg)}}
    .boot-text{font-size:14px;opacity:.6}
  </style>
</head>
<body>
  <div class="boot-center" id="boot-screen">
    <div class="boot-spinner"></div>
    <div class="boot-text">Loading PurpleSky…</div>
  </div>
  <script>${qwikLoader}</script>
  <script type="module">
    // Boot the Qwik app: import the main chunk which triggers the full app load
    const base = "${basePath}build/";
    // Import all entry chunks to kickstart the app
    ${bundles.slice(0, 5).map(f => `import(base + "${f}").catch(() => {});`).join('\n    ')}
    // Remove boot screen after a short delay
    setTimeout(() => {
      const el = document.getElementById("boot-screen");
      if (el) el.style.display = "none";
    }, 3000);
  </script>
</body>
</html>`;

  writeFileSync(join(clientDir, 'index.html'), html, 'utf-8');
  console.log(`Generated: ${join(clientDir, 'index.html')}`);

  writeFileSync(join(clientDir, '404.html'), html, 'utf-8');
  console.log(`Generated: ${join(clientDir, '404.html')}`);

  // Root redirect
  writeFileSync(
    join(outDir, 'index.html'),
    `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${basePath}"></head><body></body></html>`,
    'utf-8'
  );
  console.log(`Generated redirect: ${join(outDir, 'index.html')}`);
  copyFileSync(join(clientDir, '404.html'), join(outDir, '404.html'));
  console.log(`Generated: ${join(outDir, '404.html')}`);

  // Copy public assets into dist
  const publicDir = join(root, 'public');
  for (const file of ['sw.js', 'manifest.json', 'icon.svg', 'client-metadata.json']) {
    const src = join(publicDir, file);
    const dest = join(clientDir, file);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`Copied: ${file}`);
    }
  }

  console.log('\nSSG complete!');
}

generate();
