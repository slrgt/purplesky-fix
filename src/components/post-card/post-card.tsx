/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PostCard – Individual Post in the Feed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays a single post with:
 *  - Media (image or video) with aspect-ratio-aware container
 *  - Author info (avatar, handle, display name)
 *  - Post text (truncated)
 *  - Action row: like, downvote, repost, comment, save to collection
 *  - Seen tracking: when scrolled past, marked as seen
 *  - NSFW blur overlay
 *  - Collection indicator (outline when saved)
 *
 * HOW TO EDIT:
 *  - To change what info is shown, edit the JSX below
 *  - To change the card style, edit post-card.css
 *  - To add new actions (e.g., share), add a button to the action row
 *  - Media rendering: images show directly, videos use HLS.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useVisibleTask$, type QRL } from '@builder.io/qwik';
import { Link, useNavigate } from '@builder.io/qwik-city';
import type { TimelineItem, CardViewMode } from '~/lib/types';
import { withBase } from '~/lib/path';
import { resizedAvatarUrl } from '~/lib/image-utils';
import { ActionBar } from '~/components/action-buttons/action-buttons';
import { FollowBell } from '~/components/follow-bell/follow-bell';
import { RichText } from '~/components/rich-text/rich-text';

import './post-card.css';

interface ArtboardOption {
  id: string;
  name: string;
}

interface PostCardProps {
  item: TimelineItem;
  isSeen: boolean;
  onSeen$: QRL<() => void>;
  /** Card layout: full, mini, art */
  cardViewMode?: CardViewMode;
  /** When true, show NSFW blur overlay until user taps (parent tracks unblurred) */
  nsfwBlurred?: boolean;
  onNsfwUnblur$?: QRL<() => void>;
  /** Number of downvotes (for score display). From constellation when available. */
  downvoteCount?: number;
  /** If set, current user has downvoted this post (value = downvote record URI to undo) */
  myDownvoteUri?: string;
  onDownvote$?: QRL<() => void>;
  onUndoDownvote$?: QRL<() => void>;
  artboards?: ArtboardOption[];
  onAddToArtboard$?: QRL<(boardId: string) => void>;
  isInAnyArtboard?: boolean;
  /** Whether this card has keyboard focus */
  isSelected?: boolean;
  /** Whether the mouse is over this card (keeps hover look during keyboard nav) */
  isMouseOver?: boolean;
}

export const PostCard = component$<PostCardProps>(({
  item,
  isSeen,
  onSeen$,
  cardViewMode = 'full',
  nsfwBlurred = false,
  onNsfwUnblur$,
  downvoteCount = 0,
  myDownvoteUri,
  onDownvote$,
  onUndoDownvote$,
  artboards = [],
  onAddToArtboard$,
  isInAnyArtboard = false,
  isSelected = false,
  isMouseOver = false,
}) => {
  const post = item.post;
  const record = post.record as { text?: string; createdAt?: string };
  const cardRef = useSignal<HTMLElement>();
  const nav = useNavigate();
  const showCollectionDropdown = useSignal(false);
  const isDownvoted = useSignal(!!myDownvoteUri);

  // ── Extract media from embed ──────────────────────────────────────────
  const embed = post.embed as Record<string, unknown> | undefined;
  const mediaType = embed?.$type as string | undefined;
  const mediaEmbed = embed?.media as Record<string, unknown> | undefined;
  const isImage = mediaType === 'app.bsky.embed.images#view' || (mediaEmbed?.$type as string) === 'app.bsky.embed.images#view';
  const isVideo = mediaType === 'app.bsky.embed.video#view' || (mediaEmbed?.$type as string) === 'app.bsky.embed.video#view';
  const images = (embed?.images as Array<{ thumb: string; fullsize: string; aspectRatio?: { width: number; height: number } }>) ?? [];
  const videoThumb = (embed?.thumbnail as string) ?? (mediaEmbed?.thumbnail as string) ?? undefined;
  const videoPlaylist = (embed?.playlist as string) ?? (mediaEmbed?.playlist as string) ?? undefined;
  const hasMedia = isImage || isVideo || !!(embed?.media as Record<string, unknown>);
  const videoRef = useSignal<HTMLVideoElement>();

  // Check NSFW
  const nsfwVals = new Set(['porn', 'sexual', 'nudity', 'graphic-media']);
  const isNsfw = post.labels?.some((l) => nsfwVals.has(l.val)) ?? false;

  // ── Keyboard event handling (like/collect from feed keyboard nav) ─────
  useVisibleTask$(({ cleanup }) => {
    if (!cardRef.value) return;
    const el = cardRef.value;
    const onLike = () => {
      const likeBtn = el.querySelector<HTMLElement>('[data-action="like"]');
      likeBtn?.click();
    };
    const onCollect = () => {
      if (artboards.length > 0) {
        showCollectionDropdown.value = !showCollectionDropdown.value;
      }
    };
    el.addEventListener('keyboard-like', onLike);
    el.addEventListener('keyboard-collect', onCollect);
    cleanup(() => {
      el.removeEventListener('keyboard-like', onLike);
      el.removeEventListener('keyboard-collect', onCollect);
    });
  });

  // ── Seen tracking via IntersectionObserver ─────────────────────────────
  useVisibleTask$(({ cleanup }) => {
    if (!cardRef.value || isSeen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Mark as seen when the card scrolls out of view upward
          if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
            onSeen$();
            observer.disconnect();
          }
        }
      },
      { threshold: 0 },
    );
    observer.observe(cardRef.value);
    cleanup(() => observer.disconnect());
  });

  // ── Video autoplay when card is in view (feed cards) ───────────────────
  useVisibleTask$(async ({ track, cleanup }) => {
    track(() => videoRef.value);
    track(() => videoPlaylist);
    track(() => cardRef.value);
    if (!isVideo || !videoPlaylist || !cardRef.value) return;
    const videoEl = videoRef.value;
    if (!videoEl) return;
    let hlsInstance: import('hls.js').default | null = null;
    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (!entry || !videoEl) return;
        if (entry.isIntersecting) {
          if (hlsInstance) return;
          videoEl.muted = true;
          const Hls = (await import('hls.js')).default;
          if (Hls.isSupported()) {
            hlsInstance = new Hls();
            hlsInstance.loadSource(videoPlaylist);
            hlsInstance.attachMedia(videoEl);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => { videoEl.play().catch(() => {}); });
          } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = videoPlaylist;
            videoEl.load();
            videoEl.addEventListener('loadeddata', () => videoEl.play().catch(() => {}), { once: true });
          }
        } else {
          videoEl.pause();
          if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
          }
        }
      },
      { rootMargin: '50px', threshold: 0.1 },
    );
    observer.observe(cardRef.value);
    cleanup(() => {
      observer.disconnect();
      if (hlsInstance) hlsInstance.destroy();
    });
  });

  // ── Time ago formatting ─────────────────────────────────────────────────
  const timeAgo = (() => {
    if (!record?.createdAt) return '';
    const diff = Date.now() - new Date(record.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  })();

  // Use full path with base for both nav() and <Link>: Qwik resolves nav(path) via new URL(path, currentUrl),
  // so path-only "/post/xyz/" becomes origin + path (drops /purplesky/ on GitHub Pages). withBase fixes that.
  const postPathForNav = withBase(`/post/${encodeURIComponent(post.uri)}/`);
  const postPathForLink = postPathForNav;
  const profilePath = withBase(`/profile/${encodeURIComponent(post.author.handle)}/`);

  const showNsfwOverlay = nsfwBlurred;
  /** Require full press (pointerdown + pointerup) on this card to avoid phantom clicks from hover/move. */
  const cardReceivedPointerDown = useSignal(false);
  const cardReceivedPointerUp = useSignal(false);

  // ── Synchronous pointer tracking (prevents hover-triggered clicks) ───────
  // Qwik's onClick$/onPointerDownCapture$ run asynchronously, so the click handler can run before
  // pointerdown/up state is updated, causing hover or movement to be treated as a click. Native
  // listeners run in the same tick as the event, so state is correct when the async handler runs.
  useVisibleTask$(({ cleanup }) => {
    const el = cardRef.value;
    if (!el) return;
    const isRealPointerDown = (e: PointerEvent) =>
      (e.pointerType === 'mouse' && e.button === 0) ||
      e.pointerType === 'touch' ||
      (e.pointerType === 'pen' && e.isPrimary);
    const onPointerDown = (e: PointerEvent) => {
      if (!isRealPointerDown(e)) return;
      cardReceivedPointerDown.value = true;
      cardReceivedPointerUp.value = false;
    };
    const onPointerUp = () => {
      if (cardReceivedPointerDown.value) cardReceivedPointerUp.value = true;
    };
    const onPointerLeaveOrCancel = () => {
      cardReceivedPointerDown.value = false;
      cardReceivedPointerUp.value = false;
    };
    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointerup', onPointerUp, true);
    el.addEventListener('pointerleave', onPointerLeaveOrCancel, true);
    el.addEventListener('pointercancel', onPointerLeaveOrCancel, true);
    cleanup(() => {
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointerup', onPointerUp, true);
      el.removeEventListener('pointerleave', onPointerLeaveOrCancel, true);
      el.removeEventListener('pointercancel', onPointerLeaveOrCancel, true);
    });
  });

  return (
    <article
      ref={cardRef}
      class={`post-card glass post-card-${cardViewMode} ${isSeen ? 'post-card-seen' : ''} ${isInAnyArtboard ? 'post-card-in-collection' : ''} ${isSelected ? 'post-card-selected' : ''} ${isMouseOver ? 'post-card-mouse-over' : ''}`}
      data-post-uri={post.uri}
      onClick$={(e) => {
        const ev = e as MouseEvent;
        ev.preventDefault();
        ev.stopPropagation();
        if (!ev.isTrusted) return;
        if (!cardReceivedPointerDown.value || !cardReceivedPointerUp.value) return;
        const target = ev.target as HTMLElement | null;
        if (target?.closest?.('button, a[href], [data-action]')) {
          cardReceivedPointerDown.value = false;
          cardReceivedPointerUp.value = false;
          return;
        }
        cardReceivedPointerDown.value = false;
        cardReceivedPointerUp.value = false;
        nav(postPathForNav); // full path with base so GitHub Pages stays under /repo/
      }}
    >
      {/* ── Media ────────────────────────────────────────────────────── */}
      {hasMedia && (
        <div class="post-media-link post-media-wrap-outer">
          <div class="post-media-wrap">
            {isImage && images.length > 0 && (
              <div class={`post-media-stack ${images.length > 1 ? 'image-stack-viewport' : ''}`}>
                {images.map((img, i) => (
                  <img
                    key={i}
                    src={img.fullsize ?? img.thumb}
                    alt={(img as { alt?: string }).alt ?? ''}
                    class="post-media-img"
                    loading={i === 0 ? 'lazy' : undefined}
                    style={img.aspectRatio
                      ? { aspectRatio: `${img.aspectRatio.width} / ${img.aspectRatio.height}` }
                      : undefined}
                  />
                ))}
              </div>
            )}
            {isVideo && (
              <div class="post-video-wrap">
                {videoPlaylist ? (
                  <video
                    ref={videoRef}
                    class="post-media-img post-card-video"
                    muted
                    loop
                    playsInline
                    autoPlay
                    poster={videoThumb}
                    style={{ width: '100%', maxHeight: '500px', objectFit: 'contain', background: '#000' }}
                  />
                ) : videoThumb ? (
                  <>
                    <img src={videoThumb} alt="" class="post-media-img" loading="lazy" />
                    <div class="post-video-play">▶</div>
                  </>
                ) : null}
              </div>
            )}
            {showNsfwOverlay && (
              <div
                class="post-nsfw-overlay"
                onClick$={(e) => { e.preventDefault(); onNsfwUnblur$?.(); }}
                role="button"
                tabIndex={0}
                onKeyDown$={(e) => { if (e.key === 'Enter') { e.preventDefault(); onNsfwUnblur$?.(); } }}
              >
                <span>Sensitive Content</span>
                <small>Tap to reveal</small>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Author Row (hidden in mini except inline) ──────────────────── */}
      {(cardViewMode === 'full' || cardViewMode === 'art') && (
        <div class="post-meta">
          <span onClick$={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
            <Link href={profilePath} style={{ display: 'block', flexShrink: 0 }}>
              {post.author.avatar ? (
                <img src={resizedAvatarUrl(post.author.avatar, 24)} alt="" width={24} height={24} style={{ borderRadius: '50%', display: 'block' }} loading="lazy" />
              ) : (
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--border)' }} />
              )}
            </Link>
          </span>
          <Link href={profilePath} class="post-author post-author-selectable" style={{ flex: 1, minWidth: 0 }} onClick$={(e) => e.stopPropagation()}>
            <span class="post-handle truncate">
              {post.author.displayName || post.author.handle}
            </span>
          </Link>
          <span onClick$={(e) => e.stopPropagation()}>
          <FollowBell
            authorDid={post.author.did}
            followUri={(post.author as { viewer?: { following?: string } }).viewer?.following}
            followOnAvatar
            bellKind="user"
            bellTarget={post.author.did}
            compact
          />
          </span>
          <span class="post-time">{timeAgo}</span>
        </div>
      )}

      {/* ── Text (full: full snippet; art: one line; mini: skip) ────────── */}
      {record?.text && cardViewMode !== 'mini' && (
        <p
          class={`post-text ${cardViewMode === 'art' ? 'post-text-art' : ''}`}
          onClick$={(e) => e.stopPropagation()}
        >
          <RichText
            text={cardViewMode === 'art'
              ? (record.text.length > 80 ? record.text.slice(0, 80) + '…' : record.text)
              : (record.text.length > 200 ? record.text.slice(0, 200) + '…' : record.text)}
          />
        </p>
      )}

      {/* Mini: compact author + time inline */}
      {cardViewMode === 'mini' && (
        <div class="post-meta post-meta-mini">
          <span onClick$={(e) => e.stopPropagation()}>
            <Link href={profilePath} style={{ display: 'block', flexShrink: 0 }}>
              {post.author.avatar ? (
                <img src={resizedAvatarUrl(post.author.avatar, 20)} alt="" width={20} height={20} style={{ borderRadius: '50%', display: 'block' }} loading="lazy" />
              ) : (
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--border)' }} />
              )}
            </Link>
          </span>
          <Link href={profilePath} class="post-author post-author-selectable" style={{ flex: 1, minWidth: 0 }} onClick$={(e) => e.stopPropagation()}>
            <span class="post-handle truncate">{post.author.handle}</span>
          </Link>
          <span onClick$={(e) => e.stopPropagation()}>
          <FollowBell
            authorDid={post.author.did}
            followUri={(post.author as { viewer?: { following?: string } }).viewer?.following}
            followOnAvatar
            bellKind="user"
            bellTarget={post.author.did}
            compact
          />
          </span>
          <span class="post-time">{timeAgo}</span>
        </div>
      )}

      {/* ── Action Row (reusable ActionBar + collection) ───────────────── */}
      <div class="post-actions" onClick$={(e) => e.stopPropagation()}>
        <ActionBar
          subjectUri={post.uri}
          subjectCid={post.cid}
          likeCount={post.likeCount ?? 0}
          liked={!!post.viewer?.like}
          likeRecordUri={post.viewer?.like}
          downvoteCount={downvoteCount}
          downvoted={isDownvoted.value || !!myDownvoteUri}
          downvoteRecordUri={myDownvoteUri}
          onDownvote$={onDownvote$}
          onUndoDownvote$={onUndoDownvote$}
          replyCount={post.replyCount ?? 0}
          replyHref={postPathForLink}
          hideVoteCounts
          likeIcon="heart"
        />

        {/* Save to collection */}
        {artboards.length > 0 && onAddToArtboard$ && (
          <div style={{ position: 'relative' }}>
            <button
              class={`post-action ${isInAnyArtboard ? 'post-action-active' : ''}`}
              aria-label="Save to collection"
              aria-expanded={showCollectionDropdown.value}
              onClick$={() => { showCollectionDropdown.value = !showCollectionDropdown.value; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={isInAnyArtboard ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
              </svg>
            </button>
            {showCollectionDropdown.value && (
              <div
                class="glass-strong"
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: '4px',
                  padding: 'var(--space-xs)',
                  minWidth: '140px',
                  zIndex: 10,
                }}
              >
                {artboards.map((b) => (
                  <button
                    key={b.id}
                    class="post-action"
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '2px' }}
                    onClick$={() => {
                      onAddToArtboard$(b.id);
                      showCollectionDropdown.value = false;
                    }}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
