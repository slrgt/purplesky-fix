/**
 * Reusable Like, Downvote, and Reply buttons for posts and comments.
 * Use <ActionBar /> for a full row, or individual buttons where needed.
 */

import { component$, useSignal, $ } from '@builder.io/qwik';
import { Link } from '@builder.io/qwik-city';

import './action-buttons.css';

// ── Like button (AT Protocol app.bsky.feed.like) ───────────────────────────

export interface LikeButtonProps {
  subjectUri: string;
  subjectCid: string;
  likeCount: number;
  liked: boolean;
  /** If set, we can unlike by deleting this record */
  likeRecordUri?: string;
  compact?: boolean;
  /** Hide the like count (e.g. on preview cards) */
  hideCount?: boolean;
  /** 'heart' for preview cards, 'upvote' for detail/threads */
  icon?: 'heart' | 'upvote';
}

export const LikeButton = component$<LikeButtonProps>(
  ({ subjectUri, subjectCid, likeCount: initialCount, liked: initialLiked, likeRecordUri: initialLikeRecordUri, compact, hideCount = false, icon = 'upvote' }) => {
    const liked = useSignal(initialLiked);
    const likeCount = useSignal(initialCount);
    /** After we create a like we store its URI here for unlike */
    const createdLikeUri = useSignal<string | undefined>(undefined);

    const handleClick = $(async () => {
      try {
        const { agent, getSession } = await import('~/lib/bsky');
        const session = getSession();
        if (!session?.did) return;
        const uriToDelete = initialLikeRecordUri ?? createdLikeUri.value;
        if (liked.value && uriToDelete) {
          const parsed = new URL(uriToDelete);
          const rkey = parsed.pathname.split('/').pop();
          if (rkey) {
            await agent.com.atproto.repo.deleteRecord({
              repo: session.did,
              collection: 'app.bsky.feed.like',
              rkey,
            });
          }
          liked.value = false;
          likeCount.value = Math.max(0, likeCount.value - 1);
          createdLikeUri.value = undefined;
        } else if (!liked.value) {
          const res = await agent.com.atproto.repo.createRecord({
            repo: session.did,
            collection: 'app.bsky.feed.like',
            record: {
              $type: 'app.bsky.feed.like',
              subject: { uri: subjectUri, cid: subjectCid },
              createdAt: new Date().toISOString(),
            },
          });
          liked.value = true;
          likeCount.value++;
          createdLikeUri.value = res.data.uri;
        }
      } catch (err) {
        console.error('Like failed:', err);
      }
    });

    const effectiveLiked = liked.value;
    const uriToUse = initialLikeRecordUri ?? createdLikeUri.value;

    return (
      <button
        type="button"
        class={`action-btn action-btn-upvote ${icon === 'heart' ? 'action-btn-heart' : ''} ${effectiveLiked ? 'action-btn-active' : ''} ${compact ? 'compact' : ''}`}
        aria-label={icon === 'heart' ? (effectiveLiked ? 'Unlike' : 'Like') : (effectiveLiked ? 'Remove upvote' : 'Upvote')}
        data-action="like"
        onClick$={async () => {
          if (effectiveLiked && !uriToUse) return;
          await handleClick();
        }}
      >
        {!hideCount && <span class="action-count">{likeCount.value}</span>}
        {icon === 'heart' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={effectiveLiked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={effectiveLiked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        )}
      </button>
    );
  },
);

// ── Downvote button (app.artsky.feed.downvote) ─────────────────────────────

export interface DownvoteButtonProps {
  subjectUri: string;
  subjectCid: string;
  downvoted: boolean;
  downvoteRecordUri?: string;
  /** Number of downvotes (shown to the right of the arrow) */
  downvoteCount?: number;
  /** Hide the downvote count (e.g. on preview cards) */
  hideCount?: boolean;
  onDownvote$?: () => void;
  onUndoDownvote$?: () => void;
  compact?: boolean;
}

export const DownvoteButton = component$<DownvoteButtonProps>(
  ({ subjectUri, subjectCid, downvoted: initialDownvoted, downvoteRecordUri: initialDownvoteRecordUri, downvoteCount = 0, hideCount = false, onDownvote$, onUndoDownvote$, compact }) => {
    const downvoted = useSignal(initialDownvoted || !!initialDownvoteRecordUri);
    const createdDownvoteUri = useSignal<string | undefined>(undefined);
    const uriToUse = initialDownvoteRecordUri ?? createdDownvoteUri.value;

    const handleClick = $(async () => {
      const currentlyDownvoted = downvoted.value;
      if (currentlyDownvoted) {
        if (onUndoDownvote$) {
          onUndoDownvote$();
        } else {
          const uri = initialDownvoteRecordUri ?? createdDownvoteUri.value;
          if (uri) {
            const { deleteDownvote } = await import('~/lib/bsky');
            await deleteDownvote(uri);
            createdDownvoteUri.value = undefined;
          }
        }
        downvoted.value = false;
      } else {
        if (onDownvote$) {
          onDownvote$();
        } else {
          const { createDownvote } = await import('~/lib/bsky');
          const uri = await createDownvote(subjectUri, subjectCid);
          createdDownvoteUri.value = uri;
        }
        downvoted.value = true;
      }
    });

    return (
      <button
        type="button"
        class={`action-btn ${downvoted.value ? 'action-btn-active' : ''} ${compact ? 'compact' : ''}`}
        aria-label={downvoted.value ? 'Remove downvote' : 'Downvote'}
        onClick$={handleClick}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={downvoted.value ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
        {!hideCount && <span class="action-count">{downvoteCount}</span>}
      </button>
    );
  },
);

// ── Reply button (link or toggle) ───────────────────────────────────────────

export interface ReplyButtonProps {
  href?: string;
  replyCount?: number;
  onClick$?: () => void;
  label?: string;
  compact?: boolean;
}

export const ReplyButton = component$<ReplyButtonProps>(
  ({ href, replyCount = 0, onClick$, label = 'Reply', compact }) => {
    if (href) {
      return (
        <Link href={href} class={`action-btn ${compact ? 'compact' : ''}`} aria-label="Comment">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          {replyCount > 0 && <span>{replyCount}</span>}
        </Link>
      );
    }
    return (
      <button
        type="button"
        class={`action-btn ${compact ? 'compact' : ''}`}
        aria-label={label}
        onClick$={onClick$}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        {replyCount > 0 && <span>{replyCount}</span>}
        <span>{label}</span>
      </button>
    );
  },
);

// ── Action bar (Like + Downvote + Reply) ───────────────────────────────────

export interface ActionBarProps {
  subjectUri: string;
  subjectCid: string;
  likeCount: number;
  liked: boolean;
  likeRecordUri?: string;
  /** Downvote count (for display and score). Omit/0 when unknown. */
  downvoteCount?: number;
  downvoted?: boolean;
  downvoteRecordUri?: string;
  onDownvote$?: () => void;
  onUndoDownvote$?: () => void;
  replyCount?: number;
  replyHref?: string;
  onReplyClick$?: () => void;
  compact?: boolean;
  /** Hide like/downvote counts and score (e.g. on preview cards) */
  hideVoteCounts?: boolean;
  /** Use heart icon for like (e.g. on preview cards) */
  likeIcon?: 'heart' | 'upvote';
}

export const ActionBar = component$<ActionBarProps>((props) => {
  const {
    subjectUri,
    subjectCid,
    likeCount,
    liked,
    likeRecordUri,
    downvoteCount = 0,
    downvoted = false,
    downvoteRecordUri,
    onDownvote$,
    onUndoDownvote$,
    replyCount = 0,
    replyHref,
    onReplyClick$,
    compact,
    hideVoteCounts = false,
    likeIcon = 'upvote',
  } = props;

  const score = likeCount - downvoteCount;

  return (
    <div class="action-bar">
      <LikeButton
        subjectUri={subjectUri}
        subjectCid={subjectCid}
        likeCount={likeCount}
        liked={liked}
        likeRecordUri={likeRecordUri}
        compact={compact}
        hideCount={hideVoteCounts}
        icon={likeIcon}
      />
      {!hideVoteCounts && <span class="action-score" aria-label={`Score: ${score}`}>{score}</span>}
      <DownvoteButton
        subjectUri={subjectUri}
        subjectCid={subjectCid}
        downvoted={downvoted}
        downvoteRecordUri={downvoteRecordUri}
        downvoteCount={downvoteCount}
        hideCount={hideVoteCounts}
        onDownvote$={onDownvote$}
        onUndoDownvote$={onUndoDownvote$}
        compact={compact}
      />
      <ReplyButton
        href={replyHref}
        replyCount={replyCount}
        onClick$={replyHref ? undefined : onReplyClick$}
        compact={compact}
      />
    </div>
  );
});
