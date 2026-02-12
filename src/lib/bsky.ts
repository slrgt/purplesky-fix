/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AT Protocol (Bluesky) Client Library
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the main interface to Bluesky / AT Protocol. It handles:
 *  - Authentication (OAuth and app password)
 *  - Session management (multi-account)
 *  - Timeline and feed fetching
 *  - Posting, replying, liking, reposting
 *  - Downvotes (stored as custom records in user repo)
 *  - Mixed feeds (merging multiple feeds by percentage)
 *  - Profile operations
 *  - Search
 *
 * HOW TO EDIT:
 *  - To add a new AT Protocol interaction, add a new exported function
 *  - Always use getAgent() to get the current authenticated agent
 *  - For public (logged-out) reads, use publicAgent
 *  - Session data is stored in localStorage for persistence
 *
 * IMPORTANT: This file runs in the browser only (uses localStorage, fetch).
 * In Qwik, import these functions inside useVisibleTask$() or event handlers.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Agent, AtpAgent, RichText } from '@atproto/api';
import type { AtpSessionData, AtpSessionEvent } from '@atproto/api';
import type { TimelineItem, PostView, PostMediaInfo, FeedMixEntry } from './types';

// ── Constants ─────────────────────────────────────────────────────────────

const BSKY_SERVICE = 'https://bsky.social';
const PUBLIC_BSKY = 'https://public.api.bsky.app';
const SESSION_KEY = 'purplesky-bsky-session';
const ACCOUNTS_KEY = 'purplesky-accounts';
const OAUTH_ACCOUNTS_KEY = 'purplesky-oauth-accounts';
const ACCOUNT_PROFILES_KEY = 'purplesky-account-profiles';

/** Collection name for downvotes (stored in user's repo, syncs via AT Protocol). */
const DOWNVOTE_COLLECTION = 'app.artsky.feed.downvote';

// ── Types ─────────────────────────────────────────────────────────────────

type AccountsStore = {
  activeDid: string | null;
  sessions: Record<string, AtpSessionData>;
};
type OAuthAccountsStore = {
  activeDid: string | null;
  dids: string[];
};

export type AccountProfile = {
  did: string;
  handle: string;
  avatar?: string;
  displayName?: string;
};

// ── Internal State ────────────────────────────────────────────────────────

let oauthAgentInstance: Agent | null = null;
let oauthSessionRef: { signOut(): Promise<void> } | null = null;

// ── Session Persistence ───────────────────────────────────────────────────

function getAccounts(): AccountsStore {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return { activeDid: null, sessions: {} };
    const parsed = JSON.parse(raw) as AccountsStore;
    return { activeDid: parsed.activeDid ?? null, sessions: parsed.sessions ?? {} };
  } catch {
    return { activeDid: null, sessions: {} };
  }
}

function saveAccounts(accounts: AccountsStore): void {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch { /* ignore */ }
}

function getOAuthAccounts(): OAuthAccountsStore {
  try {
    const raw = localStorage.getItem(OAUTH_ACCOUNTS_KEY);
    if (!raw) return { activeDid: null, dids: [] };
    const parsed = JSON.parse(raw) as OAuthAccountsStore;
    return { activeDid: parsed.activeDid ?? null, dids: Array.isArray(parsed.dids) ? parsed.dids : [] };
  } catch {
    return { activeDid: null, dids: [] };
  }
}

function saveOAuthAccounts(store: OAuthAccountsStore): void {
  try { localStorage.setItem(OAUTH_ACCOUNTS_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

function persistSession(_evt: AtpSessionEvent, session: AtpSessionData | undefined): void {
  const accounts = getAccounts();
  if (session) {
    accounts.sessions[session.did] = session;
    accounts.activeDid = session.did;
    saveAccounts(accounts);
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
  } else {
    if (accounts.activeDid) {
      delete accounts.sessions[accounts.activeDid];
      const remaining = Object.keys(accounts.sessions);
      accounts.activeDid = remaining[0] ?? null;
      saveAccounts(accounts);
    }
    try {
      if (accounts.activeDid) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(accounts.sessions[accounts.activeDid]));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch { /* ignore */ }
  }
}

// ── Agents ────────────────────────────────────────────────────────────────

/** Credential-based agent (app passwords). */
const credentialAgent = new AtpAgent({ service: BSKY_SERVICE, persistSession });

/** Agent for unauthenticated reads (works without login). */
export const publicAgent = new AtpAgent({ service: PUBLIC_BSKY });

/** Get the current active agent (OAuth if set, else credential). */
export function getAgent(): AtpAgent | Agent {
  return oauthAgentInstance ?? credentialAgent;
}

/** Proxy agent that always delegates to getAgent(). Use this for API calls. */
export const agent = new Proxy(credentialAgent, {
  get(_, prop) {
    return (getAgent() as unknown as Record<string, unknown>)[prop as string];
  },
});

/** Set the OAuth agent (after OAuth callback). Pass null to clear. */
export function setOAuthAgent(
  agentInstance: Agent | null,
  session?: { signOut(): Promise<void> } | null,
): void {
  oauthAgentInstance = agentInstance;
  oauthSessionRef = session ?? null;
}

// ── OAuth Account Management ──────────────────────────────────────────────

export function addOAuthDid(did: string, setActive = true): void {
  const store = getOAuthAccounts();
  if (!store.dids.includes(did)) store.dids = [...store.dids, did];
  if (setActive) store.activeDid = did;
  saveOAuthAccounts(store);
}

export function removeOAuthDid(did: string): void {
  const store = getOAuthAccounts();
  store.dids = store.dids.filter((d) => d !== did);
  if (store.activeDid === did) store.activeDid = store.dids[0] ?? null;
  saveOAuthAccounts(store);
}

export function setActiveOAuthDid(did: string | null): void {
  const store = getOAuthAccounts();
  store.activeDid = did;
  saveOAuthAccounts(store);
}

export function getOAuthAccountsSnapshot(): OAuthAccountsStore {
  return getOAuthAccounts();
}

// ── Account Profile Cache ────────────────────────────────────────────────

export function getAccountProfiles(): Record<string, AccountProfile> {
  try {
    const raw = localStorage.getItem(ACCOUNT_PROFILES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAccountProfile(profile: AccountProfile): void {
  try {
    const profiles = getAccountProfiles();
    profiles[profile.did] = profile;
    localStorage.setItem(ACCOUNT_PROFILES_KEY, JSON.stringify(profiles));
  } catch { /* ignore */ }
}

export function removeAccountProfile(did: string): void {
  try {
    const profiles = getAccountProfiles();
    delete profiles[did];
    localStorage.setItem(ACCOUNT_PROFILES_KEY, JSON.stringify(profiles));
  } catch { /* ignore */ }
}

// ── Session Management ────────────────────────────────────────────────────

export function getStoredSession(): AtpSessionData | null {
  const accounts = getAccounts();
  if (accounts.activeDid) return accounts.sessions[accounts.activeDid] ?? null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as AtpSessionData;
  } catch { /* ignore */ }
  return null;
}

export function getSession(): AtpSessionData | null {
  const a = getAgent();
  const atp = a as AtpAgent;
  if (atp.session) return atp.session;
  if (a.did) return { did: a.did } as AtpSessionData;
  return null;
}

export function getSessionsList(): AtpSessionData[] {
  const oauth = getOAuthAccounts();
  if (oauth.dids.length > 0) return oauth.dids.map((did) => ({ did } as AtpSessionData));
  const accounts = getAccounts();
  if (Object.keys(accounts.sessions).length === 0) {
    const single = getStoredSession();
    return single ? [single] : [];
  }
  return Object.values(accounts.sessions);
}

export async function resumeSession(): Promise<boolean> {
  const session = getStoredSession();
  if (!session?.accessJwt) return false;
  try {
    await credentialAgent.resumeSession(session);
    return true;
  } catch {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    return false;
  }
}

export async function login(identifier: string, password: string) {
  setOAuthAgent(null, null);
  return credentialAgent.login({ identifier, password });
}

export async function logout(): Promise<void> {
  if (oauthAgentInstance && oauthSessionRef) {
    try { await oauthSessionRef.signOut(); } catch { /* ignore */ }
    setOAuthAgent(null, null);
  }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/**
 * Log out a specific account by DID. Removes it from the stored accounts
 * and profile cache. Returns the next available DID to switch to, or null.
 */
export async function logoutAccount(did: string): Promise<string | null> {
  // If this is the active OAuth agent, sign out the session
  if (oauthAgentInstance && oauthAgentInstance.did === did && oauthSessionRef) {
    try { await oauthSessionRef.signOut(); } catch { /* ignore */ }
    setOAuthAgent(null, null);
  }
  // Remove from OAuth accounts list
  removeOAuthDid(did);
  removeAccountProfile(did);
  // Also clean credential sessions
  const accounts = getAccounts();
  if (accounts.sessions[did]) {
    delete accounts.sessions[did];
    if (accounts.activeDid === did) {
      const remaining = Object.keys(accounts.sessions);
      accounts.activeDid = remaining[0] ?? null;
    }
    saveAccounts(accounts);
  }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }

  // If the next account is a credential (app-password) account, resume it so
  // the in-memory agent matches the active account; otherwise getSession() would
  // still return the old DID until the next page load.
  const nextCredentialDid = accounts.activeDid;
  if (nextCredentialDid) {
    const nextSession = accounts.sessions[nextCredentialDid];
    if (nextSession?.accessJwt) {
      try {
        await credentialAgent.resumeSession(nextSession);
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession)); } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
  }

  // Return next available DID (OAuth takes precedence for switcher)
  const oauthAccounts = getOAuthAccounts();
  return oauthAccounts.activeDid ?? accounts.activeDid ?? null;
}

// ── Timeline & Feeds ──────────────────────────────────────────────────────

/** Fetch the user's home timeline. */
export async function getTimeline(
  limit = 50,
  cursor?: string,
): Promise<{ feed: TimelineItem[]; cursor?: string }> {
  const res = await agent.getTimeline({ limit, cursor });
  return { feed: res.data.feed as TimelineItem[], cursor: res.data.cursor };
}

/** Fetch a custom feed by URI. */
export async function getFeed(
  feedUri: string,
  limit = 50,
  cursor?: string,
): Promise<{ feed: TimelineItem[]; cursor?: string }> {
  const res = await agent.app.bsky.feed.getFeed({ feed: feedUri, limit, cursor });
  return { feed: res.data.feed as TimelineItem[], cursor: res.data.cursor };
}

/** Fetch and merge multiple feeds by percentage. When usePublic is true (e.g. logged out), uses publicAgent and skips timeline (auth-only) entries. */
export async function getMixedFeed(
  entries: FeedMixEntry[],
  limit: number,
  cursors?: Record<string, string>,
  usePublic = false,
): Promise<{ feed: TimelineItem[]; cursors: Record<string, string> }> {
  const totalPercent = entries.reduce((s, e) => s + e.percent, 0);
  if (!entries.length || totalPercent <= 0) return { feed: [], cursors: {} };

  const api = usePublic ? publicAgent : agent;
  const fetchLimit = Math.max(limit, 50);
  const results = await Promise.all(
    entries.map(async (entry) => {
      const key = entry.source.kind === 'timeline' ? 'timeline' : (entry.source.uri ?? '');
      const cursor = cursors?.[key];
      try {
        if (entry.source.kind === 'timeline') {
          if (usePublic) return { key, feed: [] as TimelineItem[], nextCursor: undefined };
          const res = await agent.getTimeline({ limit: fetchLimit, cursor });
          return { key, feed: res.data.feed as TimelineItem[], nextCursor: res.data.cursor };
        }
        if (entry.source.uri) {
          const res = await api.app.bsky.feed.getFeed({ feed: entry.source.uri, limit: fetchLimit, cursor });
          return { key, feed: res.data.feed as TimelineItem[], nextCursor: res.data.cursor };
        }
      } catch { /* ignore failed feed */ }
      return { key, feed: [] as TimelineItem[], nextCursor: undefined };
    }),
  );

  // Take proportional items from each feed
  const combined: TimelineItem[] = [];
  const seen = new Set<string>();
  results.forEach((r, i) => {
    const pct = entries[i]?.percent ?? 0;
    const take = Math.round((limit * pct) / totalPercent);
    for (let j = 0; j < take && j < r.feed.length; j++) {
      const item = r.feed[j];
      if (item?.post?.uri && !seen.has(item.post.uri)) {
        seen.add(item.post.uri);
        combined.push(item);
      }
    }
  });

  // Sort by date, newest first
  combined.sort((a, b) => {
    const ta = new Date((a.post.record as { createdAt?: string })?.createdAt ?? 0).getTime();
    const tb = new Date((b.post.record as { createdAt?: string })?.createdAt ?? 0).getTime();
    return tb - ta;
  });

  const nextCursors: Record<string, string> = {};
  results.forEach((r) => { if (r.nextCursor) nextCursors[r.key] = r.nextCursor; });
  return { feed: combined.slice(0, limit), cursors: nextCursors };
}

// ── Post Media Helpers ────────────────────────────────────────────────────

/** Get media info (image/video) from a post's embed. */
export function getPostMediaInfo(post: PostView): PostMediaInfo | null {
  const embed = post.embed as Record<string, unknown> | undefined;
  if (!embed) return null;

  const e = embed as {
    $type?: string;
    images?: Array<{ thumb: string; fullsize: string; aspectRatio?: { width: number; height: number } }>;
    thumbnail?: string;
    playlist?: string;
    media?: Record<string, unknown>;
  };

  if (e.$type === 'app.bsky.embed.images#view' && e.images?.length) {
    const img = e.images[0];
    const ar = img.aspectRatio?.width && img.aspectRatio?.height
      ? img.aspectRatio.width / img.aspectRatio.height : undefined;
    return { url: img.fullsize ?? img.thumb, type: 'image', imageCount: e.images.length, aspectRatio: ar };
  }
  if (e.$type === 'app.bsky.embed.video#view') {
    return { url: (e.thumbnail as string) ?? '', type: 'video', videoPlaylist: e.playlist };
  }
  // Handle recordWithMedia
  const media = e.media as typeof e | undefined;
  if (media?.$type === 'app.bsky.embed.images#view' && (media.images as unknown[])?.length) {
    const imgs = media.images as Array<{ fullsize?: string; thumb?: string; aspectRatio?: { width: number; height: number } }>;
    const img = imgs[0];
    const ar = img.aspectRatio?.width && img.aspectRatio?.height
      ? img.aspectRatio.width / img.aspectRatio.height : undefined;
    return { url: img.fullsize ?? img.thumb ?? '', type: 'image', imageCount: imgs.length, aspectRatio: ar };
  }
  if (media?.$type === 'app.bsky.embed.video#view') {
    return { url: (media.thumbnail as string) ?? '', type: 'video', videoPlaylist: media.playlist as string };
  }
  return null;
}

/** Check if a post has NSFW labels. */
export function isPostNsfw(post: PostView): boolean {
  const nsfwVals = new Set(['porn', 'sexual', 'nudity', 'graphic-media']);
  const selfLabels = (post.record as { labels?: { values?: Array<{ val: string }> } })?.labels?.values;
  if (selfLabels?.some((v) => nsfwVals.has(v.val))) return true;
  return !!post.labels?.some((l) => nsfwVals.has(l.val));
}

// ── Posting & Replying ────────────────────────────────────────────────────

/** Create a new post with optional images. */
export async function createPost(
  text: string,
  imageFiles?: File[],
  altTexts?: string[],
): Promise<{ uri: string; cid: string }> {
  const t = text.trim();
  const images = (imageFiles ?? []).slice(0, 4);
  if (!t && !images.length) throw new Error('Post text or image required');

  let embed: Record<string, unknown> | undefined;
  if (images.length > 0) {
    const uploaded = await Promise.all(
      images.map(async (file, i) => {
        const { data } = await agent.uploadBlob(file, { encoding: file.type });
        return { image: data.blob, alt: (altTexts?.[i] ?? '').slice(0, 1000) };
      }),
    );
    embed = { $type: 'app.bsky.embed.images', images: uploaded };
  }
  const rt = new RichText({ text: t || '' });
  await rt.detectFacets(agent);
  const res = await agent.post({
    text: rt.text, facets: rt.facets, embed: embed as typeof embed & { $type: string },
    createdAt: new Date().toISOString(),
  });
  return { uri: res.uri, cid: res.cid };
}

/** Reply to a post. Detects @mentions and #hashtags automatically. Supports optional image attachments. */
export async function postReply(
  rootUri: string, rootCid: string,
  parentUri: string, parentCid: string,
  text: string,
  imageFiles?: File[],
): Promise<{ uri: string; cid: string }> {
  const t = text.trim();
  const images = (imageFiles ?? []).slice(0, 4);
  if (!t && !images.length) throw new Error('Reply text or image required');

  let embed: Record<string, unknown> | undefined;
  if (images.length > 0) {
    const uploaded = await Promise.all(
      images.map(async (file) => {
        const { data } = await agent.uploadBlob(file, { encoding: file.type });
        return { image: data.blob, alt: '' };
      }),
    );
    embed = { $type: 'app.bsky.embed.images', images: uploaded };
  }

  const rt = new RichText({ text: t || '' });
  await rt.detectFacets(agent);
  const res = await agent.post({
    text: rt.text, facets: rt.facets, embed: embed as typeof embed & { $type: string },
    createdAt: new Date().toISOString(),
    reply: {
      root: { uri: rootUri, cid: rootCid },
      parent: { uri: parentUri, cid: parentCid },
    },
  });
  return { uri: res.uri, cid: res.cid };
}

/** Delete a post (only the author can delete). */
export async function deletePost(uri: string): Promise<void> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const parsed = parseAtUri(uri);
  if (!parsed) throw new Error('Invalid URI');
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did, collection: 'app.bsky.feed.post', rkey: parsed.rkey,
  });
}

// ── Voting (Microcosm Integration) ────────────────────────────────────────

/** Create a downvote record for a post. Returns the record URI. */
export async function createDownvote(subjectUri: string, subjectCid: string): Promise<string> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const res = await agent.com.atproto.repo.createRecord({
    repo: session.did, collection: DOWNVOTE_COLLECTION,
    record: {
      $type: DOWNVOTE_COLLECTION,
      subject: { uri: subjectUri, cid: subjectCid },
      createdAt: new Date().toISOString(),
    },
  });
  return res.data.uri;
}

/** Remove a downvote. */
export async function deleteDownvote(downvoteUri: string): Promise<void> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const parsed = parseAtUri(downvoteUri);
  if (!parsed) throw new Error('Invalid URI');
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did, collection: DOWNVOTE_COLLECTION, rkey: parsed.rkey,
  });
}

/** List current user's downvotes. Returns map: post URI -> downvote record URI. */
export async function listMyDownvotes(): Promise<Record<string, string>> {
  const session = getSession();
  if (!session?.did) return {};
  const out: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did, collection: DOWNVOTE_COLLECTION, limit: 100, cursor,
    });
    for (const r of res.data.records ?? []) {
      const value = r.value as { subject?: { uri?: string } };
      if (value?.subject?.uri) out[value.subject.uri] = r.uri;
    }
    cursor = res.data.cursor;
  } while (cursor);
  return out;
}

// ── Search ────────────────────────────────────────────────────────────────

/** Search posts by hashtag. */
export async function searchPostsByTag(tag: string, cursor?: string) {
  const normalized = tag.replace(/^#/, '').trim();
  if (!normalized) return { posts: [] as PostView[], cursor: undefined };
  const api = getSession() ? agent : publicAgent;
  const res = await api.app.bsky.feed.searchPosts({
    q: normalized, tag: [normalized], limit: 30, sort: 'latest', cursor,
  });
  return { posts: (res.data.posts ?? []) as PostView[], cursor: res.data.cursor };
}

/** Search posts by query text. */
export async function searchPostsByQuery(q: string, cursor?: string) {
  const term = q.trim();
  if (!term) return { posts: [] as PostView[], cursor: undefined };
  const api = getSession() ? agent : publicAgent;
  const res = await api.app.bsky.feed.searchPosts({
    q: term, limit: 30, sort: 'latest', cursor,
  });
  return { posts: (res.data.posts ?? []) as PostView[], cursor: res.data.cursor };
}

/** Typeahead search for user handles. */
export async function searchActorsTypeahead(q: string, limit = 10) {
  const term = q.trim();
  if (!term) return { actors: [] };
  const api = getSession() ? agent : publicAgent;
  const res = await api.app.bsky.actor.searchActorsTypeahead({ q: term, limit });
  return res.data;
}

// ── Profiles ──────────────────────────────────────────────────────────────

/** Suggested accounts to follow based on social graph. */
export type SuggestedFollow = {
  did: string; handle: string; displayName?: string; avatar?: string; count: number;
};

export async function getSuggestedFollows(
  currentUserDid: string,
  maxSuggestions = 15,
): Promise<SuggestedFollow[]> {
  const client = getAgent() as AtpAgent;
  // Get people you follow
  const followRes = await client.app.bsky.graph.getFollows({ actor: currentUserDid, limit: 80 });
  const myFollows = (followRes.data.follows ?? []).map((f: { did: string }) => f.did);
  const myFollowSet = new Set([...myFollows, currentUserDid]);

  // Sample up to 20 of your follows, check who they follow
  const sample = myFollows.length <= 20 ? myFollows : myFollows.sort(() => Math.random() - 0.5).slice(0, 20);
  const countByDid = new Map<string, number>();

  for (const did of sample) {
    try {
      const res = await client.app.bsky.graph.getFollows({ actor: did, limit: 50 });
      for (const f of res.data.follows ?? []) {
        if (!myFollowSet.has(f.did)) {
          countByDid.set(f.did, (countByDid.get(f.did) ?? 0) + 1);
        }
      }
    } catch { /* skip */ }
  }

  const sorted = [...countByDid.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSuggestions);

  // Resolve profiles
  const results: SuggestedFollow[] = [];
  for (const [did, count] of sorted) {
    try {
      const profile = await client.getProfile({ actor: did });
      const d = profile.data as { handle?: string; displayName?: string; avatar?: string };
      results.push({ did, handle: d.handle ?? did, displayName: d.displayName, avatar: d.avatar, count });
    } catch {
      results.push({ did, handle: did, count });
    }
  }
  return results;
}

// ── Follow / Unfollow ─────────────────────────────────────────────────

/** Follow a user. Returns the follow record URI. */
export async function followUser(did: string): Promise<string> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const res = await agent.com.atproto.repo.createRecord({
    repo: session.did,
    collection: 'app.bsky.graph.follow',
    record: {
      $type: 'app.bsky.graph.follow',
      subject: did,
      createdAt: new Date().toISOString(),
    },
  });
  return res.data.uri;
}

/** Unfollow a user by deleting the follow record. */
export async function unfollowUser(followUri: string): Promise<void> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const parsed = parseAtUri(followUri);
  if (!parsed) throw new Error('Invalid follow URI');
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection: 'app.bsky.graph.follow',
    rkey: parsed.rkey,
  });
}

// ── Notifications ─────────────────────────────────────────────────────────

export async function getNotifications(limit = 30, cursor?: string) {
  const res = await agent.listNotifications({ limit, cursor });
  return {
    notifications: (res.data.notifications || []).map((n) => ({
      uri: n.uri, author: n.author, reason: n.reason,
      reasonSubject: n.reasonSubject, isRead: n.isRead, indexedAt: n.indexedAt,
    })),
    cursor: res.data.cursor,
  };
}

export async function getUnreadNotificationCount(): Promise<number> {
  const res = await agent.countUnreadNotifications();
  return res.data.count ?? 0;
}

// ── Saved Feeds ───────────────────────────────────────────────────────────

export type SavedFeedItem = { id: string; type: string; value: string; pinned: boolean };

export async function getSavedFeeds(): Promise<SavedFeedItem[]> {
  const prefs = await agent.getPreferences();
  const list = (prefs as { savedFeeds?: SavedFeedItem[] }).savedFeeds ?? [];
  return list;
}

/** Add feeds to the user's saved list on their PDS. */
export async function addSavedFeeds(feeds: Array<{ type: 'feed' | 'timeline'; value: string; pinned?: boolean }>): Promise<void> {
  const a = getAgent() as { addSavedFeeds?: (arg: Array<{ type: string; value: string; pinned?: boolean }>) => Promise<unknown> };
  if (typeof a.addSavedFeeds !== 'function') throw new Error('addSavedFeeds not available');
  await a.addSavedFeeds(feeds.map((f) => ({ type: f.type, value: f.value, pinned: f.pinned ?? false })));
}

/** Remove feeds from the user's saved list by id. */
export async function removeSavedFeeds(ids: string[]): Promise<void> {
  const a = getAgent() as { removeSavedFeeds?: (ids: string[]) => Promise<unknown> };
  if (typeof a.removeSavedFeeds !== 'function') throw new Error('removeSavedFeeds not available');
  await a.removeSavedFeeds(ids);
}

/** Suggested feeds (discover) for the account. */
export async function getSuggestedFeeds(limit = 20, cursor?: string): Promise<{ feeds: Array<{ uri: string; displayName?: string; description?: string }>; cursor?: string }> {
  const res = await agent.app.bsky.feed.getSuggestedFeeds({ limit, cursor });
  const feeds = (res.data.feeds ?? []).map((f: { uri: string; displayName?: string; description?: string }) => ({
    uri: f.uri,
    displayName: f.displayName,
    description: f.description,
  }));
  return { feeds, cursor: res.data.cursor };
}

// ── Utility ───────────────────────────────────────────────────────────────

/** Parse an at:// URI into { did, collection, rkey }. */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  if (!uri.startsWith('at://')) return null;
  const parts = uri.slice(5).split('/');
  if (parts.length < 3) return null;
  return { did: parts[0], collection: parts[1], rkey: parts.slice(2).join('/') };
}
