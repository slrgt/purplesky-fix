/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Post Detail Page – Full Post with Thread
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shows a single post in full with:
 *  - Full-size media (images, video with HLS)
 *  - Complete text
 *  - Like/downvote/repost counts
 *  - Full comment thread (nested replies, furl/unfurl)
 *  - Reply composer
 *  - Quote post support
 *  - Share options
 *
 * HOW TO EDIT:
 *  - To change what's shown in the post detail, edit the article section
 *  - To change comment sorting, add options to the sort dropdown
 *  - Comments use the app.bsky.feed.post reply system
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useVisibleTask$, $ } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { Link } from '~/components/app-link/app-link';
import { useAppState } from '~/context/app-context';
import { ActionBar } from '~/components/action-buttons/action-buttons';
import { FollowBell } from '~/components/follow-bell/follow-bell';
import { RichText } from '~/components/rich-text/rich-text';
import { withBase } from '~/lib/path';
import { resizedAvatarUrl } from '~/lib/image-utils';
import type { PostView } from '~/lib/types';

import '~/components/comment-thread/comment-thread.css';

export default component$(() => {
  const app = useAppState();
  const loc = useLocation();
  const uri = decodeURIComponent(loc.params.uri);

  const post = useSignal<PostView | null>(null);
  const thread = useSignal<unknown>(null);
  const loading = useSignal(true);
  const replyText = useSignal('');
  const replyImages = useSignal<File[]>([]);
  const replyImagePreviews = useSignal<string[]>([]);
  /** Map post/reply URI -> downvote record URI (for "I downvoted" state) */
  const myDownvoteUris = useSignal<Record<string, string>>({});
  /** Downvote counts per reply URI (for comment sort by score) */
  const replyDownvoteCounts = useSignal<Record<string, number>>({});
  /** Set of collapsed comment URIs */
  const collapsedComments = useSignal<Set<string>>(new Set());
  /** Comment sort mode */
  const commentSortMode = useSignal<'newest' | 'oldest' | 'best' | 'controversial' | 'replies'>('best');
  /** Ref for the video element (must be declared before any early returns) */
  const videoRef = useSignal<HTMLVideoElement>();

  useVisibleTask$(async () => {
    try {
      const { agent, publicAgent, getSession } = await import('~/lib/bsky');
      const session = getSession();
      const client = session ? agent : publicAgent;
      const res = await client.getPostThread({ uri, depth: 10 });
      thread.value = res.data.thread;
      post.value = (res.data.thread as { post?: PostView })?.post ?? null;
      if (session?.did) {
        const { listMyDownvotes } = await import('~/lib/bsky');
        myDownvoteUris.value = await listMyDownvotes();
      }
      // Collect all reply URIs (and main post) for downvote counts
      const replyUris: string[] = [];
      const mainPost = (res.data.thread as { post?: PostView })?.post;
      if (mainPost?.uri) replyUris.push(mainPost.uri);
      function collectUris(t: unknown) {
        if (!t || typeof t !== 'object') return;
        const node = t as { post?: PostView; replies?: unknown[] };
        if (node.post?.uri) replyUris.push(node.post.uri);
        (node.replies ?? []).forEach(collectUris);
      }
      const root = res.data.thread as { replies?: unknown[] };
      (root?.replies ?? []).forEach(collectUris);
      if (replyUris.length > 0) {
        const { getDownvoteCounts } = await import('~/lib/constellation');
        replyDownvoteCounts.value = await getDownvoteCounts(replyUris);
      }
    } catch (err) {
      console.error('Failed to load post:', err);
    }
    loading.value = false;
  });

  // HLS.js for video playback when we have a playlist URL
  useVisibleTask$(async ({ track, cleanup }) => {
    track(() => post.value);
    track(() => videoRef.value);
    const p = post.value;
    const emb = p?.embed as { playlist?: string; media?: { playlist?: string } } | undefined;
    const playlist = emb?.playlist ?? emb?.media?.playlist;
    const videoEl = videoRef.value;
    if (!playlist || !videoEl || typeof document === 'undefined') return;
    videoEl.muted = true;
    const play = () => { videoEl.play().catch(() => {}); };
    const Hls = (await import('hls.js')).default;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(playlist);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => play());
      const t = setTimeout(play, 500);
      cleanup(() => {
        clearTimeout(t);
        hls.destroy();
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = playlist;
      videoEl.load();
      videoEl.addEventListener('loadeddata', play, { once: true });
      videoEl.addEventListener('canplay', play, { once: true });
      const t = setTimeout(play, 500);
      cleanup(() => {
        clearTimeout(t);
        videoEl.removeEventListener('loadeddata', play);
        videoEl.removeEventListener('canplay', play);
      });
    }
  });

  const handleReply = $(async () => {
    if (!replyText.value.trim() && !replyImages.value.length) return;
    if (!post.value) return;
    try {
      const { postReply } = await import('~/lib/bsky');
      await postReply(
        post.value.uri, post.value.cid,
        post.value.uri, post.value.cid,
        replyText.value,
        replyImages.value.length > 0 ? replyImages.value : undefined,
      );
      replyText.value = '';
      replyImages.value = [];
      // Revoke preview URLs
      replyImagePreviews.value.forEach((u) => URL.revokeObjectURL(u));
      replyImagePreviews.value = [];
      // Reload thread
      const { agent } = await import('~/lib/bsky');
      const res = await agent.getPostThread({ uri, depth: 10 });
      thread.value = res.data.thread;
    } catch (err) {
      console.error('Reply failed:', err);
    }
  });

  const handleReplyImageSelect = $((e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).slice(0, 4 - replyImages.value.length);
    if (!files.length) return;
    replyImages.value = [...replyImages.value, ...files].slice(0, 4);
    replyImagePreviews.value = [
      ...replyImagePreviews.value,
      ...files.map((f) => URL.createObjectURL(f)),
    ].slice(0, 4);
    input.value = ''; // Reset so same file can be re-selected
  });

  const removeReplyImage = $((index: number) => {
    const imgs = [...replyImages.value];
    const previews = [...replyImagePreviews.value];
    URL.revokeObjectURL(previews[index]);
    imgs.splice(index, 1);
    previews.splice(index, 1);
    replyImages.value = imgs;
    replyImagePreviews.value = previews;
  });

  if (loading.value) {
    return <div class="flex-center" style={{ padding: 'var(--space-2xl)' }}><div class="spinner" /></div>;
  }

  if (!post.value) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--muted)', maxWidth: '400px', margin: '0 auto' }}>
        <p style={{ marginBottom: 'var(--space-md)' }}>Post not found.</p>
        <p style={{ fontSize: 'var(--font-sm)', marginBottom: 'var(--space-lg)' }}>
          It may have been deleted, or the account may no longer exist. If you followed a link, it may be outdated.
        </p>
        <Link href={withBase('/')} class="btn" style={{ display: 'inline-block' }}>Back to feed</Link>
      </div>
    );
  }

  const p = post.value;
  const record = p.record as { text?: string; createdAt?: string };
  const embed = p.embed as Record<string, unknown> | undefined;
  const mediaEmbed = embed?.media as Record<string, unknown> | undefined;
  const images = (embed?.images as Array<{ fullsize: string; alt?: string }>)
    ?? (mediaEmbed?.images as Array<{ fullsize: string; alt?: string }>)
    ?? [];
  const isVideo = (embed?.$type as string) === 'app.bsky.embed.video#view'
    || (mediaEmbed?.$type as string) === 'app.bsky.embed.video#view';
  const videoPlaylist = (embed?.playlist as string) ?? (mediaEmbed?.playlist as string) ?? undefined;

  /** Flatten thread with sort applied at each level (newest/oldest/best/controversial) */
  const flattenedReplies = (() => {
    const mode = commentSortMode.value;
    const downvoteCounts = replyDownvoteCounts.value;
    const getCreated = (n: { post?: PostView }) => ((n.post?.record as { createdAt?: string })?.createdAt ?? '');
    const getScore = (n: { post?: PostView }) => (n.post?.likeCount ?? 0) - (n.post ? (downvoteCounts[n.post.uri] ?? 0) : 0);
    const getControversy = (n: { post?: PostView }) => {
      if (!n.post) return 0;
      const likes = n.post.likeCount ?? 0;
      const downs = downvoteCounts[n.post.uri] ?? 0;
      const total = likes + downs;
      if (total === 0) return 0;
      const ratio = likes / total;
      return total * (1 - 2 * Math.abs(ratio - 0.5));
    };
    function sortNodes(nodes: Array<{ post?: PostView; replies?: unknown[] }>) {
      return [...nodes].sort((a, b) => {
        if (mode === 'newest') return getCreated(b).localeCompare(getCreated(a));
        if (mode === 'oldest') return getCreated(a).localeCompare(getCreated(b));
        if (mode === 'best') return getScore(b) - getScore(a);
        if (mode === 'controversial') return getControversy(b) - getControversy(a);
        if (mode === 'replies') return (b.replies?.length ?? 0) - (a.replies?.length ?? 0);
        return 0;
      });
    }
    function walk(nodes: unknown[], depth: number): Array<{ post: PostView; depth: number }> {
      if (!nodes?.length) return [];
      const typed = nodes.map((n) => n as { post?: PostView; replies?: unknown[] }).filter((n) => n.post?.uri);
      const sorted = sortNodes(typed);
      const out: Array<{ post: PostView; depth: number }> = [];
      for (const node of sorted) {
        out.push({ post: node.post!, depth });
        out.push(...walk(node.replies ?? [], depth + 1));
      }
      return out;
    }
    const root = thread.value as { replies?: unknown[] };
    return walk(root?.replies ?? [], 0);
  })();

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto' }}>
      <article class="glass-strong" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-lg)' }}>
        {/* Author */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
          <Link href={withBase(`/profile/${encodeURIComponent(p.author.handle)}/`)} style={{ display: 'block', flexShrink: 0 }}>
            {p.author.avatar ? (
              <img src={resizedAvatarUrl(p.author.avatar, 40)} alt="" width={40} height={40} style={{ borderRadius: '50%', display: 'block' }} loading="lazy" />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--border)' }} />
            )}
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: '600' }}>{p.author.displayName || p.author.handle}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <Link href={withBase(`/profile/${encodeURIComponent(p.author.handle)}/`)} style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)', textDecoration: 'none' }}>@{p.author.handle}</Link>
              <FollowBell
                authorDid={p.author.did}
                followUri={(p.author as { viewer?: { following?: string } }).viewer?.following}
                followOnAvatar
                bellKind="user"
                bellTarget={p.author.did}
                compact
              />
            </div>
          </div>
          <FollowBell
            showFollow={false}
            bellKind="post"
            bellTarget={p.uri}
          />
        </div>

        {/* Text */}
        {record?.text && (
          <p style={{ fontSize: 'var(--font-lg)', lineHeight: '1.6', marginBottom: 'var(--space-md)' }}>
            <RichText text={record.text} />
          </p>
        )}

        {/* Images – stacked vertically, scale to fit viewport */}
        {images.length > 0 && (
          <div
            class={images.length > 1 ? 'image-stack-viewport' : ''}
            style={{
              marginBottom: 'var(--space-md)',
              borderRadius: 'var(--glass-radius-sm)',
              overflow: 'hidden',
            }}
          >
            {images.map((img, i) => (
              <img
                key={i}
                src={img.fullsize}
                alt={img.alt ?? ''}
                style={{
                  width: '100%',
                  borderRadius: images.length > 1 ? 0 : 'var(--glass-radius-sm)',
                  ...(images.length === 1 ? { maxHeight: '80vh', objectFit: 'contain' } : {}),
                }}
              />
            ))}
          </div>
        )}

        {/* Video (HLS.js when playlist URL present) */}
        {isVideo && (
          <div style={{ marginBottom: 'var(--space-md)' }}>
            {videoPlaylist ? (
              <video
                ref={videoRef}
                controls
                autoPlay
                muted
                playsInline
                class="post-detail-video"
                style={{ width: '100%', maxHeight: '70vh', borderRadius: 'var(--glass-radius-sm)', background: '#000' }}
              />
            ) : (
              <div style={{ background: 'var(--surface)', borderRadius: 'var(--glass-radius-sm)', padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--muted)' }}>
                Video (no playlist URL)
              </div>
            )}
          </div>
        )}

        {/* Actions: Like, Downvote, Reply */}
        <div style={{ paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border)' }}>
          <ActionBar
            subjectUri={p.uri}
            subjectCid={p.cid}
            likeCount={p.likeCount ?? 0}
            liked={!!p.viewer?.like}
            likeRecordUri={p.viewer?.like}
            downvoteCount={replyDownvoteCounts.value[p.uri] ?? 0}
            downvoted={!!myDownvoteUris.value[p.uri]}
            downvoteRecordUri={myDownvoteUris.value[p.uri]}
            onDownvote$={app.session.isLoggedIn ? $(async () => {
              myDownvoteUris.value = await (await import('~/lib/bsky')).listMyDownvotes();
              replyDownvoteCounts.value = { ...replyDownvoteCounts.value, [p.uri]: (replyDownvoteCounts.value[p.uri] ?? 0) + 1 };
            }) : undefined}
            onUndoDownvote$={app.session.isLoggedIn ? $(async () => {
              myDownvoteUris.value = await (await import('~/lib/bsky')).listMyDownvotes();
              replyDownvoteCounts.value = { ...replyDownvoteCounts.value, [p.uri]: Math.max(0, (replyDownvoteCounts.value[p.uri] ?? 0) - 1) };
            }) : undefined}
            replyCount={p.replyCount ?? 0}
            replyHref={withBase(`/post/${encodeURIComponent(p.uri)}/`)}
          />
        </div>
        {record?.createdAt && (
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)', marginTop: 'var(--space-xs)' }}>
            {new Date(record.createdAt).toLocaleString()}
          </div>
        )}
      </article>

      {/* Reply Composer */}
      {app.session.isLoggedIn && (
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <textarea
              placeholder="Write a reply..."
              value={replyText.value}
              onInput$={(_, el) => { replyText.value = el.value; }}
              style={{ flex: 1, minHeight: '80px', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', alignSelf: 'flex-end' }}>
              <label
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--muted)', fontSize: '18px',
                  opacity: replyImages.value.length >= 4 ? '0.4' : '1',
                }}
                title="Attach image"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange$={handleReplyImageSelect}
                  disabled={replyImages.value.length >= 4}
                />
              </label>
              <button class="btn" onClick$={handleReply}>Reply</button>
            </div>
          </div>
          {/* Image previews */}
          {replyImagePreviews.value.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-xs)', flexWrap: 'wrap' }}>
              {replyImagePreviews.value.map((src, i) => (
                <div key={i} style={{ position: 'relative', width: '80px', height: '80px' }}>
                  <img
                    src={src}
                    alt=""
                    style={{
                      width: '80px', height: '80px', objectFit: 'cover',
                      borderRadius: 'var(--glass-radius-sm)', border: '1px solid var(--border)',
                    }}
                  />
                  <button
                    type="button"
                    onClick$={() => removeReplyImage(i)}
                    style={{
                      position: 'absolute', top: '-6px', right: '-6px',
                      width: '20px', height: '20px', borderRadius: '50%',
                      background: 'var(--danger, #e53e3e)', color: '#fff',
                      border: 'none', cursor: 'pointer', fontSize: '12px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      lineHeight: 1, padding: 0,
                    }}
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Comment sort + thread replies */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {flattenedReplies.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
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
        {(() => {
          // Build descendant counts & filter out children of collapsed comments
          const collapsed = collapsedComments.value;
          let skipUntilDepth = -1;
          return flattenedReplies.map(({ post: rp, depth }, idx) => {
            // Skip descendants of collapsed comments
            if (skipUntilDepth >= 0) {
              if (depth > skipUntilDepth) return null;
              skipUntilDepth = -1;
            }
            const isCollapsed = collapsed.has(rp.uri);
            // Count descendants (subsequent entries with deeper depth)
            let descCount = 0;
            for (let j = idx + 1; j < flattenedReplies.length; j++) {
              if (flattenedReplies[j].depth <= depth) break;
              descCount++;
            }
            if (isCollapsed) skipUntilDepth = depth;
            const rr = rp.record as { text?: string; createdAt?: string };
            return (
              <div key={rp.uri} style={{ marginBottom: 'var(--space-xs)' }}>
                <div style={{ display: 'flex', gap: 0 }}>
                  {/* ── Thread lines for each ancestor depth level ── */}
                  {Array.from({ length: depth }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      class="ct-depth-line"
                      aria-label="Collapse parent thread"
                      onClick$={() => {
                        // Find the ancestor at this depth and collapse it
                        for (let j = idx - 1; j >= 0; j--) {
                          if (flattenedReplies[j].depth === i) {
                            const next = new Set(collapsed);
                            next.add(flattenedReplies[j].post.uri);
                            collapsedComments.value = next;
                            break;
                          }
                        }
                      }}
                    />
                  ))}
                  {/* ── Collapse button + full-height bar (always rendered so line has no gap) ── */}
                  <div class="ct-gutter" style={{ '--ct-gutter-top': '19px' } as Record<string, string>}>
                    <button
                      type="button"
                      class="ct-collapse-btn"
                      onClick$={() => {
                        const next = new Set(collapsed);
                        if (next.has(rp.uri)) next.delete(rp.uri); else next.add(rp.uri);
                        collapsedComments.value = next;
                      }}
                      aria-label={isCollapsed ? `Expand ${descCount} replies` : 'Collapse thread'}
                    >
                      {isCollapsed ? '+' : '\u2013'}
                    </button>
                    <button
                      type="button"
                      class="ct-collapse-bar"
                      onClick$={() => {
                        const next = new Set(collapsed);
                        next.add(rp.uri);
                        collapsedComments.value = next;
                      }}
                      aria-label="Collapse thread"
                    />
                  </div>

                  {/* ── Right content ── */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ padding: 'var(--space-xs) 0 var(--space-xs) var(--space-sm)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                        <Link href={withBase(`/profile/${encodeURIComponent(rp.author.handle)}/`)} style={{ display: 'block', flexShrink: 0 }}>
                          {rp.author.avatar ? (
                            <img src={resizedAvatarUrl(rp.author.avatar, 24)} alt="" width={24} height={24} style={{ borderRadius: '50%', display: 'block' }} loading="lazy" />
                          ) : (
                            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--border)' }} />
                          )}
                        </Link>
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
                          {rp.author.displayName && (
                            <span style={{ fontSize: 'var(--font-sm)', fontWeight: '600' }}>{rp.author.displayName}</span>
                          )}
                          <Link href={withBase(`/profile/${encodeURIComponent(rp.author.handle)}/`)} style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)', textDecoration: 'none' }}>@{rp.author.handle}</Link>
                        </div>
                        <FollowBell
                          authorDid={rp.author.did}
                          followUri={(rp.author as { viewer?: { following?: string } }).viewer?.following}
                          followOnAvatar
                          bellKind="comment"
                          bellTarget={rp.uri}
                          compact
                        />
                        {isCollapsed && descCount > 0 && (
                          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--accent)', marginLeft: 'auto' }}>
                            +{descCount} {descCount === 1 ? 'reply' : 'replies'}
                          </span>
                        )}
                      </div>
                      {!isCollapsed && (
                        <>
                          {rr?.text && (
                            <p style={{ fontSize: 'var(--font-sm)', lineHeight: '1.5' }}>
                              <RichText text={rr.text} />
                            </p>
                          )}
                          {/* Comment images */}
                          {(() => {
                            const rpEmbed = rp.embed as Record<string, unknown> | undefined;
                            const rpMedia = rpEmbed?.media as Record<string, unknown> | undefined;
                            const rpImages = (rpEmbed?.images as Array<{ thumb: string; fullsize: string; alt?: string }>)
                              ?? (rpMedia?.images as Array<{ thumb: string; fullsize: string; alt?: string }>)
                              ?? [];
                            if (rpImages.length === 0) return null;
                            return (
                              <div style={{ marginTop: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                                {rpImages.map((img, ii) => (
                                  <img
                                    key={ii}
                                    src={img.fullsize ?? img.thumb}
                                    alt={img.alt ?? ''}
                                    loading="lazy"
                                    style={{
                                      width: '100%',
                                      maxHeight: '400px',
                                      objectFit: 'contain',
                                      borderRadius: 'var(--glass-radius-sm)',
                                      background: 'var(--surface)',
                                    }}
                                  />
                                ))}
                              </div>
                            );
                          })()}
                          <ActionBar
                            subjectUri={rp.uri}
                            subjectCid={rp.cid}
                            likeCount={rp.likeCount ?? 0}
                            liked={!!rp.viewer?.like}
                            likeRecordUri={rp.viewer?.like}
                            downvoteCount={replyDownvoteCounts.value[rp.uri] ?? 0}
                            downvoted={!!myDownvoteUris.value[rp.uri]}
                            downvoteRecordUri={myDownvoteUris.value[rp.uri]}
                            onDownvote$={app.session.isLoggedIn ? $(async () => {
                              myDownvoteUris.value = await (await import('~/lib/bsky')).listMyDownvotes();
                              replyDownvoteCounts.value = { ...replyDownvoteCounts.value, [rp.uri]: (replyDownvoteCounts.value[rp.uri] ?? 0) + 1 };
                            }) : undefined}
                            onUndoDownvote$={app.session.isLoggedIn ? $(async () => {
                              myDownvoteUris.value = await (await import('~/lib/bsky')).listMyDownvotes();
                              replyDownvoteCounts.value = { ...replyDownvoteCounts.value, [rp.uri]: Math.max(0, (replyDownvoteCounts.value[rp.uri] ?? 0) - 1) };
                            }) : undefined}
                            replyCount={rp.replyCount ?? 0}
                            replyHref={withBase(`/post/${encodeURIComponent(uri)}/`)}
                            compact
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
});
