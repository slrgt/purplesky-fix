/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Main Layout – Navigation, Header, App Shell
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the root layout for all pages. It provides:
 *  - App context (global state)
 *  - Floating top-right account/login button (no top navbar)
 *  - Floating bottom navigation bar (iOS-style tab bar)
 *  - Theme initialization
 *  - Session restoration on app load
 *
 * HOW TO EDIT:
 *  - To add a new nav tab, add an entry to the navItems array below
 *  - To change the header, edit the <header> section
 *  - Theme switching happens in the account menu
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, Slot, useVisibleTask$, useSignal, $ } from '@builder.io/qwik';
import { useLocation, useNavigate } from '@builder.io/qwik-city';
import { Link } from '~/components/app-link/app-link';
import { useAppProvider, useAppState } from '~/context/app-context';
import type { ThemeMode, CardViewMode } from '~/lib/types';

import { ComposeModal } from '~/components/compose-modal/compose-modal';
import { getBasePath, withBase } from '~/lib/path';
import './layout.css';

/** Route sync runs only once per page load to avoid loops on static hosts (e.g. GitHub Pages). */
const routeSyncState = { done: false };

/** Phantom-click guard (pointerdown/up + click + keydown) is now registered
 *  as an early inline <script> in root.tsx so it fires before Qwik's event
 *  delegation. See the dangerouslySetInnerHTML block in root.tsx <head>. */

export default component$(() => {
  const store = useAppProvider();
  const loc = useLocation();
  const nav = useNavigate();

  const showAbout = useSignal(false);
  const accountMenuOpen = useSignal(false);
  const accountWrapRef = useSignal<HTMLElement>();
  const otherAccounts = useSignal<Array<{ did: string; handle: string; avatar?: string }>>([]);
  const navSearchOpen = useSignal(false);
  const navSearchQuery = useSignal('');
  const navSearchRef = useSignal<HTMLInputElement>();
  const navSearchSuggestions = useSignal<Array<{ did: string; handle: string; displayName?: string; avatar?: string }>>([]);
  const navSearchSuggestionsLoading = useSignal(false);
  const navSearchShowSuggestions = useSignal(false);
  const navSearchSuggestionsRef = useSignal<HTMLElement>();
  const navSearchSelectedIndex = useSignal(0);

  // Auto-dismiss global toast after 2.5s
  useVisibleTask$(({ track, cleanup }) => {
    track(() => store.toastMessage);
    if (!store.toastMessage) return;
    const id = setTimeout(() => {
      store.toastMessage = null;
    }, 2500);
    cleanup(() => clearTimeout(id));
  });

  // ── Service worker update (GitHub Pages: prompt refresh when new version is waiting) ───
  useVisibleTask$(({ cleanup }) => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const base = getBasePath();
    const scope = base ? `${base}/` : '/';
    const ref = { reg: null as ServiceWorkerRegistration | null, aborted: false };
    const onControllerChange = () => window.location.reload();
    cleanup(() => {
      ref.aborted = true;
      ref.reg?.removeEventListener('controllerchange', onControllerChange);
    });
    navigator.serviceWorker.getRegistration(scope).then((registration) => {
      if (ref.aborted || !registration) return;
      ref.reg = registration;
      registration.update();
      if (registration.waiting) store.updateAvailable = true;
      registration.addEventListener('updatefound', () => {
        const w = registration.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && registration.waiting) store.updateAvailable = true; });
      });
      registration.addEventListener('controllerchange', onControllerChange);
    });
  });

  // ── Nav search typeahead (when floating search is open) ─────────────────
  useVisibleTask$(({ track, cleanup }) => {
    track(() => navSearchOpen.value);
    track(() => navSearchQuery.value);
    if (!navSearchOpen.value) {
      navSearchSuggestions.value = [];
      navSearchShowSuggestions.value = false;
      return;
    }
    const q = navSearchQuery.value.trim();
    if (q.length < 2) {
      navSearchSuggestions.value = [];
      navSearchShowSuggestions.value = false;
      return;
    }
    const t = setTimeout(async () => {
      navSearchSuggestionsLoading.value = true;
      try {
        const { searchActorsTypeahead } = await import('~/lib/bsky');
        const res = await searchActorsTypeahead(q, 8);
        const actors = (res as { actors?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }> }).actors ?? [];
        navSearchSuggestions.value = actors;
        navSearchShowSuggestions.value = actors.length > 0;
        navSearchSelectedIndex.value = 0;
      } catch {
        navSearchSuggestions.value = [];
      }
      navSearchSuggestionsLoading.value = false;
    }, 250);
    cleanup(() => clearTimeout(t));
  });

  // ── Restore session & theme on first load (browser only) ──────────────
  //
  // IMPORTANT: Session restore and route sync are combined into a single
  // useVisibleTask$ so they execute sequentially. Running them in separate
  // tasks caused a race condition: the route sync would call nav() while
  // session restore was still in-flight, causing Qwik to re-render the
  // layout with isLoggedIn=false, then true once restore finished — the
  // user saw a "logged in → logged out → logged in" flicker.
  useVisibleTask$(async () => {
    // ── 1. Restore theme / preferences from localStorage (sync) ─────────
    const savedTheme = localStorage.getItem('purplesky-theme') as ThemeMode | null;
    if (savedTheme) {
      store.theme = savedTheme;
      document.documentElement.setAttribute('data-theme', savedTheme === 'system' ? '' : savedTheme);
    }
    const savedCols = localStorage.getItem('purplesky-view-columns');
    if (savedCols) store.viewColumns = parseInt(savedCols) as 1 | 2 | 3;
    const savedCardView = localStorage.getItem('purplesky-card-view') as CardViewMode | null;
    if (savedCardView === 'full' || savedCardView === 'mini' || savedCardView === 'art') store.cardViewMode = savedCardView;
    const savedNsfw = localStorage.getItem('purplesky-nsfw-mode') as 'hide' | 'blur' | 'show' | null;
    if (savedNsfw === 'hide' || savedNsfw === 'blur' || savedNsfw === 'show') store.nsfwMode = savedNsfw;
    const savedMediaOnly = localStorage.getItem('purplesky-media-only');
    if (savedMediaOnly === '1') store.mediaOnly = true;

    // ── 2. Restore session (async — must finish before route sync) ──────
    try {
      const { resumeSession, getSession } = await import('~/lib/bsky');

      // Check for OAuth callback
      const params = new URLSearchParams(window.location.search);
      const hasCallback = params.has('state') && (params.has('code') || params.has('error'));

      if (hasCallback) {
        const { initOAuth } = await import('~/lib/oauth');
        const result = await initOAuth({ hasCallback: true });
        if (result?.session) {
          const { Agent } = await import('@atproto/api');
          const oauthAgent = new Agent(result.session);
          const { setOAuthAgent, addOAuthDid } = await import('~/lib/bsky');
          setOAuthAgent(oauthAgent, result.session);
          addOAuthDid(oauthAgent.did!, true);
          // Clean URL — remove OAuth callback params so they aren't replayed
          window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        }
      } else {
        // Try restoring existing session
        const { initOAuth } = await import('~/lib/oauth');
        const oauthResult = await initOAuth().catch(() => undefined);
        if (oauthResult?.session) {
          const { Agent } = await import('@atproto/api');
          const oauthAgent = new Agent(oauthResult.session);
          const { setOAuthAgent, addOAuthDid } = await import('~/lib/bsky');
          setOAuthAgent(oauthAgent, oauthResult.session);
          addOAuthDid(oauthAgent.did!, true);
        } else {
          await resumeSession();
        }
      }

      // Update store with session info
      const session = getSession();
      if (session?.did) {
        store.session.did = session.did;
        store.session.isLoggedIn = true;
        // Fetch profile for handle/avatar
        try {
          const { agent } = await import('~/lib/bsky');
          const profile = await agent.getProfile({ actor: session.did });
          const d = profile.data as { handle?: string; avatar?: string; displayName?: string };
          store.session.handle = d.handle ?? null;
          store.session.avatar = d.avatar ?? null;
          // Cache profile for account switcher
          const { saveAccountProfile } = await import('~/lib/bsky');
          saveAccountProfile({ did: session.did, handle: d.handle ?? session.did, avatar: d.avatar, displayName: d.displayName });
        } catch { /* ignore */ }
      }

      // Load other accounts for the switcher
      try {
        const { getOAuthAccountsSnapshot, getAccountProfiles } = await import('~/lib/bsky');
        const oauthSnap = getOAuthAccountsSnapshot();
        const profiles = getAccountProfiles();
        const currentDid = session?.did;
        const others = oauthSnap.dids
          .filter((d: string) => d !== currentDid)
          .map((d: string) => {
            const p = profiles[d];
            return { did: d, handle: p?.handle ?? d.slice(0, 16) + '…', avatar: p?.avatar };
          });
        otherAccounts.value = others;
      } catch { /* ignore */ }
    } catch (err) {
      console.error('Session restore failed:', err);
    }

    // ── 3. Route sync for 404.html (runs AFTER session is restored) ─────
    // When the app is served via 404.html at a non-root URL (e.g. direct
    // link to /purplesky/post/...), QwikCity may think we're at "/".
    // We call nav() once to sync the router to the actual URL.
    //
    // Run only ONCE per page load so we never loop (e.g. on GitHub Pages
    // where nav() could otherwise be re-triggered).
    try {
      if (routeSyncState.done) return;
      const navEntry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!navEntry || navEntry.type !== 'navigate') return;
      const params = new URLSearchParams(window.location.search);
      const isOAuthCallback = params.has('state') && (params.has('code') || params.has('error'));
      if (isOAuthCallback) return;
      const pathname = window.location.pathname;
      const base = getBasePath();
      const pathAfterBase = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname;
      const isHome = pathAfterBase === '/' || pathAfterBase === '' || pathname === base || pathname === base + '/';
      if (isHome) return;
      routeSyncState.done = true;
      const cleanSearch = window.location.search;
      const target = withBase(pathAfterBase || '/') + cleanSearch + window.location.hash;
      await nav(target);
    } catch { /* ignore route sync errors */ }
  });

  // Close account dropdown on outside click
  useVisibleTask$(({ track, cleanup }) => {
    track(() => accountMenuOpen.value);
    const close = (e: Event) => {
      const t = e.target as Node;
      if (accountMenuOpen.value && accountWrapRef.value && !accountWrapRef.value.contains(t)) accountMenuOpen.value = false;
    };
    document.addEventListener('click', close);
    cleanup(() => document.removeEventListener('click', close));
  });

  /** Switch to another logged-in account by DID. */
  const onSwitchAccount = $(async (did: string) => {
    accountMenuOpen.value = false;
    try {
      const { restoreOAuthSession } = await import('~/lib/oauth');
      const { Agent } = await import('@atproto/api');
      const session = await restoreOAuthSession(did);
      if (!session) return;
      const oauthAgent = new Agent(session);
      const { setOAuthAgent, setActiveOAuthDid, saveAccountProfile, getOAuthAccountsSnapshot, getAccountProfiles } = await import('~/lib/bsky');
      setOAuthAgent(oauthAgent, session);
      setActiveOAuthDid(did);
      // Update store with new profile
      store.session.did = did;
      store.session.isLoggedIn = true;
      try {
        const { agent } = await import('~/lib/bsky');
        const profile = await agent.getProfile({ actor: did });
        const d = profile.data as { handle?: string; avatar?: string; displayName?: string };
        store.session.handle = d.handle ?? null;
        store.session.avatar = d.avatar ?? null;
        saveAccountProfile({ did, handle: d.handle ?? did, avatar: d.avatar, displayName: d.displayName });
      } catch { /* ignore */ }
      // Rebuild other accounts list
      const oauthSnap = getOAuthAccountsSnapshot();
      const profiles = getAccountProfiles();
      otherAccounts.value = oauthSnap.dids
        .filter((d: string) => d !== did)
        .map((d: string) => {
          const p = profiles[d];
          return { did: d, handle: p?.handle ?? d.slice(0, 16) + '…', avatar: p?.avatar };
        });
      // Reload page to refresh feeds for the new account
      window.location.reload();
    } catch (err) {
      console.error('Account switch failed:', err);
    }
  });

  /** Log out the current account. If others remain, switch to the next one. */
  const onLogout = $(async () => {
    const currentDid = store.session.did;
    if (!currentDid) return;
    const { logoutAccount, getOAuthAccountsSnapshot, getAccountProfiles, saveAccountProfile } = await import('~/lib/bsky');
    const nextDid = await logoutAccount(currentDid);
    if (nextDid) {
      // Next account may be OAuth (switch via restore) or credential (already resumed in logoutAccount)
      const oauthSnap = getOAuthAccountsSnapshot();
      if (oauthSnap.dids.includes(nextDid)) {
        await onSwitchAccount(nextDid);
      } else {
        // Credential account: session already resumed in bsky; just update store
        store.session.did = nextDid;
        store.session.isLoggedIn = true;
        try {
          const { agent } = await import('~/lib/bsky');
          const profile = await agent.getProfile({ actor: nextDid });
          const d = profile.data as { handle?: string; avatar?: string; displayName?: string };
          store.session.handle = d.handle ?? null;
          store.session.avatar = d.avatar ?? null;
          saveAccountProfile({ did: nextDid, handle: d.handle ?? nextDid, avatar: d.avatar, displayName: d.displayName });
        } catch { /* ignore */ }
        const profiles = getAccountProfiles();
        otherAccounts.value = oauthSnap.dids
          .filter((d: string) => d !== nextDid)
          .map((d: string) => {
            const p = profiles[d];
            return { did: d, handle: p?.handle ?? d.slice(0, 16) + '…', avatar: p?.avatar };
          });
        accountMenuOpen.value = false;
      }
    } else {
      // No accounts left — fully logged out
      store.session.did = null;
      store.session.handle = null;
      store.session.avatar = null;
      store.session.isLoggedIn = false;
      otherAccounts.value = [];
      accountMenuOpen.value = false;
    }
  });

  /** Open login modal to add another account. */
  const onAddAccount = $(() => {
    accountMenuOpen.value = false;
    store.showLoginModal = true;
  });

  // ── Theme Toggle ────────────────────────────────────────────────────────
  const cycleTheme = $(() => {
    const modes: ThemeMode[] = ['dark', 'light', 'high-contrast', 'system'];
    const idx = modes.indexOf(store.theme);
    const next = modes[(idx + 1) % modes.length];
    store.theme = next;
    document.documentElement.setAttribute('data-theme', next === 'system' ? '' : next);
    localStorage.setItem('purplesky-theme', next);
  });

  // ── Global Keyboard Shortcuts ──────────────────────────────────────────
  useVisibleTask$(({ cleanup }) => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when login modal or about dialog is open
      if (store.showLoginModal || store.showComposeModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          store.showLoginModal = false;
          store.showComposeModal = false;
        }
        return;
      }
      if (showAbout.value) {
        if (e.key === 'Escape' || e.key.toLowerCase() === 'q') {
          e.preventDefault();
          showAbout.value = false;
        }
        return;
      }

      // Don't intercept when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault();
          target.blur();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      const key = e.key.toLowerCase();

      // 1/2/3 = column count
      if (key === '1' || key === '2' || key === '3') {
        e.preventDefault();
        store.viewColumns = parseInt(key) as 1 | 2 | 3;
        localStorage.setItem('purplesky-view-columns', key);
        return;
      }

      // T = cycle theme
      if (key === 't') {
        e.preventDefault();
        const modes: ThemeMode[] = ['dark', 'light', 'high-contrast', 'system'];
        const idx = modes.indexOf(store.theme);
        const next = modes[(idx + 1) % modes.length];
        store.theme = next;
        document.documentElement.setAttribute('data-theme', next === 'system' ? '' : next);
        localStorage.setItem('purplesky-theme', next);
        return;
      }

      // Escape = close any open dropdown
      if (e.key === 'Escape') {
        e.preventDefault();
        accountMenuOpen.value = false;
        return;
      }

      // / = go to search page
      if (key === '/') {
        e.preventDefault();
        nav(navHref('/search/'));
        return;
      }

      // ? = show keyboard shortcuts help
      if (e.key === '?') {
        e.preventDefault();
        showAbout.value = true;
        return;
      }

      // Q = go back (except on feed page where it's handled by feed nav)
      if (key === 'q' && e.key !== 'Backspace') {
        const pathname = loc.url.pathname;
        const base = getBasePath();
        const pathAfterBase = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname;
        const pathForBack = pathAfterBase || '/';
        if (pathForBack !== '/' && !pathForBack.startsWith('/feed')) {
          e.preventDefault();
          window.history.back();
        }
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    cleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  // ── Nav Items ───────────────────────────────────────────────────────────
  const navItems = [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/forum/', label: 'Forums', icon: 'forum' },
    { href: '/consensus/', label: 'Consensus', icon: 'consensus' },
    { href: '/collab/', label: 'Collab', icon: 'collab' },
    { href: '/artboards/', label: 'Collections', icon: 'collections' },
  ];

  const pathname = loc.url.pathname;
  const base = getBasePath();
  const pathAfterBase = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname;
  const isHome = pathAfterBase === '/' || pathAfterBase === '';
  const searchParams = new URLSearchParams(loc.url.search);
  const isOAuthCallback = searchParams.has('state') && (searchParams.has('code') || searchParams.has('error'));
  const showBackButton = !isHome && !isOAuthCallback;
  /** Full href for nav items (absolute path with base for subpath deploy) */
  const navHref = (path: string) => withBase(path);
  /** Path for matching active tab (compare segment after base to item.href) */
  const pathForActive = pathAfterBase;

  return (
    <div class="app-shell">
      {/* ── Floating back button (top-left), when on a page we can go back from ── */}
      {showBackButton && (
        <button
          type="button"
          class="floating-back float-btn"
          aria-label="Back"
          onClick$={() => { history.back(); }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* ── Floating top-right: Account or Login (no top navbar) ───────────── */}
      <div class="floating-top-right" ref={accountWrapRef}>
        {store.session.isLoggedIn ? (
          <>
            {/* New post to the left of account */}
            <button
              class="floating-fab float-btn"
              aria-label="New post"
              onClick$={() => { store.showComposeModal = true; }}
            >
              New post
            </button>
            <div class="floating-top-right-col">
              <div class="account-btn-wrap">
                <button
                  class="floating-fab float-btn"
                  aria-label="Account menu"
                  aria-expanded={accountMenuOpen.value}
                  onClick$={() => { accountMenuOpen.value = !accountMenuOpen.value; }}
                >
                  {store.session.avatar ? (
                    <img src={store.session.avatar} alt="" width="28" height="28" class="floating-avatar" />
                  ) : (
                    <span class="floating-avatar-placeholder">{(store.session.handle ?? '?')[0].toUpperCase()}</span>
                  )}
                </button>
                {accountMenuOpen.value && (
                  <div class="account-dropdown glass-strong">
                    {/* ── Current account ── */}
                    {store.session.handle && (
                      <button
                        type="button"
                        class="acct-row acct-current"
                        onClick$={async () => {
                          const handle = store.session.handle;
                          accountMenuOpen.value = false;
                          if (handle) await nav(navHref(`/profile/${encodeURIComponent(handle)}/`));
                        }}
                      >
                        {store.session.avatar ? (
                          <img src={store.session.avatar} alt="" width="24" height="24" class="acct-avatar" />
                        ) : (
                          <span class="acct-avatar-ph">{(store.session.handle ?? '?')[0].toUpperCase()}</span>
                        )}
                        <span class="acct-info">
                          <span class="acct-handle">@{store.session.handle}</span>
                          <span class="acct-label">View profile</span>
                        </span>
                      </button>
                    )}

                    {/* ── Other accounts ── */}
                    {otherAccounts.value.length > 0 && (
                      <div class="acct-section">
                        <div class="acct-divider" />
                        {otherAccounts.value.map((acct) => (
                          <button
                            key={acct.did}
                            type="button"
                            class="acct-row"
                            onClick$={() => onSwitchAccount(acct.did)}
                          >
                            {acct.avatar ? (
                              <img src={acct.avatar} alt="" width="24" height="24" class="acct-avatar" />
                            ) : (
                              <span class="acct-avatar-ph">{(acct.handle ?? '?')[0].toUpperCase()}</span>
                            )}
                            <span class="acct-info">
                              <span class="acct-handle">@{acct.handle}</span>
                              <span class="acct-label">Switch</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* ── Add account ── */}
                    <div class="acct-divider" />
                    <button type="button" onClick$={() => onAddAccount()}>
                      + Add account
                    </button>

                    {/* ── Utilities ── */}
                    <div class="acct-divider" />
                    <button type="button" onClick$={() => { cycleTheme(); accountMenuOpen.value = false; }}>
                      Theme
                    </button>

                    {/* ── Log out ── */}
                    <div class="acct-divider" />
                    <button type="button" class="acct-logout" onClick$={() => onLogout()}>
                      Log out @{store.session.handle ?? ''}
                    </button>
                  </div>
                )}
              </div>
              {/* Toggle buttons: card view (cycle), NSFW/blur (cycle), media only (toggle) */}
              <div class="float-toggles">
                {/* Card view: one button cycles Full → Mini → Art */}
                <button
                  type="button"
                  class="float-toggle-btn float-btn"
                  aria-label={`Card view: ${store.cardViewMode} (click to cycle)`}
                  title={`Card view: ${store.cardViewMode}`}
                  onClick$={() => {
                    const next = store.cardViewMode === 'full' ? 'mini' : store.cardViewMode === 'mini' ? 'art' : 'full';
                    store.cardViewMode = next;
                    localStorage.setItem('purplesky-card-view', next);
                    store.toastMessage = next === 'full' ? 'Full cards' : next === 'mini' ? 'Mini cards' : 'Art cards';
                  }}
                >
                  {store.cardViewMode === 'full' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                      <line x1="3" y1="14" x2="18" y2="14" />
                    </svg>
                  )}
                  {store.cardViewMode === 'mini' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="5" y="8" width="14" height="8" rx="1" />
                    </svg>
                  )}
                  {store.cardViewMode === 'art' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="2" y="2" width="20" height="20" rx="2" />
                      <circle cx="12" cy="12" r="4" />
                    </svg>
                  )}
                </button>
                {/* NSFW/Blur: one button cycles SFW → Blur → NSFW */}
                <button
                  type="button"
                  class="float-toggle-btn float-btn"
                  aria-label={`Content: ${store.nsfwMode === 'hide' ? 'SFW' : store.nsfwMode === 'blur' ? 'Blur' : 'NSFW'} (click to cycle)`}
                  title={`Content: ${store.nsfwMode === 'hide' ? 'SFW' : store.nsfwMode === 'blur' ? 'Blur' : 'NSFW'}`}
                  onClick$={() => {
                    const next = store.nsfwMode === 'hide' ? 'blur' : store.nsfwMode === 'blur' ? 'show' : 'hide';
                    store.nsfwMode = next;
                    localStorage.setItem('purplesky-nsfw-mode', next);
                    store.toastMessage = next === 'hide' ? 'SFW' : next === 'blur' ? 'Blur' : 'NSFW';
                  }}
                >
                  {store.nsfwMode === 'hide' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M1 1l22 22" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    </svg>
                  )}
                  {store.nsfwMode === 'blur' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                    </svg>
                  )}
                  {store.nsfwMode === 'show' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
                {/* Media only: one button toggles Media only ↔ Media and text */}
                <button
                  type="button"
                  class="float-toggle-btn float-btn"
                  aria-label={store.mediaOnly ? 'Media only (click for media and text)' : 'Media and text (click for media only)'}
                  title={store.mediaOnly ? 'Media only' : 'Media and text'}
                  onClick$={() => {
                    store.mediaOnly = !store.mediaOnly;
                    try { localStorage.setItem('purplesky-media-only', store.mediaOnly ? '1' : '0'); } catch { /* ignore */ }
                    store.toastMessage = store.mediaOnly ? 'Media only' : 'Media and text';
                  }}
                >
                  {store.mediaOnly ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="8" y1="6" x2="21" y2="6" />
                      <line x1="8" y1="12" x2="21" y2="12" />
                      <line x1="8" y1="18" x2="21" y2="18" />
                      <line x1="3" y1="6" x2="3.01" y2="6" />
                      <line x1="3" y1="12" x2="3.01" y2="12" />
                      <line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <button class="floating-fab floating-login float-btn" onClick$={() => { store.showLoginModal = true; }} aria-label="Log in">
            Log in
          </button>
        )}
      </div>

      {/* ── Main Content ───────────────────────────────────────────────── */}
      <main id="main-content" class="main-content">
        <Slot />
      </main>

      {/* ── Floating search panel (above nav, when search is open) ───────── */}
      {navSearchOpen.value && (
        <div class="nav-search-float glass" ref={navSearchSuggestionsRef}>
          <form
            class="nav-search-bar"
            preventdefault:submit
            onSubmit$={async () => {
              const q = navSearchQuery.value.trim();
              if (q) {
                navSearchOpen.value = false;
                navSearchQuery.value = '';
                navSearchShowSuggestions.value = false;
                await nav(navHref(`/search/?q=${encodeURIComponent(q)}`));
              }
            }}
          >
            <input
              ref={navSearchRef}
              type="text"
              class="nav-search-input"
              placeholder="Search people or posts…"
              autoFocus
              bind:value={navSearchQuery}
              onFocus$={() => { if (navSearchSuggestions.value.length > 0) navSearchShowSuggestions.value = true; navSearchSelectedIndex.value = 0; }}
              onBlur$={() => { setTimeout(() => { navSearchShowSuggestions.value = false; }, 180); }}
              onKeyDown$={async (e) => {
                const ev = e as KeyboardEvent;
                const showing = navSearchShowSuggestions.value && (navSearchSuggestions.value.length > 0 || navSearchQuery.value.trim().length >= 2);
                const total = 1 + navSearchSuggestions.value.length;
                if (ev.key === 'Escape') {
                  navSearchOpen.value = false;
                  navSearchQuery.value = '';
                  navSearchShowSuggestions.value = false;
                  return;
                }
                if (showing && total > 0) {
                  if (ev.key === 'ArrowDown') {
                    e.preventDefault();
                    navSearchSelectedIndex.value = Math.min(navSearchSelectedIndex.value + 1, total - 1);
                    return;
                  }
                  if (ev.key === 'ArrowUp') {
                    e.preventDefault();
                    navSearchSelectedIndex.value = Math.max(navSearchSelectedIndex.value - 1, 0);
                    return;
                  }
                  if (ev.key === 'Enter' || ((ev.ctrlKey || ev.metaKey) && ev.key === 'e')) {
                    e.preventDefault();
                    const idx = navSearchSelectedIndex.value;
                    if (idx === 0) {
                      const q = navSearchQuery.value.trim();
                      if (q) {
                        navSearchOpen.value = false;
                        navSearchQuery.value = '';
                        navSearchShowSuggestions.value = false;
                        await nav(navHref(`/search/?q=${encodeURIComponent(q)}`));
                      }
                    } else {
                      const actor = navSearchSuggestions.value[idx - 1];
                      if (actor) {
                        navSearchOpen.value = false;
                        navSearchQuery.value = '';
                        navSearchShowSuggestions.value = false;
                        await nav(navHref(`/profile/${encodeURIComponent(actor.handle)}/`));
                      }
                    }
                  }
                }
              }}
            />
            {navSearchSuggestionsLoading.value && (
              <div class="nav-search-spinner">
                <div class="spinner" />
              </div>
            )}
            <button type="submit" class="nav-search-go" aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button
              type="button"
              class="nav-search-close"
              aria-label="Close search"
              onClick$={() => { navSearchOpen.value = false; navSearchQuery.value = ''; navSearchShowSuggestions.value = false; }}
            >
              ✕
            </button>
          </form>
          {navSearchShowSuggestions.value && (navSearchSuggestions.value.length > 0 || navSearchQuery.value.trim().length >= 2) && (
            <div class="nav-search-suggestions">
              <button
                type="button"
                class={`nav-search-suggestion-row nav-search-suggestion-all ${navSearchSelectedIndex.value === 0 ? 'nav-search-suggestion-selected' : ''}`}
                onClick$={async () => {
                  const q = navSearchQuery.value.trim();
                  if (q) {
                    navSearchOpen.value = false;
                    navSearchQuery.value = '';
                    navSearchShowSuggestions.value = false;
                    await nav(navHref(`/search/?q=${encodeURIComponent(q)}`));
                  }
                }}
                onMouseEnter$={() => { navSearchSelectedIndex.value = 0; }}
              >
                <span class="nav-search-suggestion-all-icon">🔍</span>
                <span>Search posts for "{navSearchQuery.value.trim()}"</span>
              </button>
              {navSearchSuggestions.value.map((actor, i) => (
                <Link
                  key={actor.did}
                  href={navHref(`/profile/${encodeURIComponent(actor.handle)}/`)}
                  class={`nav-search-suggestion-row ${navSearchSelectedIndex.value === i + 1 ? 'nav-search-suggestion-selected' : ''}`}
                  onClick$={() => {
                    navSearchOpen.value = false;
                    navSearchQuery.value = '';
                    navSearchShowSuggestions.value = false;
                  }}
                  onMouseEnter$={() => { navSearchSelectedIndex.value = i + 1; }}
                >
                  {actor.avatar && (
                    <img src={actor.avatar} alt="" width="32" height="32" style={{ borderRadius: '50%', flexShrink: 0 }} />
                  )}
                  <div class="nav-search-suggestion-info">
                    {actor.displayName && <span class="nav-search-suggestion-name">{actor.displayName}</span>}
                    <span class="nav-search-suggestion-handle">@{actor.handle}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Bottom Navigation (always visible; search opens panel above) ─── */}
      <nav class="nav glass" aria-label="Main navigation" role="tablist">
        {navItems.map((item) => {
          const fullHref = navHref(item.href);
          const isActive = pathForActive === item.href ||
            (item.href !== '/' && pathForActive.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={fullHref}
              class={`nav-tab ${isActive ? 'nav-tab-active' : ''}`}
              role="tab"
              aria-selected={isActive}
              aria-label={item.label}
            >
              <NavIcon name={item.icon} active={isActive} />
              <span class="nav-label">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          class={`nav-tab ${pathForActive.startsWith('/search') || navSearchOpen.value ? 'nav-tab-active' : ''}`}
          role="tab"
          aria-label="Search"
          aria-expanded={navSearchOpen.value}
          onClick$={() => {
            navSearchOpen.value = !navSearchOpen.value;
            if (navSearchOpen.value) setTimeout(() => navSearchRef.value?.focus(), 50);
          }}
        >
          <NavIcon name="search" active={pathForActive.startsWith('/search') || navSearchOpen.value} />
          <span class="nav-label">Search</span>
        </button>
      </nav>

      {/* ── Login Modal ────────────────────────────────────────────────── */}
      {store.showLoginModal && <LoginModal />}

      {/* ── Compose Modal ───────────────────────────────────────────────── */}
      {store.showComposeModal && <ComposeModal />}

      {/* ── Global toast (e.g. card view mode, hide seen) ────────────────── */}
      {store.toastMessage && (
        <div class="app-toast float-btn" role="status" aria-live="polite">
          {store.toastMessage}
        </div>
      )}

      {/* New version available (GitHub Pages / PWA): refresh to load latest */}
      {store.updateAvailable && (
        <div class="app-toast float-btn" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <span>New version available</span>
          <button
            type="button"
            class="glass"
            style={{ padding: '4px 12px', borderRadius: '20px', fontWeight: 600, fontSize: 'var(--font-xs)' }}
            onClick$={async () => {
              const base = getBasePath();
              const scope = base ? `${base}/` : '/';
              const reg = await navigator.serviceWorker.getRegistration(scope);
              if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }}
          >
            Refresh
          </button>
        </div>
      )}

      {/* ── Keyboard Shortcuts Help ────────────────────────────────────── */}
      {showAbout.value && (
        <div class="modal-overlay" onClick$={() => { showAbout.value = false; }}>
          <div class="modal-card glass-strong" onClick$={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <h2 class="modal-title">PurpleSky</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-lg)', fontSize: 'var(--font-sm)' }}>
              A Bluesky client for art, forums, consensus, and collaboration. Keyboard-friendly navigation.
            </p>
            <h3 style={{ fontWeight: '700', marginBottom: 'var(--space-sm)', fontSize: 'var(--font-md)' }}>Keyboard Shortcuts</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px var(--space-lg)', fontSize: 'var(--font-sm)' }}>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>W / ↑</kbd><span style={{ color: 'var(--muted)' }}>Move up</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>A / ←</kbd><span style={{ color: 'var(--muted)' }}>Move left</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>S / ↓</kbd><span style={{ color: 'var(--muted)' }}>Move down</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>D / →</kbd><span style={{ color: 'var(--muted)' }}>Move right</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>E</kbd><span style={{ color: 'var(--muted)' }}>Enter / open post</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>R</kbd><span style={{ color: 'var(--muted)' }}>Reply to post</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>F</kbd><span style={{ color: 'var(--muted)' }}>Like / unlike</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>C</kbd><span style={{ color: 'var(--muted)' }}>Collect (save to artboard)</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>Q</kbd><span style={{ color: 'var(--muted)' }}>Quit / go back</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>T</kbd><span style={{ color: 'var(--muted)' }}>Toggle theme</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>1 / 2 / 3</kbd><span style={{ color: 'var(--muted)' }}>Column count</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>/</kbd><span style={{ color: 'var(--muted)' }}>Go to search page</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>Escape</kbd><span style={{ color: 'var(--muted)' }}>Close / unfocus</span>
              <kbd style={{ fontWeight: '600', fontFamily: 'monospace' }}>?</kbd><span style={{ color: 'var(--muted)' }}>Show this help</span>
            </div>
            <button
              class="modal-close"
              onClick$={() => { showAbout.value = false; }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Nav Icons ─────────────────────────────────────────────────────────────

const NavIcon = component$<{ name: string; active: boolean }>(({ name, active }) => {
  const color = active ? 'var(--accent)' : 'var(--muted)';
  const sw = active ? '2.5' : '2';

  switch (name) {
    case 'home':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={sw}>
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case 'forum':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={sw}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      );
    case 'consensus':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={sw}>
          <path d="M12 20V10M18 20V4M6 20v-4" />
        </svg>
      );
    case 'collab':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={sw}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case 'collections':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={sw}>
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
      );
    case 'search':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={sw}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    default:
      return <span>?</span>;
  }
});

// ── Login Modal ───────────────────────────────────────────────────────────

const LoginModal = component$(() => {
  const store = useAppState();

  const handleInput = useSignal('');
  const suggestions = useSignal<Array<{ did: string; handle: string; displayName?: string; avatar?: string }>>([]);
  const suggestionsLoading = useSignal(false);
  const showSuggestions = useSignal(false);
  const loginSelectedIndex = useSignal(0);
  const loginError = useSignal('');
  const loginLoading = useSignal(false);
  const suggestionsRef = useSignal<HTMLElement>();

  // Debounced typeahead search as user types
  useVisibleTask$(async ({ track, cleanup }) => {
    track(() => handleInput.value);
    const q = handleInput.value.trim();
    if (q.length < 2) {
      suggestions.value = [];
      showSuggestions.value = false;
      return;
    }
    const t = setTimeout(async () => {
      suggestionsLoading.value = true;
      try {
        const { searchActorsTypeahead } = await import('~/lib/bsky');
        const res = await searchActorsTypeahead(q, 6);
        const actors = (res as { actors?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }> }).actors ?? [];
        suggestions.value = actors;
        showSuggestions.value = actors.length > 0;
        loginSelectedIndex.value = 0;
      } catch {
        suggestions.value = [];
      }
      suggestionsLoading.value = false;
    }, 250);
    cleanup(() => clearTimeout(t));
  });

  const selectSuggestion = $((handle: string) => {
    handleInput.value = handle;
    showSuggestions.value = false;
  });

  const selectSuggestionByIndex = $(() => {
    const list = suggestions.value;
    if (list.length === 0) return;
    const idx = Math.max(0, Math.min(loginSelectedIndex.value, list.length - 1));
    const actor = list[idx];
    if (actor) selectSuggestion(actor.handle);
  });

  const handleOAuthLogin = $(async (handle: string) => {
    if (!handle) return;
    loginError.value = '';
    loginLoading.value = true;
    try {
      const { signInWithOAuthRedirect, normalizeHandle } = await import('~/lib/oauth');
      const normalized = normalizeHandle(handle);
      handleInput.value = normalized;
      await signInWithOAuthRedirect(normalized);
    } catch (err) {
      console.error('OAuth login failed:', err);
      loginError.value = err instanceof Error ? err.message : 'Login failed. Check your handle and try again.';
      loginLoading.value = false;
    }
  });

  return (
    <div class="modal-overlay" onClick$={() => { store.showLoginModal = false; }}>
      <div class="modal-card glass-strong" onClick$={(e) => e.stopPropagation()}>
        <h2 class="modal-title">Log in with Bluesky</h2>
        <p class="modal-subtitle">Enter your Bluesky handle or custom domain</p>

        <form
          preventdefault:submit
          onSubmit$={() => {
            const handle = handleInput.value.trim();
            if (handle) handleOAuthLogin(handle);
          }}
        >
          <div style={{ position: 'relative' }} ref={suggestionsRef}>
            <input
              type="text"
              placeholder="yourname.bsky.social or custom.domain"
              class="modal-input"
              autoFocus
              bind:value={handleInput}
              onFocus$={() => { if (suggestions.value.length > 0) showSuggestions.value = true; loginSelectedIndex.value = 0; }}
              onBlur$={() => { setTimeout(() => { showSuggestions.value = false; }, 200); }}
              onKeyDown$={(e) => {
                const ev = e as KeyboardEvent;
                if (!showSuggestions.value || suggestions.value.length === 0) return;
                const n = suggestions.value.length;
                if (ev.key === 'ArrowDown') {
                  e.preventDefault();
                  loginSelectedIndex.value = Math.min(loginSelectedIndex.value + 1, n - 1);
                  return;
                }
                if (ev.key === 'ArrowUp') {
                  e.preventDefault();
                  loginSelectedIndex.value = Math.max(loginSelectedIndex.value - 1, 0);
                  return;
                }
                if (ev.key === 'Enter' || ((ev.ctrlKey || ev.metaKey) && ev.key === 'e')) {
                  e.preventDefault();
                  selectSuggestionByIndex();
                }
              }}
            />
            {/* Typeahead suggestions dropdown */}
            {showSuggestions.value && suggestions.value.length > 0 && (
              <div class="login-suggestions glass" style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                borderRadius: 'var(--glass-radius-sm)', overflow: 'hidden',
                maxHeight: '240px', overflowY: 'auto',
              }}>
                {suggestions.value.map((actor, i) => (
                  <button
                    key={actor.did}
                    type="button"
                    class={i === loginSelectedIndex.value ? 'login-suggestion-item login-suggestion-selected' : 'login-suggestion-item'}
                    onClick$={() => selectSuggestion(actor.handle)}
                    onMouseDown$={(e) => e.preventDefault()}
                    onMouseEnter$={() => { loginSelectedIndex.value = i; }}
                  >
                    {actor.avatar && (
                      <img src={actor.avatar} alt="" width="28" height="28" style={{ borderRadius: '50%', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {actor.displayName && (
                        <div style={{ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {actor.displayName}
                        </div>
                      )}
                      <div style={{ color: 'var(--muted)', fontSize: 'var(--font-xs)' }}>@{actor.handle}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {suggestionsLoading.value && (
              <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>
                <div class="spinner" style={{ width: '16px', height: '16px' }} />
              </div>
            )}
          </div>

          {loginError.value && (
            <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', marginTop: 'var(--space-sm)' }}>
              {loginError.value}
            </p>
          )}

          <button type="submit" class="btn modal-submit" disabled={loginLoading.value}>
            {loginLoading.value ? 'Redirecting…' : 'Continue with Bluesky'}
          </button>
        </form>

        <p style={{ color: 'var(--muted)', fontSize: 'var(--font-xs)', marginTop: 'var(--space-md)', textAlign: 'center' }}>
          Works with any AT Protocol PDS — just enter your full handle.
        </p>

        <button
          class="modal-close"
          onClick$={() => { store.showLoginModal = false; }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
});
