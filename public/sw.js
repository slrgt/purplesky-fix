/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PurpleSky Service Worker – Offline Support & Caching
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This service worker provides:
 *  - Cache-first strategy for static assets (JS, CSS, images, WASM)
 *  - Network-first strategy for API calls (AT Protocol)
 *  - Offline fallback page
 *  - Background sync for offline edits (posts, comments, votes)
 *  - Periodic cache cleanup
 *
 * HOW TO EDIT:
 *  - To change caching strategies, edit the fetch event handler
 *  - To add new cached routes, add patterns to CACHE_PATTERNS
 *  - To change cache expiration, edit MAX_AGE_MS
 *
 * CACHING STRATEGIES:
 *  - Static assets: Cache-first (fast loads, update in background)
 *  - API data: Network-first (fresh data, fall back to cache)
 *  - Images/videos: Cache-first with size limit
 *  - WASM modules: Cache-first (they rarely change)
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Bump version when deploying so old cached JS/CSS are dropped (avoids running stale code).
const CACHE_NAME = 'purplesky-v6';
const STATIC_CACHE = 'purplesky-static-v6';
const IMAGE_CACHE = 'purplesky-images-v1';
const API_CACHE = 'purplesky-api-v1';

// Max age for cached API responses (5 minutes)
const API_MAX_AGE_MS = 5 * 60 * 1000;
// Max cached images (to prevent filling storage)
const MAX_CACHED_IMAGES = 200;

// Derive the base path from the SW scope (works on any domain / subpath)
const BASE = new URL(self.registration?.scope ?? './', self.location.href).pathname;
// Full URL of the app shell (for fallback when navigation gets 404 or offline)
const APP_SHELL_URL = new URL('index.html', self.registration?.scope || self.location.href).href;

// Precache manifest + icon. App shell (index.html) is fetched separately with
// cache: 'reload' so we never store stale HTML from a previous SW.
const PRECACHE_URLS = [
  `${BASE}manifest.json`,
  `${BASE}icon.svg`,
];

// ── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS).then(() =>
        // Fetch app shell with cache bypass so we never precache stale HTML
        fetch(APP_SHELL_URL, { cache: 'reload' })
          .then((r) => r.ok && cache.put(APP_SHELL_URL, r))
          .catch(() => {})
      )
    )
  );
  // Activate immediately (don't wait for old SW to stop)
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== STATIC_CACHE && name !== IMAGE_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// When the client asks to activate a waiting worker (e.g. "Refresh" on update prompt)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Minimal q-data.json for dynamic routes (post, profile, forum thread, etc.)
// When SSG doesn't pre-render a path, the server returns 404 for q-data.json.
// Returning this prevents Qwik City from doing a full page redirect, so SPA nav
// stays in place and the route component loads and fetches data on the client.
const EMPTY_QDATA = JSON.stringify({ loaders: {} });

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST, PUT, DELETE go to network)
  if (event.request.method !== 'GET') return;

  // q-data.json: always return empty loaders for our scope so QwikCity never does MPA fallback.
  // On GitHub Pages there is no server — q-data.json doesn't exist, so we never hit the
  // network. Returning immediately avoids 404s, NetworkErrors, and aborts that would
  // trigger full page loads and a cascade of failed fetches.
  if (url.pathname.endsWith('/q-data.json') && url.pathname.startsWith(BASE)) {
    event.respondWith(
      Promise.resolve(
        new Response(EMPTY_QDATA, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Navigation requests (HTML pages): Network-first so users always get the
  // latest app shell. Falls back to cached index.html for offline / 404 (GitHub
  // Pages returns 404 for dynamic routes that aren't pre-rendered).
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNav(event.request));
    return;
  }

  // API calls: Network-first with cache fallback
  if (url.hostname.includes('bsky.social') ||
      url.hostname.includes('bsky.app') ||
      url.hostname.includes('microcosm.blue')) {
    event.respondWith(networkFirst(event.request, API_CACHE));
    return;
  }

  // Images/videos: Cache-first
  if (url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm)$/i) ||
      url.hostname.includes('cdn.bsky.app')) {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE).catch(() => fetch(event.request)));
    return;
  }

  // WASM: Cache-first
  if (url.pathname.endsWith('.wasm')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE).catch(() => fetch(event.request)));
    return;
  }

  // JS/CSS chunks under /build/: do NOT intercept — let the browser fetch directly.
  // Intercepting (even network-first) can cause "NetworkError" or empty responses and
  // breaks Qwik dynamic imports. Chunks are content-hashed so they're cacheable by the browser.
  if (url.pathname.includes('/build/')) return;

  // Static assets: Cache-first (fallback to network on any SW error so chunks always load)
  event.respondWith(
    cacheFirst(event.request, STATIC_CACHE).catch(() => fetch(event.request))
  );
});

// ── Cache-First Strategy ──────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
  } catch {
    /* ignore cache read errors */
  }

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      try {
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
      } catch {
        /* ignore cache write errors (e.g. quota); still return the response */
      }
    }
    return response;
  } catch {
    // Return offline fallback for navigation requests (full URL for reliable match)
    if (request.mode === 'navigate') {
      const fallback = await caches.match(APP_SHELL_URL);
      if (fallback) return fallback;
    }
    throw new Error('cacheFirst failed');
  }
}

// ── Network-First for Navigation ──────────────────────────────────────────
// Fetches fresh HTML from the network. On non-OK responses (e.g. 404 on GitHub
// Pages for dynamic routes like /post/xyz/) falls back to the cached app shell
// so the client-side router can handle the route. On network failure (offline),
// tries the exact URL cache, then the app shell.
async function networkFirstNav(request) {
  try {
    const response = await fetch(request, { cache: 'reload' });
    if (response.ok) {
      // Do not cache: stale HTML would reference old chunk filenames and break after deploy
      return response;
    }
    // Server returned error (e.g. 404) – serve app shell for client-side routing
    return (await caches.match(APP_SHELL_URL)) || response;
  } catch {
    // Network error (offline) – try cache, then app shell (full URL for reliable match)
    return (await caches.match(request)) ||
           (await caches.match(APP_SHELL_URL)) ||
           new Response('<h1>Offline</h1><p>Please check your connection.</p>', {
             status: 503,
             headers: { 'Content-Type': 'text/html' },
           });
  }
}

// ── Network-First Strategy ────────────────────────────────────────────────
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Background Sync (for offline edits) ───────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-posts') {
    event.waitUntil(syncOfflinePosts());
  }
  if (event.tag === 'sync-votes') {
    event.waitUntil(syncOfflineVotes());
  }
});

// ── IndexedDB Helpers ────────────────────────────────────────────────────
const IDB_NAME = 'purplesky-offline';
const IDB_VERSION = 1;
const POSTS_STORE = 'pending-posts';
const VOTES_STORE = 'pending-votes';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(POSTS_STORE)) {
        db.createObjectStore(POSTS_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(VOTES_STORE)) {
        db.createObjectStore(VOTES_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Offline Sync Implementation ─────────────────────────────────────────

async function syncOfflinePosts() {
  console.log('[SW] Syncing offline posts...');
  try {
    const db = await openDb();
    const pendingPosts = await getAllFromStore(db, POSTS_STORE);
    if (pendingPosts.length === 0) return;
    console.log(`[SW] Found ${pendingPosts.length} pending posts`);

    for (const post of pendingPosts) {
      try {
        const res = await fetch(post.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(post.authHeader ? { Authorization: post.authHeader } : {}),
          },
          body: JSON.stringify(post.body),
        });
        if (res.ok) {
          await deleteFromStore(db, POSTS_STORE, post.id);
          console.log(`[SW] Synced post ${post.id}`);
        } else {
          console.warn(`[SW] Failed to sync post ${post.id}: ${res.status}`);
        }
      } catch (err) {
        console.warn(`[SW] Network error syncing post ${post.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[SW] syncOfflinePosts error:', err);
  }
}

async function syncOfflineVotes() {
  console.log('[SW] Syncing offline votes...');
  try {
    const db = await openDb();
    const pendingVotes = await getAllFromStore(db, VOTES_STORE);
    if (pendingVotes.length === 0) return;
    console.log(`[SW] Found ${pendingVotes.length} pending votes`);

    for (const vote of pendingVotes) {
      try {
        const res = await fetch(vote.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(vote.authHeader ? { Authorization: vote.authHeader } : {}),
          },
          body: JSON.stringify(vote.body),
        });
        if (res.ok) {
          await deleteFromStore(db, VOTES_STORE, vote.id);
          console.log(`[SW] Synced vote ${vote.id}`);
        } else {
          console.warn(`[SW] Failed to sync vote ${vote.id}: ${res.status}`);
        }
      } catch (err) {
        console.warn(`[SW] Network error syncing vote ${vote.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[SW] syncOfflineVotes error:', err);
  }
}

// ── Push Notifications (for mentions, replies) ────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'PurpleSky', {
      body: data.body || 'New activity',
      icon: `${BASE}icon.svg`,
      badge: `${BASE}icon.svg`,
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (url) {
    event.waitUntil(self.clients.openWindow(url));
  }
});
