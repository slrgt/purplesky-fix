/**
 * Base path for deployment (e.g. GitHub Pages: /repo-name/).
 * Vite replaces import.meta.env.BASE_URL at build time.
 */

/**
 * Normalized base path with leading slash, no trailing slash (e.g. '/purplesky-fix').
 * Returns '' when app is at root. Ensures nav() and &lt;a href&gt; resolve to the
 * correct absolute path; without leading slash, relative resolution doubles the segment.
 */
export function getBasePath(): string {
  const b = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  if (!b || b === '/') return b;
  return b.startsWith('/') ? b : `/${b}`;
}

/**
 * Prefix an internal path with the app base path (absolute from origin).
 * Use for all client-side nav(), &lt;Link href&gt;, and &lt;a href&gt; to in-app routes.
 */
export function withBase(path: string): string {
  const base = getBasePath();
  if (!base) return path === '/' ? '/' : path;
  return path === '/' ? `${base}/` : `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
