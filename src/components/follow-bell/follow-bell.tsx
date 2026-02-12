/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FollowBell – Inline Follow Button + Notification Bell
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Compact inline controls shown next to usernames:
 *  - Follow/Following button (toggles follow state)
 *  - Notification bell (subscribe to updates)
 *
 * Modes:
 *  - "user" – follow a user + subscribe to their new posts
 *  - "post" – subscribe to new comments on a post
 *  - "comment" – subscribe to new replies to a comment
 *
 * Subscriptions are stored in localStorage for now.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, $, useVisibleTask$ } from '@builder.io/qwik';
import { useAppState } from '~/context/app-context';

import './follow-bell.css';

// ── Subscription storage ──────────────────────────────────────────────────

const SUBS_KEY = 'purplesky-subscriptions';

type SubKind = 'user' | 'post' | 'comment';

interface SubEntry {
  kind: SubKind;
  /** DID for users, AT URI for posts/comments */
  target: string;
  createdAt: string;
}

function getSubs(): SubEntry[] {
  try {
    const raw = localStorage.getItem(SUBS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSubs(subs: SubEntry[]): void {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(subs));
  } catch { /* ignore */ }
}

function isSubscribed(kind: SubKind, target: string): boolean {
  return getSubs().some((s) => s.kind === kind && s.target === target);
}

function toggleSub(kind: SubKind, target: string): boolean {
  const subs = getSubs();
  const idx = subs.findIndex((s) => s.kind === kind && s.target === target);
  if (idx >= 0) {
    subs.splice(idx, 1);
    saveSubs(subs);
    return false;
  }
  subs.push({ kind, target, createdAt: new Date().toISOString() });
  saveSubs(subs);
  return true;
}

// ── Component ─────────────────────────────────────────────────────────────

interface FollowBellProps {
  /** The DID of the user (for follow button + user subscription) */
  authorDid?: string;
  /** Current follow record URI if already following (undefined = not following) */
  followUri?: string;
  /** When true, don't show follow button (e.g. when avatar is the main profile link) */
  followOnAvatar?: boolean;
  /** 'profile' = text "Follow"/"Following" button only (for profile page) */
  variant?: 'inline' | 'profile';
  /** Whether to show the follow button (hide for own posts, or when not logged in) */
  showFollow?: boolean;
  /** Kind of bell subscription */
  bellKind?: SubKind;
  /** Target URI/DID for bell subscription */
  bellTarget?: string;
  /** Whether to show the notification bell */
  showBell?: boolean;
  /** Compact mode (smaller) for inline use in post cards */
  compact?: boolean;
}

export const FollowBell = component$<FollowBellProps>(({
  authorDid,
  followUri,
  followOnAvatar = false,
  variant = 'inline',
  showFollow = true,
  bellKind = 'user',
  bellTarget,
  showBell = true,
  compact = false,
}) => {
  const app = useAppState();
  const following = useSignal(followUri ?? '');
  const followLoading = useSignal(false);
  const subscribed = useSignal(false);

  // Sync follow state from prop
  useVisibleTask$(({ track }) => {
    track(() => followUri);
    following.value = followUri ?? '';
  });

  // Load subscription state
  useVisibleTask$(() => {
    if (bellTarget) {
      subscribed.value = isSubscribed(bellKind, bellTarget);
    }
  });

  const handleFollow = $(async () => {
    if (!authorDid || followLoading.value || !app.session.isLoggedIn) return;
    followLoading.value = true;
    try {
      if (following.value) {
        const { unfollowUser } = await import('~/lib/bsky');
        await unfollowUser(following.value);
        following.value = '';
      } else {
        const { followUser } = await import('~/lib/bsky');
        const uri = await followUser(authorDid);
        following.value = uri;
      }
    } catch (err) {
      console.error('Follow toggle failed:', err);
    }
    followLoading.value = false;
  });

  const handleBell = $(() => {
    if (!bellTarget) return;
    subscribed.value = toggleSub(bellKind, bellTarget);
  });

  const isMe = app.session.did === authorDid;
  const showFollowButton = showFollow && app.session.isLoggedIn && !isMe && !followOnAvatar;
  const isProfileVariant = variant === 'profile';

  return (
    <span class={`follow-bell ${compact ? 'follow-bell-compact' : ''} ${isProfileVariant ? 'follow-bell-profile' : ''}`}>
      {showFollowButton && (
        <button
          type="button"
          class={`fb-follow ${following.value ? 'fb-following' : ''} ${isProfileVariant ? 'fb-follow-text' : ''}`}
          onClick$={handleFollow}
          disabled={followLoading.value}
          aria-label={following.value ? 'Unfollow' : 'Follow'}
        >
          {followLoading.value ? '…' : isProfileVariant ? (following.value ? 'Following' : 'Follow') : (following.value ? '✓' : '+')}
        </button>
      )}
      {showBell && app.session.isLoggedIn && bellTarget && (
        <button
          type="button"
          class={`fb-bell ${subscribed.value ? 'fb-bell-on' : ''}`}
          onClick$={handleBell}
          aria-label={subscribed.value ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={subscribed.value ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            {!subscribed.value && <line x1="1" y1="1" x2="23" y2="23" />}
          </svg>
        </button>
      )}
    </span>
  );
});
