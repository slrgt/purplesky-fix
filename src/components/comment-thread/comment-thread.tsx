/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CommentThread – Nested/Threaded Replies with Furl/Unfurl
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renders a tree of nested replies with:
 *  - Collapsible threads (furl/unfurl)
 *  - Inline reply forms
 *  - Like/downvote per reply
 *  - Author avatar and handle
 *  - Time ago formatting
 *  - Depth-based indentation (max 5 levels)
 *
 * HOW TO EDIT:
 *  - To change max nesting depth, edit MAX_DEPTH
 *  - To change the indentation per level, edit the paddingLeft calc
 *  - To add new reply actions (edit, delete), add buttons to the action row
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, $ } from '@builder.io/qwik';
import type { ForumReply } from '~/lib/types';
import { resizedAvatarUrl } from '~/lib/image-utils';
import { withBase } from '~/lib/path';
import { ActionBar } from '~/components/action-buttons/action-buttons';
import { FollowBell } from '~/components/follow-bell/follow-bell';
import { RichText } from '~/components/rich-text/rich-text';
import { Link } from '~/components/app-link/app-link';

import './comment-thread.css';

const MAX_DEPTH = 5;

export type CommentSortMode = 'newest' | 'oldest' | 'best' | 'controversial' | 'replies';

interface CommentThreadProps {
  replies: ForumReply[];
  postUri: string;
  parentUri?: string;
  depth?: number;
  /** Sort mode for sibling replies at each level */
  sortOrder?: CommentSortMode;
  /** Downvote counts per reply URI (for display and score-based sort) */
  downvoteCounts?: Record<string, number>;
  /** Map reply URI -> downvote record URI (for "I downvoted" state) */
  myDownvoteUris?: Record<string, string>;
  /** Called after user downvotes/undoes: (uri, action) so parent can refresh maps and counts */
  onDownvoteChange$?: (uri: string, action: 'downvote' | 'undo') => void;
}

export const CommentThread = component$<CommentThreadProps>(
  ({ replies, postUri, parentUri, depth = 0, sortOrder = 'best', downvoteCounts = {}, myDownvoteUris = {}, onDownvoteChange$ }) => {
    // Filter replies for this level
    let levelReplies = replies.filter((r) => {
      if (depth === 0) return !r.replyTo;
      return r.replyTo === parentUri;
    });

    // Sort siblings by sortOrder (using downvoteCounts for score when best/controversial)
    const getCreated = (r: ForumReply) => r.record?.createdAt ?? '';
    const getScore = (r: ForumReply) => (r.likeCount ?? 0) - (downvoteCounts[r.uri] ?? 0);
    const getControversy = (r: ForumReply) => {
      const likes = r.likeCount ?? 0;
      const downs = downvoteCounts[r.uri] ?? 0;
      const total = likes + downs;
      if (total === 0) return 0;
      const ratio = likes / total;
      return total * (1 - 2 * Math.abs(ratio - 0.5));
    };
    const getReplyCount = (r: ForumReply) => replies.filter((c) => c.replyTo === r.uri).length;
    levelReplies = [...levelReplies].sort((a, b) => {
      if (sortOrder === 'newest') return getCreated(b).localeCompare(getCreated(a));
      if (sortOrder === 'oldest') return getCreated(a).localeCompare(getCreated(b));
      if (sortOrder === 'best') return getScore(b) - getScore(a);
      if (sortOrder === 'controversial') return getControversy(b) - getControversy(a);
      if (sortOrder === 'replies') return getReplyCount(b) - getReplyCount(a);
      return 0;
    });

    if (levelReplies.length === 0) return null;

    return (
      <div>
        {levelReplies.map((reply) => (
          <CommentNode
            key={reply.uri}
            reply={reply}
            allReplies={replies}
            postUri={postUri}
            depth={depth}
            sortOrder={sortOrder}
            downvoteCounts={downvoteCounts}
            myDownvoteUris={myDownvoteUris}
            onDownvoteChange$={onDownvoteChange$}
          />
        ))}
      </div>
    );
  },
);

// ── Single Comment Node ───────────────────────────────────────────────────

const CommentNode = component$<{
  reply: ForumReply;
  allReplies: ForumReply[];
  postUri: string;
  depth: number;
  sortOrder?: CommentSortMode;
  downvoteCounts?: Record<string, number>;
  myDownvoteUris?: Record<string, string>;
  onDownvoteChange$?: (uri: string, action: 'downvote' | 'undo') => void;
}>(({ reply, allReplies, postUri, depth, sortOrder = 'best', downvoteCounts = {}, myDownvoteUris = {}, onDownvoteChange$ }) => {
  const collapsed = useSignal(false);
  const showReply = useSignal(false);
  const replyText = useSignal('');

  const childCount = allReplies.filter((r) => r.replyTo === reply.uri).length;

  const timeAgo = (() => {
    if (!reply.record?.createdAt) return '';
    const diff = Date.now() - new Date(reply.record.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  })();

  const handleSubmitReply = $(async () => {
    if (!replyText.value.trim()) return;
    try {
      const { createForumReply } = await import('~/lib/forum');
      await createForumReply({
        postUri, text: replyText.value, replyToUri: reply.uri,
      });
      replyText.value = '';
      showReply.value = false;
    } catch (err) {
      console.error('Reply failed:', err);
    }
  });

  return (
    <div class="ct-node" style={{ marginBottom: 'var(--space-xs)' }}>
      {/* Two-column layout: left gutter (collapse) | right content */}
      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
        {/* ── Left gutter: collapse button + full-height bar ── */}
        <div class="ct-gutter">
          <button
            type="button"
            class="ct-collapse-btn"
            onClick$={() => { collapsed.value = !collapsed.value; }}
            aria-label={collapsed.value ? `Expand ${childCount} replies` : 'Collapse thread'}
          >
            {collapsed.value ? '+' : '\u2013'}
          </button>
          <button
            type="button"
            class="ct-collapse-bar"
            onClick$={() => { collapsed.value = !collapsed.value; }}
            aria-label={collapsed.value ? 'Expand thread' : 'Collapse thread'}
          />
        </div>

        {/* ── Right content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ padding: 'var(--space-xs) 0 var(--space-xs) var(--space-sm)' }}>
            {/* Author row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
              <Link href={withBase(`/profile/${encodeURIComponent(reply.author.handle)}/`)} style={{ display: 'block', flexShrink: 0 }}>
                {reply.author.avatar ? (
                  <img src={resizedAvatarUrl(reply.author.avatar, 20)} alt="" width={20} height={20} style={{ borderRadius: '50%', display: 'block' }} loading="lazy" />
                ) : (
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--border)' }} />
                )}
              </Link>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
                {reply.author.displayName && (
                  <span style={{ fontSize: 'var(--font-sm)', fontWeight: '600' }}>{reply.author.displayName}</span>
                )}
                <Link href={withBase(`/profile/${encodeURIComponent(reply.author.handle)}/`)} style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)', textDecoration: 'none' }}>@{reply.author.handle}</Link>
              </div>
              <FollowBell
                authorDid={reply.author.did}
                followUri={(reply.author as { viewer?: { following?: string } }).viewer?.following}
                followOnAvatar
                bellKind="comment"
                bellTarget={reply.uri}
                compact
              />
              <span style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>{timeAgo}</span>
              {collapsed.value && childCount > 0 && (
                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--accent)', marginLeft: 'auto' }}>
                  +{childCount} {childCount === 1 ? 'reply' : 'replies'}
                </span>
              )}
            </div>

            {/* Collapsed: hide body */}
            {!collapsed.value && (
              <>
                {/* Reply text */}
                <p style={{ fontSize: 'var(--font-sm)', lineHeight: '1.5' }}>
                  <RichText text={reply.record?.text ?? ''} />
                </p>

                {/* Actions: Like, Downvote, Reply (reusable ActionBar) */}
                <div style={{ marginTop: 'var(--space-xs)' }}>
                  <ActionBar
                    subjectUri={reply.uri}
                    subjectCid={reply.cid}
                    likeCount={reply.likeCount ?? 0}
                    liked={!!reply.viewer?.like}
                    likeRecordUri={reply.viewer?.like}
                    downvoteCount={downvoteCounts[reply.uri] ?? 0}
                    downvoted={!!myDownvoteUris[reply.uri]}
                    downvoteRecordUri={myDownvoteUris[reply.uri]}
                    onDownvote$={onDownvoteChange$ ? $(() => { onDownvoteChange$(reply.uri, 'downvote'); }) : undefined}
                    onUndoDownvote$={onDownvoteChange$ ? $(() => { onDownvoteChange$(reply.uri, 'undo'); }) : undefined}
                    replyCount={childCount}
                    replyHref={depth >= MAX_DEPTH ? withBase(`/forum/${encodeURIComponent(postUri)}/`) : undefined}
                    onReplyClick$={depth < MAX_DEPTH ? () => { showReply.value = !showReply.value; } : undefined}
                    compact
                  />
                </div>

                {/* Inline reply form */}
                {showReply.value && (
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                    <input
                      type="text"
                      placeholder="Write a reply..."
                      value={replyText.value}
                      onInput$={(_, el) => { replyText.value = el.value; }}
                      style={{ flex: 1, fontSize: 'var(--font-sm)', padding: '4px 8px' }}
                    />
                    <button class="btn" style={{ fontSize: 'var(--font-xs)', padding: '4px 10px' }} onClick$={handleSubmitReply}>
                      Reply
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Nested children */}
          {!collapsed.value && childCount > 0 && (
            <CommentThread
              replies={allReplies}
              postUri={postUri}
              parentUri={reply.uri}
              depth={depth + 1}
              sortOrder={sortOrder}
              downvoteCounts={downvoteCounts}
              myDownvoteUris={myDownvoteUris}
              onDownvoteChange$={onDownvoteChange$}
            />
          )}
        </div>
      </div>
    </div>
  );
});
