/**
 * Root Preact component: layout, nav, and route view (Feed vs PostDetail).
 */
import { useState, useEffect } from 'preact/hooks';
import { withBase, getBasePath } from '../lib/path';
import { FeedView } from './FeedView';
import { PostDetailView } from './PostDetailView';

function getPathAfterBase(): string {
  const pathname = window.location.pathname;
  const base = getBasePath();
  if (base && pathname.startsWith(base)) {
    const after = pathname.slice(base.length) || '/';
    return after;
  }
  return pathname || '/';
}

export function App() {
  const [pathAfterBase, setPathAfterBase] = useState(getPathAfterBase);
  const [sessionReady, setSessionReady] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginHandle, setLoginHandle] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const onPopState = () => setPathAfterBase(getPathAfterBase());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const hasOAuth = params.has('state') && (params.has('code') || params.has('error'));
        if (hasOAuth) {
          const { initOAuth } = await import('../lib/oauth');
          const result = await initOAuth({ hasCallback: true });
          if (result?.session && !cancelled) {
            const { Agent } = await import('@atproto/api');
            const { setOAuthAgent, addOAuthDid } = await import('../lib/bsky');
            const agent = new Agent(result.session);
            setOAuthAgent(agent, result.session);
            addOAuthDid(agent.did!, true);
            window.history.replaceState({}, '', window.location.pathname + window.location.hash);
          }
        } else {
          const { resumeSession } = await import('../lib/bsky');
          await resumeSession();
        }
      } catch (e) {
        console.error('Session restore failed:', e);
      }
      if (!cancelled) {
        setSessionReady(true);
        const { getSession } = await import('../lib/bsky');
        setIsLoggedIn(!!getSession());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onLoginSubmit = async (e: Event) => {
    e.preventDefault();
    const handle = loginHandle.trim();
    if (!handle) return;
    setLoginError('');
    try {
      const { signInWithOAuthRedirect, normalizeHandle } = await import('../lib/oauth');
      await signInWithOAuthRedirect(normalizeHandle(handle));
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const isPost = pathAfterBase.startsWith('/post/');
  const postUri = isPost ? pathAfterBase.replace(/^\/post\//, '').replace(/\/?$/, '') : null;

  return (
    <>
      {!sessionReady ? (
        <div class="app-content flex-center" style={{ minHeight: '60vh' }}>
          <div class="spinner" />
          <span style={{ marginLeft: 'var(--space-md)', color: 'var(--muted)' }}>Loading…</span>
        </div>
      ) : (
        <>
          {!pathAfterBase.match(/^\/?$/) && (
            <a href={withBase('/')} class="back-btn glass float-btn" aria-label="Back">
              ← Back
            </a>
          )}
          <div class="app-content">
            {isPost && postUri ? (
              <PostDetailView uri={decodeURIComponent(postUri)} />
            ) : (
              <FeedView />
            )}
          </div>
        </>
      )}
      {showLogin && (
        <div class="glass-strong" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-lg)' }}>
          <div style={{ maxWidth: 360, width: '100%' }}>
            <h2 style={{ marginBottom: 'var(--space-md)' }}>Log in with Bluesky</h2>
            <form onSubmit={onLoginSubmit}>
              <input
                type="text"
                placeholder="yourname.bsky.social"
                value={loginHandle}
                onInput={(e) => { setLoginHandle((e.target as HTMLInputElement).value); setLoginError(''); }}
                style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
                autoFocus
              />
              {loginError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', marginBottom: 'var(--space-sm)' }}>{loginError}</p>}
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button type="submit" class="btn">Continue</button>
                <button type="button" class="btn-ghost" onClick={() => { setShowLogin(false); setLoginError(''); }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <nav class="nav glass" aria-label="Main navigation">
        <a href={withBase('/')} class={pathAfterBase === '/' || pathAfterBase === '' ? 'active' : ''}>Home</a>
        <a href={withBase('/forum/')}>Forums</a>
        <a href={withBase('/artboards/')}>Collections</a>
        {isLoggedIn ? (
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>Logged in</span>
        ) : (
          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 'var(--space-sm) var(--space-md)', color: 'var(--muted)', fontSize: 'var(--font-xs)' }} onClick={() => setShowLogin(true)}>Log in</button>
        )}
      </nav>
    </>
  );
}
