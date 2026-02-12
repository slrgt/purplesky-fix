/**
 * Single post card: links to post detail. No prefetch, plain <a>.
 */
import type { TimelineItem } from '../lib/types';
import { getPostMediaInfo } from '../lib/bsky';
import { resizedAvatarUrl } from '../lib/image-utils';
import { withBase } from '../lib/path';

export function PostCard({ item }: { item: TimelineItem }) {
  const post = item.post;
  const record = post.record as { text?: string; createdAt?: string };
  const media = getPostMediaInfo(post);
  const postUrl = withBase(`/post/${encodeURIComponent(post.uri)}/`);
  const profileUrl = withBase(`/profile/${encodeURIComponent(post.author.handle)}/`);
  const textSnippet = record?.text
    ? (record.text.length > 200 ? record.text.slice(0, 200) + '…' : record.text)
    : '';

  return (
    <article class="post-card glass" style={{ borderRadius: 'var(--glass-radius)', overflow: 'hidden' }}>
      <a href={postUrl} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <div style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <a href={profileUrl} onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
              {post.author.avatar ? (
                <img
                  src={resizedAvatarUrl(post.author.avatar, 32)}
                  alt=""
                  width={32}
                  height={32}
                  style={{ borderRadius: '50%', display: 'block' }}
                />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--border)' }} />
              )}
            </a>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {post.author.displayName || post.author.handle}
              </span>
              <span style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>@{post.author.handle}</span>
            </div>
          </div>
          {media && (
            <div style={{ marginBottom: 'var(--space-sm)', borderRadius: 'var(--glass-radius-sm)', overflow: 'hidden' }}>
              {media.type === 'image' && (
                <img
                  src={media.url}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', display: 'block', aspectRatio: media.aspectRatio ? `${media.aspectRatio}` : '1' }}
                />
              )}
              {media.type === 'video' && media.url && (
                <img src={media.url} alt="" loading="lazy" style={{ width: '100%', display: 'block' }} />
              )}
            </div>
          )}
          {textSnippet && (
            <p style={{ fontSize: 'var(--font-sm)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {textSnippet}
            </p>
          )}
          <div style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>
            {post.likeCount ?? 0} likes · {(post.replyCount ?? 0)} replies
          </div>
        </div>
      </a>
    </article>
  );
}
