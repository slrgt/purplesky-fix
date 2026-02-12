/**
 * Post detail: single post with thread. Uses agent.getPostThread().
 */
import { useState, useEffect } from 'preact/hooks';
import { agent, publicAgent, getSession } from '../lib/bsky';
import { getPostMediaInfo } from '../lib/bsky';
import { resizedAvatarUrl } from '../lib/image-utils';
import { withBase } from '../lib/path';
import type { PostView } from '../lib/types';

function formatTime(createdAt: string | undefined): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function PostContent({ post }: { post: PostView }) {
  const record = post.record as { text?: string; createdAt?: string };
  const media = getPostMediaInfo(post);
  const embed = post.embed as { playlist?: string; media?: { playlist?: string } } | undefined;
  const playlist = embed?.playlist ?? embed?.media?.playlist;

  return (
    <article class="glass" style={{ padding: 'var(--space-lg)', borderRadius: 'var(--glass-radius)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <a href={withBase(`/profile/${encodeURIComponent(post.author.handle)}/`)} style={{ flexShrink: 0 }}>
          {post.author.avatar ? (
            <img
              src={resizedAvatarUrl(post.author.avatar, 48)}
              alt=""
              width={48}
              height={48}
              style={{ borderRadius: '50%', display: 'block' }}
            />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--border)' }} />
          )}
        </a>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{post.author.displayName || post.author.handle}</div>
          <div style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)' }}>@{post.author.handle}</div>
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)', marginTop: 'var(--space-xs)' }}>
            {formatTime(record?.createdAt)}
          </div>
        </div>
      </div>
      {record?.text && (
        <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 'var(--space-md)' }}>
          {record.text}
        </p>
      )}
      {media && (
        <div style={{ marginBottom: 'var(--space-md)', borderRadius: 'var(--glass-radius-sm)', overflow: 'hidden' }}>
          {media.type === 'image' && (
            <img
              src={media.url}
              alt=""
              style={{ width: '100%', display: 'block', aspectRatio: media.aspectRatio ? `${media.aspectRatio}` : '1' }}
            />
          )}
          {media.type === 'video' && (
            <>
              {playlist ? (
                <video
                  src={playlist}
                  controls
                  muted
                  playsInline
                  style={{ width: '100%', maxHeight: '70vh' }}
                />
              ) : media.url ? (
                <img src={media.url} alt="" style={{ width: '100%', display: 'block' }} />
              ) : null}
            </>
          )}
        </div>
      )}
      <div style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)' }}>
        {(post.likeCount ?? 0)} likes · {(post.replyCount ?? 0)} replies
      </div>
    </article>
  );
}

export function PostDetailView({ uri }: { uri: string }) {
  const [post, setPost] = useState<PostView | null>(null);
  const [replies, setReplies] = useState<Array<{ post: PostView }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = getSession();
        const client = session ? agent : publicAgent;
        const res = await client.getPostThread({ uri, depth: 10 });
        const thread = res.data.thread as { post?: PostView; replies?: Array<{ post?: PostView }> };
        if (!cancelled) {
          setPost(thread?.post ?? null);
          const list: Array<{ post: PostView }> = [];
          (thread?.replies ?? []).forEach((r) => {
            if (r?.post) list.push({ post: r.post });
          });
          setReplies(list);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load post');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [uri]);

  if (loading) {
    return (
      <div class="flex-center" style={{ minHeight: '40vh', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div class="spinner" />
        <span style={{ color: 'var(--muted)' }}>Loading post…</span>
      </div>
    );
  }
  if (error || !post) {
    return (
      <div class="flex-center" style={{ minHeight: '40vh', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={{ color: 'var(--danger)' }}>{error || 'Post not found'}</p>
        <a href={withBase('/')} class="btn">Back to feed</a>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <PostContent post={post} />
      {replies.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--font-lg)', marginBottom: 'var(--space-md)' }}>Replies</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {replies.map((r) => (
              <PostContent key={r.post.uri} post={r.post} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
