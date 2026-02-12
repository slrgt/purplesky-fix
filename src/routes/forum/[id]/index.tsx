/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Forum Post Detail – Threaded Replies, Voting, Wiki Promotion
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays a single forum post with:
 *  - Full post content with formatting
 *  - Threaded/nested replies (furl/unfurl)
 *  - Reply composer with @mentions
 *  - Like/downvote integration with Microcosm
 *  - Pin/highlight controls for post author
 *  - Promote to wiki page
 *  - Edit/delete for own posts
 *
 * HOW TO EDIT:
 *  - To change the reply threading depth, edit maxDepth
 *  - To add reaction types, extend the action buttons
 *  - Reply data uses app.purplesky.forum.reply lexicon
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useVisibleTask$, $ } from '@builder.io/qwik';
import { Link, useLocation, useNavigate } from '@builder.io/qwik-city';
import { RichText } from '~/components/rich-text/rich-text';
import { useAppState } from '~/context/app-context';
import { withBase } from '~/lib/path';
import { ActionBar } from '~/components/action-buttons/action-buttons';
import { CommentThread } from '~/components/comment-thread/comment-thread';
import type { ForumPost, ForumReply } from '~/lib/types';

export default component$(() => {
  const app = useAppState();
  const loc = useLocation();
  const nav = useNavigate();
  const postUri = decodeURIComponent(loc.params.id);

  const post = useSignal<ForumPost | null>(null);
  const replies = useSignal<ForumReply[]>([]);
  const loading = useSignal(true);
  const replyText = useSignal('');
  const editing = useSignal(false);
  const editTitle = useSignal('');
  const editBody = useSignal('');
  const confirmDelete = useSignal(false);
  /** Map reply/post URI -> downvote record URI (for comments and main post) */
  const myDownvoteUris = useSignal<Record<string, string>>({});
  /** Downvote counts per reply/post URI (for sort and display) */
  const replyDownvoteCounts = useSignal<Record<string, number>>({});
  /** Comment sort mode */
  const commentSortMode = useSignal<'newest' | 'oldest' | 'best' | 'controversial' | 'replies'>('best');

  // Load post, replies, my downvotes, and downvote counts
  useVisibleTask$(async () => {
    try {
      const { getForumPost, listForumReplies } = await import('~/lib/forum');
      const [p, r] = await Promise.all([
        getForumPost(postUri),
        listForumReplies(postUri, app.session.did ? [app.session.did] : []),
      ]);
      post.value = p;
      replies.value = r;
      if (app.session.did) {
        const { listMyDownvotes } = await import('~/lib/bsky');
        myDownvoteUris.value = await listMyDownvotes();
      }
      const uris: string[] = p?.uri ? [p.uri] : [];
      r.forEach((reply) => uris.push(reply.uri));
      if (uris.length > 0) {
        const { getDownvoteCounts } = await import('~/lib/constellation');
        replyDownvoteCounts.value = await getDownvoteCounts(uris);
      }
    } catch (err) {
      console.error('Failed to load post:', err);
    }
    loading.value = false;
  });

  // Submit reply
  const handleReply = $(async () => {
    if (!replyText.value.trim()) return;
    try {
      const { createForumReply, listForumReplies } = await import('~/lib/forum');
      await createForumReply({ postUri, text: replyText.value });
      replyText.value = '';
      replies.value = await listForumReplies(postUri, app.session.did ? [app.session.did] : []);
    } catch (err) {
      console.error('Failed to reply:', err);
    }
  });

  // Promote to wiki
  const handlePromoteWiki = $(async () => {
    try {
      const { promoteToWiki } = await import('~/lib/forum');
      await promoteToWiki(postUri);
      const { getForumPost } = await import('~/lib/forum');
      post.value = await getForumPost(postUri);
    } catch (err) {
      console.error('Failed to promote:', err);
    }
  });

  // Start editing
  const startEdit = $(() => {
    if (!post.value) return;
    editTitle.value = post.value.title ?? '';
    editBody.value = post.value.body ?? '';
    editing.value = true;
  });

  // Save edit
  const saveEdit = $(async () => {
    if (!post.value) return;
    try {
      const { editForumPost, getForumPost } = await import('~/lib/forum');
      await editForumPost(postUri, {
        title: editTitle.value,
        body: editBody.value,
      });
      post.value = await getForumPost(postUri);
      editing.value = false;
    } catch (err) {
      console.error('Failed to save edit:', err);
    }
  });

  // Delete post
  const handleDelete = $(async () => {
    if (!confirmDelete.value) {
      confirmDelete.value = true;
      return;
    }
    try {
      const { deleteForumPost } = await import('~/lib/forum');
      await deleteForumPost(postUri);
      nav(withBase('/forum/'));
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  });

  if (loading.value) {
    return <div class="flex-center" style={{ padding: 'var(--space-2xl)' }}><div class="spinner" /></div>;
  }

  if (!post.value) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--muted)' }}>
        <h2>Post not found</h2>
      </div>
    );
  }

  const p = post.value;
  const isAuthor = app.session.did === p.did;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Post Header */}
      <article class="glass-strong" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
          {p.isPinned && <span class="badge">Pinned</span>}
          {p.isWiki && <span class="badge-success badge">Wiki</span>}
        </div>

        <h1 style={{ fontSize: 'var(--font-2xl)', fontWeight: '700', marginBottom: 'var(--space-md)' }}>
          {p.title || 'Untitled'}
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', color: 'var(--muted)', fontSize: 'var(--font-sm)' }}>
          {p.authorAvatar && (
            <img src={p.authorAvatar} alt="" width="28" height="28" style={{ borderRadius: '50%' }} />
          )}
          {p.authorHandle ? (
            <Link href={withBase(`/profile/${encodeURIComponent(p.authorHandle)}/`)} style={{ color: 'inherit', textDecoration: 'none' }}>@{p.authorHandle}</Link>
          ) : (
            <span>@{p.did}</span>
          )}
          {p.createdAt && <span>{new Date(p.createdAt).toLocaleDateString()}</span>}
        </div>

        {/* Post body (edit mode or display) */}
        {editing.value ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <input
              type="text"
              value={editTitle.value}
              onInput$={(_, el) => { editTitle.value = el.value; }}
              style={{ fontSize: 'var(--font-lg)', fontWeight: '700', padding: 'var(--space-sm)' }}
              placeholder="Title"
            />
            <textarea
              value={editBody.value}
              onInput$={(_, el) => { editBody.value = el.value; }}
              style={{ minHeight: '200px', resize: 'vertical', lineHeight: '1.7', padding: 'var(--space-sm)' }}
              placeholder="Post body..."
            />
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <button class="btn" onClick$={saveEdit}>Save</button>
              <button class="btn-ghost" onClick$={() => { editing.value = false; confirmDelete.value = false; }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ lineHeight: '1.7' }}>
            <RichText text={p.body ?? ''} />
          </div>
        )}

        {/* Tags */}
        {!editing.value && p.tags && p.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-lg)', flexWrap: 'wrap' }}>
            {p.tags.map((tag) => (
              <span key={tag} class="badge">#{tag}</span>
            ))}
          </div>
        )}

        {/* Like, Downvote, Reply */}
        {!editing.value && (
          <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
            <ActionBar
              subjectUri={p.uri}
              subjectCid={p.cid}
              likeCount={p.likeCount ?? 0}
              liked={false}
              downvoteCount={replyDownvoteCounts.value[p.uri] ?? 0}
              downvoted={!!myDownvoteUris.value[p.uri]}
              downvoteRecordUri={myDownvoteUris.value[p.uri]}
              onDownvote$={app.session.isLoggedIn ? $(async () => {
                const { listMyDownvotes } = await import('~/lib/bsky');
                myDownvoteUris.value = await listMyDownvotes();
                replyDownvoteCounts.value = { ...replyDownvoteCounts.value, [p.uri]: (replyDownvoteCounts.value[p.uri] ?? 0) + 1 };
              }) : undefined}
              onUndoDownvote$={app.session.isLoggedIn ? $(async () => {
                const { listMyDownvotes } = await import('~/lib/bsky');
                myDownvoteUris.value = await listMyDownvotes();
                replyDownvoteCounts.value = { ...replyDownvoteCounts.value, [p.uri]: Math.max(0, (replyDownvoteCounts.value[p.uri] ?? 0) - 1) };
              }) : undefined}
              replyCount={p.replyCount ?? replies.value.length}
              replyHref={withBase(`/forum/${encodeURIComponent(postUri)}/`)}
            />
          </div>
        )}

        {/* Author actions */}
        {isAuthor && !editing.value && (
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
            <button class="btn-ghost" style={{ fontSize: 'var(--font-sm)' }} onClick$={startEdit}>Edit</button>
            {!p.isWiki && (
              <button class="btn-ghost" style={{ fontSize: 'var(--font-sm)' }} onClick$={handlePromoteWiki}>
                Promote to Wiki
              </button>
            )}
            <button
              class="btn-ghost"
              style={{ fontSize: 'var(--font-sm)', color: 'var(--danger)' }}
              onClick$={handleDelete}
            >
              {confirmDelete.value ? 'Confirm Delete?' : 'Delete'}
            </button>
          </div>
        )}
      </article>

      {/* Replies Section */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: '600', marginBottom: 'var(--space-md)' }}>
          Replies ({replies.value.length})
        </h2>

        {/* Reply composer */}
        {app.session.isLoggedIn && (
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
            <textarea
              placeholder="Write a reply... Use @username for mentions"
              value={replyText.value}
              onInput$={(_, el) => { replyText.value = el.value; }}
              style={{ flex: 1, minHeight: '80px', resize: 'vertical' }}
            />
            <button class="btn" onClick$={handleReply} style={{ alignSelf: 'flex-end' }}>
              Reply
            </button>
          </div>
        )}

        {/* Sort + threaded replies */}
        {replies.value.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
            <span style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)' }}>Sort:</span>
            <select
              value={commentSortMode.value}
              onChange$={(_, el) => { commentSortMode.value = el.value as typeof commentSortMode.value; }}
              style={{ fontSize: 'var(--font-sm)', padding: 'var(--space-xs) var(--space-sm)', borderRadius: 'var(--glass-radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="best">Best</option>
              <option value="controversial">Controversial</option>
              <option value="replies">Most Replies</option>
            </select>
          </div>
        )}
        <CommentThread
          replies={replies.value}
          postUri={postUri}
          sortOrder={commentSortMode.value}
          downvoteCounts={replyDownvoteCounts.value}
          myDownvoteUris={myDownvoteUris.value}
          onDownvoteChange$={app.session.isLoggedIn ? $(async (uri: string, action: 'downvote' | 'undo') => {
            const { listMyDownvotes } = await import('~/lib/bsky');
            myDownvoteUris.value = await listMyDownvotes();
            const delta = action === 'downvote' ? 1 : -1;
            replyDownvoteCounts.value = { ...replyDownvoteCounts.value, [uri]: Math.max(0, (replyDownvoteCounts.value[uri] ?? 0) + delta) };
          }) : undefined}
        />
      </div>
    </div>
  );
});
