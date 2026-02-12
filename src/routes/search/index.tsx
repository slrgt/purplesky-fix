/**
 * Search results page – full results for query from header search.
 */

import { component$, useSignal, useVisibleTask$ } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { Link } from '~/components/app-link/app-link';
import { RichText } from '~/components/rich-text/rich-text';
import { resizedAvatarUrl } from '~/lib/image-utils';
import { withBase } from '~/lib/path';
import type { PostView } from '~/lib/types';

export default component$(() => {
  const loc = useLocation();
  const q = (loc.url.searchParams.get('q') ?? '').trim();

  const posts = useSignal<PostView[]>([]);
  const actors = useSignal<Array<{ did: string; handle: string; displayName?: string; avatar?: string }>>([]);
  const loading = useSignal(true);

  useVisibleTask$(async ({ track }) => {
    track(() => q);
    if (!q) {
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const [actorRes, postRes] = await Promise.all([
        import('~/lib/bsky').then((m) => m.searchActorsTypeahead(q, 20)),
        import('~/lib/bsky').then((m) => m.searchPostsByQuery(q)),
      ]);
      actors.value = (actorRes as { actors?: typeof actors.value })?.actors ?? [];
      posts.value = postRes.posts ?? [];
    } catch {
      posts.value = [];
      actors.value = [];
    }
    loading.value = false;
  });

  if (!q) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--muted)' }}>
        <p>Enter a search term in the header.</p>
      </div>
    );
  }

  if (loading.value) {
    return (
      <div class="flex-center" style={{ padding: 'var(--space-2xl)' }}>
        <div class="spinner" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--font-xl)', marginBottom: 'var(--space-lg)' }}>
        Results for "{q}"
      </h1>

      {actors.value.length > 0 && (
        <section style={{ marginBottom: 'var(--space-xl)' }}>
          <h2 style={{ fontSize: 'var(--font-md)', fontWeight: '600', marginBottom: 'var(--space-md)' }}>People</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {actors.value.map((a) => (
              <Link
                key={a.did}
                href={withBase(`/profile/${encodeURIComponent(a.handle)}/`)}
                class="glass"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)', textDecoration: 'none', color: 'var(--text)' }}
              >
                {a.avatar && (
                  <img src={a.avatar} alt="" width="40" height="40" style={{ borderRadius: '50%' }} />
                )}
                <div>
                  <div style={{ fontWeight: '600' }}>{a.displayName || a.handle}</div>
                  <Link href={withBase(`/profile/${encodeURIComponent(a.handle)}/`)} style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)', textDecoration: 'none' }}>@{a.handle}</Link>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--font-md)', fontWeight: '600', marginBottom: 'var(--space-md)' }}>Posts</h2>
        {posts.value.length === 0 && actors.value.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No results found.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {posts.value.map((p) => {
            const rec = p.record as { text?: string };
            const postHref = withBase(`/post/${encodeURIComponent(p.uri)}/`);
            return (
              <div
                key={p.uri}
                class="glass"
                style={{ padding: 'var(--space-md)', color: 'var(--text)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                  {p.author?.avatar && (
                    <img src={resizedAvatarUrl(p.author.avatar, 24)} alt="" width="24" height="24" style={{ borderRadius: '50%' }} />
                  )}
                  <span style={{ fontWeight: '600' }}>{p.author?.displayName || p.author?.handle}</span>
                  {p.author?.handle && (
                    <Link href={withBase(`/profile/${encodeURIComponent(p.author.handle)}/`)} style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)', textDecoration: 'none' }}>@{p.author.handle}</Link>
                  )}
                </div>
                {rec?.text && (
                  <p style={{ fontSize: 'var(--font-sm)', lineHeight: '1.5' }}>
                    <RichText text={rec.text.slice(0, 200) + (rec.text.length > 200 ? '…' : '')} />
                  </p>
                )}
                <Link href={postHref} style={{ fontSize: 'var(--font-xs)', color: 'var(--accent)', marginTop: 'var(--space-xs)', display: 'inline-block' }}>View post</Link>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
});
