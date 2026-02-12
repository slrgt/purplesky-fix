/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Feed Page (Home) – Masonry Grid of Posts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the main page users see. It displays a masonry grid of images
 * and videos from Bluesky feeds, with:
 *  - Configurable column count (1/2/3)
 *  - Feed mixing (show percentages from different feeds)
 *  - Infinite scroll with smart prefetching
 *  - Pull-to-refresh
 *  - Seen post tracking (mark posts as seen when scrolled past)
 *  - Hide/show seen posts toggle
 *  - Art-only and media-only filters
 *  - Sorting via WASM (newest, trending, Wilson score, controversial)
 *
 * HOW TO EDIT:
 *  - To change the default sort order, edit the initial sortMode value
 *  - To add a new filter, add a state variable and filter logic
 *  - The masonry layout is handled by the MasonryFeed component
 *  - Feed mixing is configured in the FeedSelector component
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useVisibleTask$, useStore, $ } from '@builder.io/qwik';
import { useNavigate } from '@builder.io/qwik-city';
import { useAppState } from '~/context/app-context';
import { PostCard } from '~/components/post-card/post-card';
import { FeedSelector } from '~/components/feed-selector/feed-selector';
import type { TimelineItem } from '~/lib/types';
import { withBase } from '~/lib/path';
import * as bsky from '~/lib/bsky';

import './feed.css';

// ── Feed Cache ────────────────────────────────────────────────────────────
// Module-level cache that survives route changes (QwikCity SPA navigation
// keeps the same JS context). When the user navigates back to the feed,
// the cached items render instantly so scroll position can be restored.
const feedCache: {
  items: TimelineItem[];
  cursors: Record<string, string>;
  sortedItems: TimelineItem[];
  forDid: string | null; // track which account the cache belongs to
} = { items: [], cursors: {}, sortedItems: [], forDid: null };

export default component$(() => {
  const app = useAppState();
  const nav = useNavigate();

  // ── Keyboard Focus State ────────────────────────────────────────────────
  /** Index of keyboard-focused post in displayItems (-1 = none) */
  const focusedIndex = useSignal(-1);
  const keyboardNavActive = useSignal(false);
  /** Index of card under the mouse (-1 = none); keeps hover look during keyboard nav */
  const mouseOverIndex = useSignal(-1);

  // ── Feed State ──────────────────────────────────────────────────────────
  /** Cursors: for mixed feed use keys like 'timeline', at://... */
  const feed = useStore<{
    items: TimelineItem[];
    loading: boolean;
    cursors: Record<string, string>;
    error: string | null;
    restoredFromCache: boolean;
  }>({
    items: [],
    loading: true,
    cursors: {},
    error: null,
    restoredFromCache: false,
  });

  /** Which sort algorithm to use */
  const sortMode = useSignal<'newest' | 'trending' | 'wilson' | 'score' | 'controversial'>('newest');

  /** Set of seen post URIs (tracked locally) */
  const seenPosts = useSignal<Set<string>>(new Set());


  /** URIs hidden by "hide seen" this session; long-press restores by clearing this */
  const hiddenSeenUris = useSignal<Set<string>>(new Set());

  /** Set by long-press so the following click doesn't trigger hide again */
  const skipNextHideClick = useSignal(false);

  /** Downvote counts per post URI (from Microcosm); populated after feed loads */
  const downvoteCounts = useSignal<Record<string, number>>({});

  /** Sorted+filtered items (after WASM sort); used for grid display */
  const sortedDisplayItems = useSignal<TimelineItem[]>([]);

  /** Show feed selector panel */
  const showFeedSelector = useSignal(false);

  /** Map post URI -> downvote record URI (for "I downvoted" state and undo) */
  const myDownvoteUris = useSignal<Record<string, string>>({});

  /** Artboards for "Save to collection" dropdown */
  const artboardsList = useSignal<Array<{ id: string; name: string }>>([]);

  /** Set of post URIs that are in at least one artboard (for card outline) */
  const inAnyArtboardUris = useSignal<Set<string>>(new Set());

  /** Post URIs user has tapped to unblur (NSFW blur mode) */
  const unblurredNsfwUris = useSignal<Set<string>>(new Set());

  // ── Load Feed ───────────────────────────────────────────────────────────
  const loadFeed = $(async (append = false) => {
    feed.loading = true;
    feed.error = null;
    try {
      const { getMixedFeed } = await import('~/lib/bsky');
      const cursorsToUse = append && Object.keys(feed.cursors).length > 0 ? feed.cursors : undefined;
      const usePublic = !app.session.isLoggedIn;
      const result = await getMixedFeed(app.feedMix, 30, cursorsToUse, usePublic);
      if (append) {
        feed.items = [...feed.items, ...result.feed];
      } else {
        feed.items = result.feed;
      }
      feed.cursors = result.cursors ?? {};
    } catch (err) {
      feed.error = err instanceof Error ? err.message : 'Failed to load feed';
    }
    feed.loading = false;
    // Write through to module-level cache so back-navigation restores instantly
    feedCache.items = [...feed.items];
    feedCache.cursors = { ...feed.cursors };
    feedCache.forDid = app.session.did;
  });

  // ── Initial Load ────────────────────────────────────────────────────────
  useVisibleTask$(async () => {
    try {
      const raw = localStorage.getItem('purplesky-seen-posts');
      if (raw) seenPosts.value = new Set(JSON.parse(raw));
    } catch { /* ignore */ }

    // Check if we have a valid cache for this account (back-navigation)
    const cacheMatchesAccount = feedCache.forDid === app.session.did ||
      (!app.session.did && feedCache.forDid === null);
    if (feedCache.items.length > 0 && cacheMatchesAccount) {
      // Restore from cache — renders immediately so scroll position works
      feed.items = feedCache.items;
      feed.cursors = feedCache.cursors;
      feed.loading = false;
      feed.restoredFromCache = true;
      if (feedCache.sortedItems.length > 0) {
        sortedDisplayItems.value = feedCache.sortedItems;
      }
      return; // Don't reload — user navigated back
    }

    // No cache or wrong account — load fresh
    setTimeout(() => loadFeed(), 300);
  });

  // ── Hide floating buttons when scrolling down; show immediately on scroll up or stop ───
  useVisibleTask$(({ cleanup }) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const stopScrollDelay = 200;
    const scrollThreshold = 48; // px of downward scroll before hiding (avoids jitter)
    let scrollYAtRest = typeof window !== 'undefined' ? window.scrollY : 0;
    let lastY = scrollYAtRest;
    const onScroll = () => {
      const y = window.scrollY;
      const isHidden = document.body.classList.contains('feed-scrolling');
      const goingUp = y < lastY;
      lastY = y;

      if (goingUp) {
        // Scrolling up: immediately show buttons if hidden, and always
        // update scrollYAtRest so the down-threshold starts from the
        // highest point the user reaches (not a stale position).
        if (isHidden) {
          document.body.classList.remove('feed-scrolling');
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
        }
        scrollYAtRest = y;
        return;
      }

      if (isHidden) {
        // Still scrolling down while hidden: reset the stop-timer
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          document.body.classList.remove('feed-scrolling');
          scrollYAtRest = window.scrollY;
          timeoutId = undefined;
        }, stopScrollDelay);
      } else if (y - scrollYAtRest >= scrollThreshold) {
        // Scrolled down past threshold: hide
        document.body.classList.add('feed-scrolling');
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          document.body.classList.remove('feed-scrolling');
          scrollYAtRest = window.scrollY;
          timeoutId = undefined;
        }, stopScrollDelay);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanup(() => {
      window.removeEventListener('scroll', onScroll);
      if (timeoutId) clearTimeout(timeoutId);
      document.body.classList.remove('feed-scrolling');
    });
  });

  // ── Refresh feed when a new post is published (e.g. from compose modal) ─
  useVisibleTask$(({ cleanup }) => {
    const onRefresh = () => loadFeed();
    window.addEventListener('purplesky-feed-refresh', onRefresh);
    cleanup(() => window.removeEventListener('purplesky-feed-refresh', onRefresh));
  });

  // ── Reload feed when login state changes ────────────────────────────────
  // This catches the case where session restore finishes after the initial
  // feed load (race condition), and also handles login/logout during the session.
  useVisibleTask$(({ track }) => {
    const isLoggedIn = track(() => app.session.isLoggedIn);
    const did = track(() => app.session.did);
    // Skip the very first run (initial load handles it above)
    if (feed.items.length === 0 && feed.loading) return;
    // If we restored from cache and session just confirmed, don't reload
    if (feed.restoredFromCache && feed.items.length > 0) {
      feed.restoredFromCache = false;
      // But if the DID changed (different account), we do need to reload
      if (feedCache.forDid === did) return;
    }
    // When session state changes, reload the feed from scratch
    loadFeed();
  });

  // ── Reload feed when feed mix changes (debounced so slider doesn’t trigger constant reload) ───
  const feedMixInitialized = useSignal(false);
  const feedMixReloadTimeout = useSignal<ReturnType<typeof setTimeout> | undefined>(undefined);
  useVisibleTask$(({ track, cleanup }) => {
    track(() => JSON.stringify(app.feedMix.map((e) => ({ uri: e.source.uri ?? e.source.kind, p: e.percent }))));
    if (!feedMixInitialized.value) {
      feedMixInitialized.value = true;
      return;
    }
    if (feedMixReloadTimeout.value !== undefined) clearTimeout(feedMixReloadTimeout.value);
    feedMixReloadTimeout.value = setTimeout(() => {
      feedMixReloadTimeout.value = undefined;
      loadFeed();
    }, 600);
    cleanup(() => {
      if (feedMixReloadTimeout.value !== undefined) {
        clearTimeout(feedMixReloadTimeout.value);
        feedMixReloadTimeout.value = undefined;
      }
    });
  });

  // ── Fetch downvote counts when feed items change ─────────────────────────
  useVisibleTask$(async ({ track }) => {
    track(() => feed.items.length);
    if (feed.items.length === 0) {
      downvoteCounts.value = {};
      return;
    }
    const { getDownvoteCounts } = await import('~/lib/constellation');
    const uris = feed.items.map((i) => i.post.uri).filter(Boolean);
    downvoteCounts.value = await getDownvoteCounts(uris);
  });

  // ── Apply sort (WASM) and set sortedDisplayItems ─────────────────────────
  useVisibleTask$(async ({ track }) => {
    track(() => feed.items.length);
    track(() => sortMode.value);
    track(() => downvoteCounts.value);

    const filtered = [...feed.items];
    if (filtered.length === 0) {
      sortedDisplayItems.value = [];
      return;
    }

    const record = (p: TimelineItem) => p.post.record as { createdAt?: string };
    const sortable = filtered.map((item) => ({
      uri: item.post.uri,
      created_at: record(item)?.createdAt ?? new Date(0).toISOString(),
      like_count: item.post.likeCount ?? 0,
      downvote_count: downvoteCounts.value[item.post.uri] ?? 0,
      reply_count: item.post.replyCount ?? 0,
      repost_count: item.post.repostCount ?? 0,
    }));

    const {
      sortByNewest,
      sortByTrending,
      sortByWilsonScore,
      sortByScore,
      sortByControversial,
    } = await import('~/lib/wasm-bridge');

    let ordered: typeof sortable;
    switch (sortMode.value) {
      case 'trending':
        ordered = await sortByTrending(sortable);
        break;
      case 'wilson':
        ordered = await sortByWilsonScore(sortable);
        break;
      case 'score':
        ordered = await sortByScore(sortable);
        break;
      case 'controversial':
        ordered = await sortByControversial(sortable);
        break;
      default:
        ordered = await sortByNewest(sortable);
    }

    const byUri = new Map(filtered.map((i) => [i.post.uri, i]));
    sortedDisplayItems.value = ordered.map((s) => byUri.get(s.uri)).filter(Boolean) as TimelineItem[];
    // Update cache with sorted order for instant back-navigation restore
    feedCache.sortedItems = [...sortedDisplayItems.value];
  });

  // ── Load More (infinite scroll) ─────────────────────────────────────────
  const hasMoreCursor = Object.values(feed.cursors).some(Boolean);
  const loadMore = $(() => {
    if (!feed.loading && hasMoreCursor) loadFeed(true);
  });

  // ── Load my downvotes and artboards when logged in ──────────────────────
  useVisibleTask$(async ({ track }) => {
    track(() => app.session.did);
    if (!app.session.did) {
      myDownvoteUris.value = {};
      artboardsList.value = [];
      return;
    }
    try {
      const [downvotes, boards] = await Promise.all([
        import('~/lib/bsky').then((m) => m.listMyDownvotes()),
        import('~/lib/artboards').then((m) => m.getArtboards()),
      ]);
      myDownvoteUris.value = downvotes;
      artboardsList.value = boards.map((b) => ({ id: b.id, name: b.name }));
      const uris = new Set<string>();
      for (const b of boards) for (const p of b.posts) uris.add(p.uri);
      inAnyArtboardUris.value = uris;
    } catch { /* ignore */ }
  });

  // ── Downvote / undo downvote ───────────────────────────────────────────
  const handleDownvote = $(async (uri: string, cid: string) => {
    try {
      const { createDownvote } = await import('~/lib/bsky');
      const recordUri = await createDownvote(uri, cid);
      myDownvoteUris.value = { ...myDownvoteUris.value, [uri]: recordUri };
    } catch (err) {
      console.error('Downvote failed:', err);
    }
  });
  const handleUndoDownvote = $(async (postUri: string) => {
    const recordUri = myDownvoteUris.value[postUri];
    if (!recordUri) return;
    try {
      const { deleteDownvote } = await import('~/lib/bsky');
      await deleteDownvote(recordUri);
      const next = { ...myDownvoteUris.value };
      delete next[postUri];
      myDownvoteUris.value = next;
    } catch (err) {
      console.error('Undo downvote failed:', err);
    }
  });

  // ── Add post to artboard ───────────────────────────────────────────────
  const handleAddToArtboard = $(async (boardId: string, item: TimelineItem) => {
    const art = await import('~/lib/artboards');
    const bsky = await import('~/lib/bsky');
    const post = item.post;
    const mediaInfo = bsky.getPostMediaInfo(post);
    art.addPostToArtboard(boardId, {
      uri: post.uri,
      cid: post.cid,
      authorHandle: post.author.handle,
      text: (post.record as { text?: string })?.text,
      thumb: mediaInfo?.url,
      thumbs: mediaInfo?.url ? [mediaInfo.url] : undefined,
    });
    artboardsList.value = art.getArtboards().map((b) => ({ id: b.id, name: b.name }));
    inAnyArtboardUris.value = new Set([...inAnyArtboardUris.value, post.uri]);
    try {
      const board = art.getArtboard(boardId);
      if (board && app.session.did) await art.syncBoardToPds(board);
    } catch { /* ignore */ }
  });

  // ── Mark Post as Seen ───────────────────────────────────────────────────
  const markSeen = $((uri: string) => {
    const next = new Set(seenPosts.value);
    next.add(uri);
    // Cap at 2000 entries
    if (next.size > 2000) {
      const arr = Array.from(next);
      arr.splice(0, arr.length - 2000);
      seenPosts.value = new Set(arr);
    } else {
      seenPosts.value = next;
    }
    try {
      localStorage.setItem('purplesky-seen-posts', JSON.stringify(Array.from(seenPosts.value)));
    } catch { /* ignore */ }
  });

  // ── Feed Keyboard Navigation ────────────────────────────────────────────
  useVisibleTask$(({ cleanup }) => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs or modals open
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) return;

      const key = e.key.toLowerCase();
      const isNavKey = key === 'w' || key === 's' || key === 'a' || key === 'd' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        key === 'e' || key === 'f' || key === 'c' || key === 'r' || key === 'q';
      if (!isNavKey) return;

      const items = sortedDisplayItems.value.length > 0
        ? sortedDisplayItems.value
        : feed.items;
      if (items.length === 0) return;

      const cols = app.viewColumns;
      const i = focusedIndex.value;

      // Navigation: W/S/A/D and arrows
      if (key === 'w' || e.key === 'ArrowUp') {
        e.preventDefault();
        keyboardNavActive.value = true;
        if (cols <= 1) {
          focusedIndex.value = Math.max(0, i - 1);
        } else {
          focusedIndex.value = i - cols >= 0 ? i - cols : i;
        }
        scrollFocusedIntoView();
        return;
      }
      if (key === 's' || e.key === 'ArrowDown') {
        e.preventDefault();
        keyboardNavActive.value = true;
        if (cols <= 1) {
          focusedIndex.value = Math.min(items.length - 1, i + 1);
        } else {
          focusedIndex.value = i + cols < items.length ? i + cols : i;
        }
        scrollFocusedIntoView();
        return;
      }
      if (key === 'a' || e.key === 'ArrowLeft') {
        e.preventDefault();
        keyboardNavActive.value = true;
        // Don't move past the leftmost column
        const col = i % cols;
        focusedIndex.value = col === 0 ? i : i - 1;
        scrollFocusedIntoView();
        return;
      }
      if (key === 'd' || e.key === 'ArrowRight') {
        e.preventDefault();
        keyboardNavActive.value = true;
        // Don't move past the rightmost column
        const col = i % cols;
        focusedIndex.value = col === cols - 1 ? i : i + 1;
        scrollFocusedIntoView();
        return;
      }

      // Q = deselect / close actions menu on feed
      if (key === 'q') {
        e.preventDefault();
        focusedIndex.value = -1;
        keyboardNavActive.value = false;
        return;
      }

      // Action keys require a focused post
      if (i < 0 || i >= items.length) return;
      const item = items[i];

      // E = Enter/open post (full path with base so GitHub Pages stays under /repo/)
      if (key === 'e') {
        e.preventDefault();
        nav(withBase(`/post/${encodeURIComponent(item.post.uri)}/`));
        return;
      }

      // F = Like/unlike
      if (key === 'f') {
        e.preventDefault();
        // Dispatch a custom event that PostCard can listen for
        const card = document.querySelector(`[data-post-uri="${CSS.escape(item.post.uri)}"]`);
        if (card) card.dispatchEvent(new CustomEvent('keyboard-like', { bubbles: true }));
        return;
      }

      // C = Collect (save to artboard)
      if (key === 'c') {
        e.preventDefault();
        const card = document.querySelector(`[data-post-uri="${CSS.escape(item.post.uri)}"]`);
        if (card) card.dispatchEvent(new CustomEvent('keyboard-collect', { bubbles: true }));
        return;
      }

      // R = Reply (full path with base so GitHub Pages stays under /repo/)
      if (key === 'r') {
        e.preventDefault();
        nav(withBase(`/post/${encodeURIComponent(item.post.uri)}/`));
        return;
      }
    };

    const scrollFocusedIntoView = () => {
      requestAnimationFrame(() => {
        const idx = focusedIndex.value;
        const cards = document.querySelectorAll('[data-post-uri]');
        // Find the card at the focused index
        const items = sortedDisplayItems.value.length > 0
          ? sortedDisplayItems.value
          : feed.items;
        if (idx >= 0 && idx < items.length) {
          const uri = items[idx]?.post?.uri;
          if (uri) {
            const el = document.querySelector(`[data-post-uri="${CSS.escape(uri)}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      });
    };

    window.addEventListener('keydown', onKeyDown);
    cleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  // Long-press on hide-seen FAB: restore seen posts (clear hidden set)
  useVisibleTask$(({ track, cleanup: cleanupTask }) => {
    track(() => seenPosts.value.size);
    if (seenPosts.value.size === 0) return;
    let longPressId: ReturnType<typeof setTimeout> | null = null;
    let teardown: (() => void) | undefined;
    const LONG_PRESS_MS = 600;
    const setup = () => {
      const el = document.getElementById('hide-seen-fab');
      if (!el) return;
      const onDown = () => {
        longPressId = setTimeout(() => {
          longPressId = null;
          hiddenSeenUris.value = new Set();
          app.toastMessage = 'Seen posts restored';
          skipNextHideClick.value = true;
        }, LONG_PRESS_MS);
      };
      const onUp = () => {
        if (longPressId) {
          clearTimeout(longPressId);
          longPressId = null;
        }
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('pointerleave', onUp);
      teardown = () => {
        if (longPressId) clearTimeout(longPressId);
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('pointerleave', onUp);
      };
    };
    const timeoutId = setTimeout(setup, 0);
    cleanupTask(() => {
      clearTimeout(timeoutId);
      teardown?.();
    });
  });

  // Base list (sorted or raw); we filter by hiddenSeenUris for display
  const baseItems =
    sortedDisplayItems.value.length > 0
      ? sortedDisplayItems.value
      : feed.items;
  const displayItems = baseItems
    .filter((item) => !hiddenSeenUris.value.has(item.post.uri))
    .filter((item) => {
      if (app.nsfwMode === 'hide' && bsky.isPostNsfw(item.post)) return false;
      return true;
    })
    .filter((item) => {
      if (!app.mediaOnly) return true;
      return !!bsky.getPostMediaInfo(item.post);
    });

  // ── Distribute into masonry columns ─────────────────────────────────────
  const numCols = app.viewColumns;
  const columns: Array<Array<{ item: TimelineItem; originalIndex: number }>> = Array.from({ length: numCols }, () => []);
  displayItems.forEach((item, i) => {
    columns[i % numCols].push({ item, originalIndex: i });
  });

  return (
    <div class="feed-page">
      {/* ── Controls Row ───────────────────────────────────────────────── */}
      <div class="feed-controls">
        <div class="feed-controls-left">
          {/* Column switcher */}
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              class={`col-btn ${app.viewColumns === n ? 'col-btn-active' : ''}`}
              onClick$={() => {
                app.viewColumns = n as 1 | 2 | 3;
                localStorage.setItem('purplesky-view-columns', String(n));
              }}
              aria-label={`${n} column${n > 1 ? 's' : ''}`}
            >
              {n}
            </button>
          ))}

          {/* Sort mode */}
          <select
            class="sort-select"
            value={sortMode.value}
            onChange$={(_, el) => { sortMode.value = el.value as typeof sortMode.value; }}
          >
            <option value="newest">Newest</option>
            <option value="trending">Trending</option>
            <option value="wilson">Best</option>
            <option value="score">Score</option>
            <option value="controversial">Controversial</option>
          </select>

        </div>

      </div>

      {/* ── Floating Feeds button (artsky-style): top center, opens feed selector ── */}
      <div class="feeds-float-wrap">
        <button
          type="button"
          class={`feeds-float-btn float-btn ${showFeedSelector.value ? 'feeds-float-btn-active' : ''}`}
          onClick$={() => { showFeedSelector.value = !showFeedSelector.value; }}
          aria-label="Feeds"
          aria-expanded={showFeedSelector.value}
          title="Mix feeds"
        >
          <span class="feeds-float-label">Feeds</span>
          <span class="feeds-float-chevron" style={{ transform: showFeedSelector.value ? 'rotate(180deg)' : 'none' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
        {showFeedSelector.value && (
          <div class="feeds-float-dropdown">
            <FeedSelector
              onClose$={() => { showFeedSelector.value = false; }}
            />
          </div>
        )}
      </div>

      {/* ── Feed Selector Panel (when opened from floating button) ────────── */}
      {showFeedSelector.value && (
        <div class="feed-selector-backdrop" onClick$={() => { showFeedSelector.value = false; }} aria-hidden />
      )}

      {/* ── Error State ────────────────────────────────────────────────── */}
      {feed.error && (
        <div class="feed-error">
          <p>{feed.error}</p>
          <button class="btn" onClick$={() => loadFeed()}>Retry</button>
        </div>
      )}

      {/* ── Masonry Grid ───────────────────────────────────────────────── */}
      <div
        class={`masonry-grid masonry-cols-${numCols}`}
        data-keyboard-nav={keyboardNavActive.value || undefined}
        onMouseMove$={() => { keyboardNavActive.value = false; }}
        onMouseLeave$={() => { mouseOverIndex.value = -1; }}
      >
        {columns.map((col, colIdx) => (
          <div key={colIdx} class="masonry-column">
            {col.map(({ item, originalIndex }) => (
              <div
                key={item.post.uri}
                onMouseEnter$={() => { mouseOverIndex.value = originalIndex; }}
              >
                <PostCard
                  item={item}
                  isSeen={seenPosts.value.has(item.post.uri)}
                  onSeen$={() => markSeen(item.post.uri)}
                  cardViewMode={app.cardViewMode}
                  nsfwBlurred={app.nsfwMode === 'blur' && bsky.isPostNsfw(item.post) && !unblurredNsfwUris.value.has(item.post.uri)}
                  onNsfwUnblur$={() => {
                    const next = new Set(unblurredNsfwUris.value);
                    next.add(item.post.uri);
                    unblurredNsfwUris.value = next;
                  }}
                  downvoteCount={downvoteCounts.value[item.post.uri] ?? 0}
                  myDownvoteUri={app.session.isLoggedIn ? myDownvoteUris.value[item.post.uri] : undefined}
                  onDownvote$={app.session.isLoggedIn ? () => handleDownvote(item.post.uri, item.post.cid) : undefined}
                  onUndoDownvote$={app.session.isLoggedIn ? () => handleUndoDownvote(item.post.uri) : undefined}
                  artboards={app.session.isLoggedIn ? artboardsList.value : undefined}
                  onAddToArtboard$={app.session.isLoggedIn ? (boardId) => handleAddToArtboard(boardId, item) : undefined}
                  isInAnyArtboard={app.session.isLoggedIn ? inAnyArtboardUris.value.has(item.post.uri) : false}
                  isSelected={keyboardNavActive.value && focusedIndex.value === originalIndex}
                  isMouseOver={mouseOverIndex.value === originalIndex}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Floating "Hide Seen" button: tap = hide seen, long-press = bring back ── */}
      {seenPosts.value.size > 0 && (
        <button
          id="hide-seen-fab"
          class="hide-seen-fab float-btn"
          onClick$={() => {
            if (skipNextHideClick.value) {
              skipNextHideClick.value = false;
              return;
            }
            const base = sortedDisplayItems.value.length > 0 ? sortedDisplayItems.value : feed.items;
            const toHide = base.filter((item) => seenPosts.value.has(item.post.uri)).map((item) => item.post.uri);
            const count = toHide.length;
            hiddenSeenUris.value = new Set([...hiddenSeenUris.value, ...toHide]);
            app.toastMessage =
              count === 0
                ? 'No seen posts in feed'
                : count === 1
                  ? '1 seen post hidden'
                  : `${count} seen posts hidden`;
          }}
          aria-label="Hide seen posts (hold to restore)"
          title="Hide seen posts (hold to restore)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
            <path d="M1 1l22 22" />
            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
          </svg>
        </button>
      )}

      {/* ── Loading / Load More ────────────────────────────────────────── */}
      {feed.loading && (
        <div class="feed-loading flex-center">
          <div class="spinner" />
        </div>
      )}

      {!feed.loading && hasMoreCursor && displayItems.length > 0 && (
        <div class="load-more flex-center">
          <button class="btn-ghost" onClick$={loadMore}>Load More</button>
        </div>
      )}

      {/* ── Empty State ────────────────────────────────────────────────── */}
      {!feed.loading && !feed.error && displayItems.length === 0 && (
        <div class="feed-empty flex-center">
          <p>All caught up! No new posts.</p>
          <button class="btn-ghost" style={{ marginTop: 'var(--space-md)' }} onClick$={() => loadFeed()}>
            Refresh feed
          </button>
        </div>
      )}

      {/* ── Suggested Follows (when logged in) ───────────────────────────── */}
      {app.session.isLoggedIn && !feed.loading && displayItems.length > 0 && (
        <SuggestedFollowsSection />
      )}
    </div>
  );
});

// ── Suggested Follows (people your followees follow) ───────────────────────
const SuggestedFollowsSection = component$(() => {
  const app = useAppState();
  const suggested = useSignal<Array<{ did: string; handle: string; displayName?: string; avatar?: string; count: number }>>([]);
  const loading = useSignal(false);
  const open = useSignal(false);

  useVisibleTask$(async ({ track }) => {
    track(() => app.session.did);
    if (!app.session.did) return;
    loading.value = true;
    try {
      const { getSuggestedFollows } = await import('~/lib/bsky');
      suggested.value = await getSuggestedFollows(app.session.did, 8);
    } catch { /* ignore */ }
    loading.value = false;
  });

  if (suggested.value.length === 0 && !loading.value) return null;

  return (
    <div class="glass" style={{ marginTop: 'var(--space-xl)', padding: 'var(--space-lg)' }}>
      <button
        class="flex-between"
        style={{ width: '100%', marginBottom: open.value ? 'var(--space-md)' : 0 }}
        onClick$={() => { open.value = !open.value; }}
      >
        <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: '700' }}>Suggested accounts</h3>
        <span style={{ color: 'var(--muted)', fontSize: 'var(--font-sm)' }}>
          {open.value ? '−' : '+'}
        </span>
      </button>
      {open.value && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {loading.value ? (
            <div class="flex-center" style={{ padding: 'var(--space-md)' }}><div class="spinner" /></div>
          ) : (
            suggested.value.map((s) => (
              <a
                key={s.did}
                href={withBase(`/profile/${encodeURIComponent(s.handle)}/`)}
                class="flex-between glass"
                style={{ padding: 'var(--space-sm) var(--space-md)', textDecoration: 'none', color: 'var(--text)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  {s.avatar && (
                    <img src={s.avatar} alt="" width="32" height="32" style={{ borderRadius: '50%' }} />
                  )}
                  <div>
                    <div style={{ fontWeight: '600' }}>{s.displayName || s.handle}</div>
                    <div style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>@{s.handle}</div>
                  </div>
                </div>
                <span class="badge">{s.count} follow{s.count !== 1 ? 's' : ''} them</span>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
});
