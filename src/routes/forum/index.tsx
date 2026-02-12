/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Forum Page – Threaded Discussions, Knowledge Bases, Collaboration
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Features:
 *  - Create and browse forum posts using AT Protocol lexicons
 *  - Sort by newest, activity, or pinned
 *  - Filter by tags
 *  - Search threads
 *  - @mentions for tagging users
 *  - Draft posts saved locally for later editing
 *  - Pinned and highlighted posts
 *  - Wiki pages promoted from threads
 *  - Integration with Microcosm constellations for voting
 *
 * HOW TO EDIT:
 *  - To add new sort modes, add options to the sort select
 *  - To change the post form, edit the compose section
 *  - Forum data uses the app.purplesky.forum.post lexicon
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useStore, useVisibleTask$, $ } from '@builder.io/qwik';
import { Link } from '@builder.io/qwik-city';
import { withBase } from '~/lib/path';
import { useAppState } from '~/context/app-context';
import type { ForumPost } from '~/lib/types';

export default component$(() => {
  const app = useAppState();
  const posts = useSignal<ForumPost[]>([]);
  const loading = useSignal(true);
  const showCompose = useSignal(false);
  const sortBy = useSignal<'newest' | 'activity' | 'pinned'>('newest');
  const filterTag = useSignal('');

  // Compose form state
  const compose = useStore({ title: '', body: '', tags: '' });

  // Load forum posts
  useVisibleTask$(async () => {
    if (!app.session.did) { loading.value = false; return; }
    try {
      const { listForumPosts } = await import('~/lib/forum');
      const result = await listForumPosts(app.session.did, { limit: 50 });
      posts.value = result.posts;
    } catch (err) {
      console.error('Failed to load forum posts:', err);
    }
    loading.value = false;
  });

  // Create post handler
  const handleCreatePost = $(async () => {
    if (!compose.title.trim()) return;
    try {
      const { createForumPost } = await import('~/lib/forum');
      await createForumPost({
        title: compose.title,
        body: compose.body,
        tags: compose.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      compose.title = '';
      compose.body = '';
      compose.tags = '';
      showCompose.value = false;
      // Reload posts
      if (app.session.did) {
        const { listForumPosts } = await import('~/lib/forum');
        const result = await listForumPosts(app.session.did, { limit: 50 });
        posts.value = result.posts;
      }
    } catch (err) {
      console.error('Failed to create post:', err);
    }
  });

  // Save draft (dynamic import – no require() in ESM)
  const handleSaveDraft = $(async () => {
    const { saveDraft } = await import('~/lib/forum');
    saveDraft({ title: compose.title, body: compose.body, tags: compose.tags.split(',').map((t) => t.trim()).filter(Boolean) });
    showCompose.value = false;
  });

  // Filtered & sorted posts
  const displayPosts = posts.value
    .filter((p) => !filterTag.value || p.tags?.includes(filterTag.value))
    .sort((a, b) => {
      if (sortBy.value === 'pinned') {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
      }
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });

  return (
    <div class="forum-page">
      <div class="flex-between" style={{ marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: 'var(--font-2xl)', fontWeight: '700' }}>Forums</h1>
        {app.session.isLoggedIn && (
          <button class="btn" onClick$={() => { showCompose.value = !showCompose.value; }}>
            + New Post
          </button>
        )}
      </div>

      {/* Compose Form */}
      {showCompose.value && (
        <div class="glass-strong" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
          <input
            type="text"
            placeholder="Post title"
            value={compose.title}
            onInput$={(_, el) => { compose.title = el.value; }}
            style={{ width: '100%', marginBottom: 'var(--space-sm)', fontSize: 'var(--font-lg)', fontWeight: '600' }}
          />
          <textarea
            placeholder="Write your post... Use @username for mentions"
            value={compose.body}
            onInput$={(_, el) => { compose.body = el.value; }}
            style={{ width: '100%', minHeight: '150px', marginBottom: 'var(--space-sm)', resize: 'vertical' }}
          />
          <input
            type="text"
            placeholder="Tags (comma-separated)"
            value={compose.tags}
            onInput$={(_, el) => { compose.tags = el.value; }}
            style={{ width: '100%', marginBottom: 'var(--space-md)' }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button class="btn" onClick$={handleCreatePost}>Post</button>
            <button class="btn-ghost" onClick$={handleSaveDraft}>Save Draft</button>
            <button class="btn-ghost" onClick$={() => { showCompose.value = false; }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Sort & Filter */}
      <div class="flex-between" style={{ marginBottom: 'var(--space-md)', gap: 'var(--space-sm)' }}>
        <select
          value={sortBy.value}
          onChange$={(_, el) => { sortBy.value = el.value as typeof sortBy.value; }}
          style={{ fontSize: 'var(--font-sm)' }}
        >
          <option value="newest">Newest</option>
          <option value="activity">Most Activity</option>
          <option value="pinned">Pinned First</option>
        </select>
        <input
          type="text"
          placeholder="Filter by tag..."
          value={filterTag.value}
          onInput$={(_, el) => { filterTag.value = el.value; }}
          style={{ maxWidth: '200px', fontSize: 'var(--font-sm)' }}
        />
      </div>

      {/* Posts List */}
      {loading.value ? (
        <div class="flex-center" style={{ padding: 'var(--space-2xl)' }}>
          <div class="spinner" />
        </div>
      ) : displayPosts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--muted)' }}>
          <p>No forum posts yet. Be the first to start a discussion!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {displayPosts.map((post) => (
            <Link
              key={post.uri}
              href={withBase(`/forum/${encodeURIComponent(post.uri)}/`)}
              class="glass"
              style={{
                display: 'block', padding: 'var(--space-md)', textDecoration: 'none', color: 'var(--text)',
                transition: 'transform var(--transition-fast)',
                border: post.isPinned ? '1px solid var(--accent)' : undefined,
              }}
            >
              <div class="flex-between">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    {post.isPinned && <span class="badge">Pinned</span>}
                    {post.isWiki && <span class="badge-success badge">Wiki</span>}
                    <h3 class="truncate" style={{ fontSize: 'var(--font-base)', fontWeight: '600' }}>
                      {post.title || 'Untitled'}
                    </h3>
                  </div>
                  {post.body && (
                    <p class="truncate" style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)' }}>
                      {post.body.slice(0, 120)}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-xs)', fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>
                    {post.authorHandle && <span>@{post.authorHandle}</span>}
                    {post.createdAt && <span>{new Date(post.createdAt).toLocaleDateString()}</span>}
                    {post.tags?.map((tag) => (
                      <span key={tag} class="badge" style={{ fontSize: '10px' }}>#{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Login prompt */}
      {!app.session.isLoggedIn && (
        <div class="glass" style={{ textAlign: 'center', padding: 'var(--space-xl)', marginTop: 'var(--space-lg)' }}>
          <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-md)' }}>
            Log in to create posts, reply, and collaborate.
          </p>
          <button class="btn" onClick$={() => { app.showLoginModal = true; }}>Log In</button>
        </div>
      )}
    </div>
  );
});
