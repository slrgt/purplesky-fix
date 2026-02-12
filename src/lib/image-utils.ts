/**
 * Return a URL that serves the image resized to the given pixel size (1x).
 * Uses a public resize proxy so the browser doesn't download full-size avatars
 * when displaying small (e.g. 20x20 or 24x24) to fix "properly size image" perf.
 * Requested size is 2x for sharpness on retina.
 */
export function resizedAvatarUrl(originalUrl: string | undefined | null, displaySizePx: number): string {
  if (!originalUrl || !originalUrl.startsWith('http')) return originalUrl ?? '';
  const size = Math.min(256, Math.max(displaySizePx * 2, 40)); // 2x for retina, cap 256
  const encoded = encodeURIComponent(originalUrl);
  return `https://wsrv.nl/?url=${encoded}&w=${size}&h=${size}&fit=cover`;
}
