/**
 * Renders plain text with clickable @mentions, #hashtags, $cashtags, %forumtags, and URLs.
 * Usernames link to /profile/[handle]/, tags and search-style links to /search/?q=..., URLs open in a new tab.
 */

import { component$ } from '@builder.io/qwik';
import { Link } from '@builder.io/qwik-city';
import { withBase } from '~/lib/path';

import './rich-text.css';

type Segment =
  | { type: 'text'; content: string }
  | { type: 'mention'; content: string; href: string }
  | { type: 'hashtag'; content: string; href: string }
  | { type: 'cashtag'; content: string; href: string }
  | { type: 'forumtag'; content: string; href: string }
  | { type: 'link'; content: string; href: string };

function parseRichText(text: string): Segment[] {
  if (!text) return [];
  const matches: { start: number; end: number; type: Segment['type']; content: string; href?: string }[] = [];

  const add = (re: RegExp, type: Segment['type'], href: (m: RegExpExecArray) => string) => {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        type,
        content: m[0],
        href: href(m),
      });
    }
  };

  add(/@([a-zA-Z0-9][\w.-]*)/g, 'mention', (m) => `/profile/${encodeURIComponent(m[1])}/`);
  add(/#([\w]+)/g, 'hashtag', (m) => `/search/?q=${encodeURIComponent(m[0])}`);
  add(/\$([\w]+)/g, 'cashtag', (m) => `/search/?q=${encodeURIComponent(m[0])}`);
  add(/%([\w]+)/g, 'forumtag', (m) => `/search/?q=${encodeURIComponent(m[0])}`);
  add(/https?:\/\/[^\s<>"']+/g, 'link', (m) => m[0]);
  add(/www\.[^\s<>"']+/g, 'link', (m) => 'https://' + m[0]);

  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const nonOverlapping: typeof matches = [];
  for (const match of matches) {
    if (nonOverlapping.some((n) => match.start < n.end && match.end > n.start)) continue;
    nonOverlapping.push(match);
  }

  const segments: Segment[] = [];
  let lastEnd = 0;
  for (const match of nonOverlapping) {
    if (match.start > lastEnd) {
      segments.push({ type: 'text', content: text.slice(lastEnd, match.start) });
    }
    segments.push({
      type: match.type,
      content: match.content,
      href: match.href!,
    } as Segment);
    lastEnd = match.end;
  }
  if (lastEnd < text.length) {
    segments.push({ type: 'text', content: text.slice(lastEnd) });
  }
  return segments;
}

export interface RichTextProps {
  text: string;
  /** Optional class for the wrapper (e.g. for line-height / font-size). */
  class?: string;
  style?: Record<string, string>;
}

export const RichText = component$<RichTextProps>(({ text, class: className, style }) => {
  const segments = parseRichText(text);
  return (
    <span class={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style }}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>;
        }
        const href = seg.href!;
        const isExternal = href.startsWith('http');
        const linkClass = 'rich-text-link';
        if (isExternal) {
          return (
            <a key={i} href={href} target="_blank" rel="noopener noreferrer" class={linkClass}>
              {seg.content}
            </a>
          );
        }
        return (
          <Link key={i} href={withBase(href)} class={linkClass}>
            {seg.content}
          </Link>
        );
      })}
    </span>
  );
});
