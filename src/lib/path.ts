/**
 * Base path for deployment (e.g. GitHub Pages: /repo-name/).
 * Vite replaces import.meta.env.BASE_URL at build time.
 */

/** Normalized base path without trailing slash, or '' when base is / */
export function getBasePath(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  return base;
}

/**
 * Prefix an internal path with the app base path.
 * Use for all client-side nav(), &lt;Link href&gt;, and &lt;a href&gt; to in-app routes
 * so links work when the app is deployed at a subpath (e.g. GitHub Pages).
 */
export function withBase(path: string): string {
  const base = getBasePath();
  return path === '/' ? `${base}/` : `${base}${path}`;
}
