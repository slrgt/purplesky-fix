/**
 * Feed page: mixed timeline (or public What's Hot when logged out).
 */
import { useState, useEffect } from 'preact/hooks';
import { getSession, getMixedFeed } from '../lib/bsky';
import type { TimelineItem, FeedMixEntry } from '../lib/types';
import { PostCard } from './PostCard';
import { withBase } from '../lib/path';

const DEFAULT_MIX_LOGGED_IN: FeedMixEntry[] = [
  { source: { kind: 'timeline', label: 'Following' }, percent: 100 },
];
const DEFAULT_MIX_LOGGED_OUT: FeedMixEntry[] = [
  {
    source: {
      kind: 'custom',
      label: "What's Hot",
      uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot',
    },
    percent: 100,
  },
];

export function FeedView() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = getSession();
        const mix = session ? DEFAULT_MIX_LOGGED_IN : DEFAULT_MIX_LOGGED_OUT;
        const result = await getMixedFeed(mix, 30, undefined, !session);
        if (!cancelled) setItems(result.feed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load feed');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div class="flex-center" style={{ minHeight: '40vh', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div class="spinner" />
        <span style={{ color: 'var(--muted)' }}>Loading feed…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div class="flex-center" style={{ minHeight: '40vh', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div class="flex-center" style={{ minHeight: '40vh', color: 'var(--muted)' }}>
        No posts yet. Log in to see your timeline.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
      {items.map((item) => (
        <PostCard key={item.post.uri} item={item} />
      ))}
    </div>
  );
}
