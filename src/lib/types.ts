/**
 * Shared TypeScript types for PurpleSky.
 *
 * HOW TO EDIT:
 *  - Add new types here when creating new features
 *  - Import from '~/lib/types' throughout the app
 */

// ── AT Protocol Types ─────────────────────────────────────────────────────

/** A post in the Bluesky timeline. */
export interface TimelineItem {
  post: PostView;
  reason?: { $type: string; by?: { did: string; handle?: string } };
  /** Which feed this item came from (for mixed feeds). */
  _feedSource?: FeedSource;
}

/** A post view from the AT Protocol API. */
export interface PostView {
  uri: string;
  cid: string;
  author: ProfileView;
  record: Record<string, unknown>;
  embed?: Record<string, unknown>;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  labels?: Array<{ val: string }>;
  viewer?: { like?: string; repost?: string };
  indexedAt?: string;
}

/** Basic profile info. */
export interface ProfileView {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  viewer?: { following?: string; followedBy?: string; muted?: boolean; blockedBy?: boolean };
}

// ── Feed Types ────────────────────────────────────────────────────────────

export type FeedKind = 'timeline' | 'custom';

/** A source of feed content (either your timeline or a custom feed). */
export interface FeedSource {
  kind: FeedKind;
  label: string;
  /** For custom feeds: at://did/app.bsky.feed.generator/... */
  uri?: string;
}

/** One feed in the remix mix with its percentage weight (0–100). */
export interface FeedMixEntry {
  source: FeedSource;
  percent: number;
}

// ── Media Types ───────────────────────────────────────────────────────────

export interface PostMediaInfo {
  url: string;
  type: 'image' | 'video';
  imageCount?: number;
  videoPlaylist?: string;
  aspectRatio?: number;
}

// ── Collections / Artboards ───────────────────────────────────────────────

export interface ArtboardPost {
  uri: string;
  cid: string;
  authorHandle?: string;
  text?: string;
  thumb?: string;
  thumbs?: string[];
}

export interface Artboard {
  id: string;
  name: string;
  posts: ArtboardPost[];
  createdAt: string;
}

// ── Forum Types ───────────────────────────────────────────────────────────

export interface ForumPost {
  uri: string;
  cid: string;
  did: string;
  rkey: string;
  title?: string;
  body?: string;
  createdAt?: string;
  authorHandle?: string;
  authorAvatar?: string;
  tags?: string[];
  isPinned?: boolean;
  isWiki?: boolean;
  replyCount?: number;
  likeCount?: number;
}

export interface ForumReply {
  uri: string;
  cid: string;
  replyTo?: string;
  author: ProfileView;
  record: { text?: string; createdAt?: string; facets?: unknown[] };
  likeCount?: number;
  viewer?: { like?: string };
  isComment?: boolean;
}

// ── Consensus / Polis Types ───────────────────────────────────────────────

export interface ConsensusStatement {
  id: string;
  text: string;
  authorDid: string;
  createdAt: string;
}

export interface ConsensusVote {
  userId: string;
  statementId: string;
  /** 1 = agree, -1 = disagree, 0 = pass */
  value: -1 | 0 | 1;
}

export interface ConsensusResult {
  statements: Array<{
    statementId: string;
    agreeCount: number;
    disagreeCount: number;
    passCount: number;
    totalVoters: number;
    agreementRatio: number;
    divisiveness: number;
  }>;
  totalParticipants: number;
  clusterCount: number;
  clusters: Array<{
    id: number;
    memberCount: number;
    memberIds: string[];
    avgAgreement: number;
  }>;
}

// ── Collaboration Types ───────────────────────────────────────────────────

export type ProjectType = 'blender' | 'godot' | 'general';

export interface CollabProject {
  uri: string;
  name: string;
  description: string;
  type: ProjectType;
  owner: string;
  tags: string[];
  version: string;
  externalUrl?: string;
  magnetLink?: string;
  previewUrl?: string;
  createdAt: string;
}

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  status: 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface KanbanBoard {
  id: string;
  projectUri: string;
  columns: Array<{
    id: string;
    title: string;
    cards: KanbanCard[];
  }>;
}

// ── Theme Types ───────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system' | 'high-contrast';

// ── View Mode ─────────────────────────────────────────────────────────────

export type ViewColumns = 1 | 2 | 3;

/** Card preview style: full (text + meta + media), mini (compact), art (media focus) */
export type CardViewMode = 'full' | 'mini' | 'art';

// ── App State ─────────────────────────────────────────────────────────────

export interface AppState {
  /** Current user session info */
  session: {
    did: string | null;
    handle: string | null;
    avatar: string | null;
    isLoggedIn: boolean;
  };
  /** Theme preference */
  theme: ThemeMode;
  /** Number of columns in masonry grid */
  viewColumns: ViewColumns;
  /** Feed mixing configuration */
  feedMix: FeedMixEntry[];
  /** Seen post URIs */
  seenPosts: Set<string>;
  /** Whether to hide seen posts */
  hideSeenPosts: boolean;
  /** Art-only filter */
  artOnly: boolean;
  /** Media-only filter */
  mediaOnly: boolean;
  /** NSFW filter mode: hide = SFW only, blur = show blurred, show = NSFW visible */
  nsfwMode: 'hide' | 'blur' | 'show';
  /** Card preview: full, mini, art */
  cardViewMode: CardViewMode;
}
