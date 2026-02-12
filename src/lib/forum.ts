/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Forum System – AT Protocol Lexicon for Forums
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module handles forum-specific operations:
 *  - Creating and listing forum posts (app.purplesky.forum.post)
 *  - Threaded replies (app.purplesky.forum.reply)
 *  - Pinning posts
 *  - Wiki-style pages promoted from threads
 *  - Draft posts saved locally
 *  - Integration with standard.site documents for long-form content
 *
 * HOW TO EDIT:
 *  - The forum uses custom AT Protocol lexicons defined in /lexicons/
 *  - Posts are stored in the user's PDS repo
 *  - To add new forum features, create a new lexicon and add functions here
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { agent, getSession, parseAtUri, publicAgent } from './bsky';
import type { ForumPost, ForumReply } from './types';

// ── Collection Names (AT Protocol Lexicons) ───────────────────────────────

const FORUM_POST_COLLECTION = 'app.purplesky.forum.post';
const FORUM_REPLY_COLLECTION = 'app.purplesky.forum.reply';
const FORUM_WIKI_COLLECTION = 'app.purplesky.forum.wiki';
const DRAFTS_KEY = 'purplesky-forum-drafts';

// ── Forum Posts ───────────────────────────────────────────────────────────

/** Create a new forum post. Returns the created record URI and CID. */
export async function createForumPost(opts: {
  title: string;
  body: string;
  tags?: string[];
}): Promise<{ uri: string; cid: string }> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_POST_COLLECTION,
    rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: opts.title.trim(),
      body: opts.body.trim(),
      tags: opts.tags ?? [],
      createdAt: new Date().toISOString(),
    },
    validate: false,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/** Suggest forum tags (from app.purplesky.forum.post lexicon) for composer % trigger. */
export async function suggestForumTags(prefix: string, limit = 15): Promise<string[]> {
  const session = getSession();
  if (!session?.did) return [];
  const { posts } = await listForumPosts(session.did, { limit: 100 });
  const tagSet = new Set<string>();
  for (const post of posts) {
    for (const t of post.tags ?? []) {
      if (typeof t === 'string' && t.length > 0) {
        if (!prefix || t.toLowerCase().startsWith(prefix.toLowerCase())) tagSet.add(t);
      }
    }
  }
  return Array.from(tagSet).sort().slice(0, limit);
}

/** List forum posts from a user's repo. */
export async function listForumPosts(
  did: string,
  opts?: { limit?: number; cursor?: string },
): Promise<{ posts: ForumPost[]; cursor?: string }> {
  const client = getSession() ? agent : publicAgent;
  try {
    const res = await client.com.atproto.repo.listRecords({
      repo: did,
      collection: FORUM_POST_COLLECTION,
      limit: opts?.limit ?? 30,
      cursor: opts?.cursor,
      reverse: true,
    });
    const posts: ForumPost[] = (res.data.records ?? []).map(
      (r: { uri: string; cid: string; value: Record<string, unknown> }) => {
        const v = r.value as {
          title?: string; body?: string; tags?: string[];
          createdAt?: string; isPinned?: boolean; isWiki?: boolean;
        };
        const rkey = r.uri.split('/').pop() ?? '';
        return {
          uri: r.uri, cid: r.cid, did, rkey,
          title: v.title, body: v.body, tags: v.tags,
          createdAt: v.createdAt, isPinned: v.isPinned, isWiki: v.isWiki,
        };
      },
    );
    return { posts, cursor: res.data.cursor };
  } catch {
    return { posts: [], cursor: undefined };
  }
}

/** Get a single forum post by URI. */
export async function getForumPost(uri: string): Promise<ForumPost | null> {
  const parsed = parseAtUri(uri);
  if (!parsed) return null;
  const client = getSession() ? agent : publicAgent;
  try {
    const res = await client.com.atproto.repo.getRecord({
      repo: parsed.did, collection: FORUM_POST_COLLECTION, rkey: parsed.rkey,
    });
    const v = res.data.value as {
      title?: string; body?: string; tags?: string[];
      createdAt?: string; isPinned?: boolean; isWiki?: boolean;
    };
    // Resolve author profile
    let authorHandle: string | undefined;
    let authorAvatar: string | undefined;
    try {
      const profile = await client.getProfile({ actor: parsed.did });
      const d = profile.data as { handle?: string; avatar?: string };
      authorHandle = d.handle;
      authorAvatar = d.avatar;
    } catch { /* ignore */ }
    return {
      uri: res.data.uri as string, cid: res.data.cid as string,
      did: parsed.did, rkey: parsed.rkey,
      title: v.title, body: v.body, tags: v.tags,
      createdAt: v.createdAt, isPinned: v.isPinned, isWiki: v.isWiki,
      authorHandle, authorAvatar,
    };
  } catch {
    return null;
  }
}

/** Edit a forum post. Only the author can edit. */
export async function editForumPost(uri: string, opts: {
  title?: string;
  body?: string;
  tags?: string[];
}): Promise<void> {
  const post = await getForumPost(uri);
  if (!post) throw new Error('Post not found');
  const session = getSession();
  if (!session?.did || session.did !== post.did) throw new Error('Not authorized');
  await agent.com.atproto.repo.putRecord({
    repo: session.did, collection: FORUM_POST_COLLECTION, rkey: post.rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: (opts.title ?? post.title ?? '').trim(),
      body: (opts.body ?? post.body ?? '').trim(),
      tags: opts.tags ?? post.tags ?? [],
      createdAt: post.createdAt,
      isPinned: post.isPinned,
      isWiki: post.isWiki,
      editedAt: new Date().toISOString(),
    },
    validate: false,
  });
}

/** Delete a forum post. Only the author can delete. */
export async function deleteForumPost(uri: string): Promise<void> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const parsed = parseAtUri(uri);
  if (!parsed) throw new Error('Invalid URI');
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did, collection: FORUM_POST_COLLECTION, rkey: parsed.rkey,
  });
}

/** Toggle pin status for a forum post (update record). */
export async function togglePinForumPost(uri: string, isPinned: boolean): Promise<void> {
  const post = await getForumPost(uri);
  if (!post) throw new Error('Post not found');
  const session = getSession();
  if (!session?.did || session.did !== post.did) throw new Error('Not authorized');
  await agent.com.atproto.repo.putRecord({
    repo: session.did, collection: FORUM_POST_COLLECTION, rkey: post.rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: post.title, body: post.body, tags: post.tags,
      createdAt: post.createdAt, isPinned, isWiki: post.isWiki,
    },
    validate: false,
  });
}

// ── Forum Replies (Threaded) ──────────────────────────────────────────────

/** Create a reply to a forum post (or to another reply for threading). */
export async function createForumReply(opts: {
  postUri: string;
  text: string;
  replyToUri?: string;
}): Promise<{ uri: string; cid: string }> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_REPLY_COLLECTION,
    rkey,
    record: {
      $type: FORUM_REPLY_COLLECTION,
      subject: opts.postUri,
      replyTo: opts.replyToUri,
      text: opts.text.trim(),
      createdAt: new Date().toISOString(),
    },
    validate: false,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/** List replies for a forum post. Aggregates from multiple repos. */
export async function listForumReplies(
  postUri: string,
  knownDids: string[] = [],
): Promise<ForumReply[]> {
  const client = getSession() ? agent : publicAgent;
  const session = getSession();
  const didsToCheck = [...new Set([
    ...(session?.did ? [session.did] : []),
    ...knownDids,
  ])];

  const allReplies: ForumReply[] = [];
  const seenUris = new Set<string>();

  for (const did of didsToCheck) {
    try {
      const res = await client.com.atproto.repo.listRecords({
        repo: did, collection: FORUM_REPLY_COLLECTION, limit: 100,
      });
      for (const r of res.data.records ?? []) {
        const v = r.value as { subject?: string; replyTo?: string; text?: string; createdAt?: string };
        if (v.subject !== postUri || seenUris.has(r.uri)) continue;
        seenUris.add(r.uri);
        // Resolve author
        let author = { did, handle: did } as ForumReply['author'];
        try {
          const profile = await client.getProfile({ actor: did });
          const d = profile.data as { handle?: string; avatar?: string; displayName?: string };
          author = { did, handle: d.handle ?? did, avatar: d.avatar, displayName: d.displayName };
        } catch { /* ignore */ }
        allReplies.push({
          uri: r.uri, cid: r.cid, replyTo: v.replyTo,
          author, record: { text: v.text, createdAt: v.createdAt },
          isComment: true,
        });
      }
    } catch { /* ignore */ }
  }

  // Sort chronologically
  allReplies.sort((a, b) => {
    const ta = new Date(a.record?.createdAt ?? 0).getTime();
    const tb = new Date(b.record?.createdAt ?? 0).getTime();
    return ta - tb;
  });
  return allReplies;
}

// ── Wiki Pages ────────────────────────────────────────────────────────────

/** Promote a forum post to a wiki page. */
export async function promoteToWiki(postUri: string): Promise<void> {
  const post = await getForumPost(postUri);
  if (!post) throw new Error('Post not found');
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');

  // Create wiki record
  const rkey = `wiki-${Date.now().toString(36)}`;
  await agent.com.atproto.repo.putRecord({
    repo: session.did, collection: FORUM_WIKI_COLLECTION, rkey,
    record: {
      $type: FORUM_WIKI_COLLECTION,
      sourcePost: postUri,
      title: post.title, body: post.body, tags: post.tags,
      createdAt: new Date().toISOString(),
      lastEditedAt: new Date().toISOString(),
    },
    validate: false,
  });

  // Mark original as wiki
  await agent.com.atproto.repo.putRecord({
    repo: session.did, collection: FORUM_POST_COLLECTION, rkey: post.rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: post.title, body: post.body, tags: post.tags,
      createdAt: post.createdAt, isPinned: post.isPinned, isWiki: true,
    },
    validate: false,
  });
}

// ── Draft Posts (Local Storage) ───────────────────────────────────────────

export interface ForumDraft {
  id: string;
  title: string;
  body: string;
  tags: string[];
  savedAt: string;
}

/** Save a draft forum post locally. */
export function saveDraft(draft: Omit<ForumDraft, 'id' | 'savedAt'>): ForumDraft {
  const drafts = getDrafts();
  const newDraft: ForumDraft = {
    id: `draft-${Date.now()}`,
    ...draft,
    savedAt: new Date().toISOString(),
  };
  drafts.push(newDraft);
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch { /* ignore */ }
  return newDraft;
}

/** Get all saved drafts. */
export function getDrafts(): ForumDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Delete a draft by ID. */
export function deleteDraft(id: string): void {
  const drafts = getDrafts().filter((d) => d.id !== id);
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch { /* ignore */ }
}
