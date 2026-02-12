/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OAuth Authentication for Bluesky
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Handles "Log in with Bluesky" OAuth flow:
 *  - Builds client_id based on environment (localhost vs production)
 *  - Initializes BrowserOAuthClient
 *  - Processes OAuth callback after redirect
 *  - Restores sessions by DID
 *
 * HOW TO EDIT:
 *  - Update the client_id in public/client-metadata.json for production
 *  - The redirect_uri must match what's in client-metadata.json
 *  - For local dev, loopback client_id is auto-generated
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

let client: BrowserOAuthClient | null = null;

/** Get the app's base URL (origin + base path only). Uses BASE_URL so client-metadata is always at app root, not under deep routes. */
function getAppBaseUrl(): string {
  const u = new URL(window.location.href);
  const base = (typeof import.meta.env !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const basePath = base.replace(/\/$/, '').replace(/^\//, '') || '';
  return basePath ? `${u.origin}/${basePath}` : u.origin;
}

/** Check if running on localhost (development). */
function isLoopback(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** Build loopback client_id for development. */
function getLoopbackClientId(): string {
  const u = new URL(window.location.href);
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  // Use the base path (strip trailing file names) so redirect works correctly
  let path = u.pathname.replace(/\/index\.html$/, '');
  if (!path.endsWith('/')) path += '/';
  const redirectUri = `http://${host}:${port}${path}`;
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('atproto transition:generic')}`;
}

/** Load or create the OAuth client (cached). */
export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === 'undefined') throw new Error('OAuth is browser-only');
  if (client) return client;

  const clientId = isLoopback()
    ? getLoopbackClientId()
    : `${getAppBaseUrl()}/client-metadata.json`;

  // Use the public Bluesky AppView as handle resolver – this resolves handles
  // from ALL PDS instances in the AT Protocol network, not just bsky.social.
  // The AppView indexes the entire network so any valid AT Protocol handle
  // (e.g. user.bsky.social, user.custom-domain.com) will be resolved.
  client = await BrowserOAuthClient.load({
    clientId,
    handleResolver: 'https://api.bsky.app/',
    responseMode: 'query',
  });
  return client;
}

/**
 * Normalize a handle input for OAuth login.
 * - Strips leading '@'
 * - Appends '.bsky.social' if no domain part is present
 * - Lowercases the result
 */
export function normalizeHandle(input: string): string {
  let h = input.trim().toLowerCase();
  if (h.startsWith('@')) h = h.slice(1);
  // If there's no '.' in the handle, assume it's a bsky.social account
  if (!h.includes('.')) h = `${h}.bsky.social`;
  return h;
}

export type OAuthSession = import('@atproto/oauth-client').OAuthSession;

/**
 * Initialize OAuth: restore existing session or process callback after redirect.
 * Call this on app startup.
 *
 * Includes a concurrency guard so that multiple calls (e.g. from racing
 * useVisibleTask$ hooks) share a single in-flight request instead of
 * creating parallel BrowserOAuthClient.init() calls that fight each other.
 */
let _initPromise: Promise<{ session: OAuthSession; state?: string | null } | undefined> | null = null;

export async function initOAuth(options?: {
  hasCallback?: boolean;
  preferredRestoreDid?: string;
}): Promise<{ session: OAuthSession; state?: string | null } | undefined> {
  // If an init is already in flight, reuse it (prevents duplicate processing)
  if (_initPromise) return _initPromise;

  _initPromise = _doInitOAuth(options);
  try {
    return await _initPromise;
  } finally {
    _initPromise = null;
  }
}

async function _doInitOAuth(options?: {
  hasCallback?: boolean;
  preferredRestoreDid?: string;
}): Promise<{ session: OAuthSession; state?: string | null } | undefined> {
  const oauth = await getOAuthClient();

  // Check if we're returning from an OAuth redirect
  const hasCallback =
    options?.hasCallback ??
    (() => {
      const params = new URLSearchParams(window.location.search);
      return params.has('state') && (params.has('code') || params.has('error'));
    })();

  if (hasCallback) return oauth.init();

  // Try to restore a specific DID's session
  if (options?.preferredRestoreDid) {
    try {
      const session = await oauth.restore(options.preferredRestoreDid, true);
      return { session };
    } catch { return undefined; }
  }

  return oauth.init();
}

/** Restore a specific OAuth session by DID (for account switching). */
export async function restoreOAuthSession(did: string): Promise<OAuthSession | null> {
  try {
    const oauth = await getOAuthClient();
    return await oauth.restore(did, true);
  } catch { return null; }
}

/** Start OAuth sign-in – redirects to the user's PDS. Never returns. */
export async function signInWithOAuthRedirect(handle: string): Promise<never> {
  const oauth = await getOAuthClient();
  const normalized = normalizeHandle(handle);
  return oauth.signInRedirect(normalized);
}
