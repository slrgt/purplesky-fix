/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Artboards (Collections)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Artboards let users save posts to named collections.
 * Data is stored in localStorage for instant access and synced to the user's
 * PDS (Personal Data Server) so collections persist across devices.
 *
 * HOW TO EDIT:
 *  - To change the localStorage key, edit ARTBOARDS_KEY
 *  - To change the PDS collection name, edit COLLECTION
 *  - Each artboard is an array of saved posts with cached metadata
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Artboard, ArtboardPost } from './types';
import { agent, getSession, parseAtUri } from './bsky';

const ARTBOARDS_KEY = 'purplesky-artboards';
const COLLECTION = 'app.artsky.artboard';

// ── Local Storage ─────────────────────────────────────────────────────────

function load(): Artboard[] {
  try {
    const raw = localStorage.getItem(ARTBOARDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function save(boards: Artboard[]): void {
  try { localStorage.setItem(ARTBOARDS_KEY, JSON.stringify(boards)); } catch { /* ignore */ }
}

/** Get all artboards. */
export function getArtboards(): Artboard[] { return load(); }

/** Get a single artboard by ID. */
export function getArtboard(id: string): Artboard | undefined {
  return load().find((b) => b.id === id);
}

/** Create a new artboard. Returns the created artboard. */
export function createArtboard(name: string): Artboard {
  const boards = load();
  const board: Artboard = {
    id: `board-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: name.trim() || 'Untitled',
    posts: [],
    createdAt: new Date().toISOString(),
  };
  boards.push(board);
  save(boards);
  return board;
}

/** Rename an artboard. */
export function updateArtboardName(id: string, name: string): void {
  const boards = load();
  const b = boards.find((b) => b.id === id);
  if (b) { b.name = name.trim() || 'Untitled'; save(boards); }
}

/** Delete an artboard. */
export function deleteArtboard(id: string): void {
  save(load().filter((b) => b.id !== id));
}

/** Add a post to an artboard. Returns true if successful. */
export function addPostToArtboard(
  boardId: string,
  post: { uri: string; cid: string; authorHandle?: string; text?: string; thumb?: string; thumbs?: string[] },
): boolean {
  const boards = load();
  const board = boards.find((b) => b.id === boardId);
  if (!board) return false;
  if (board.posts.some((p) => p.uri === post.uri)) return true;
  board.posts.push({
    uri: post.uri, cid: post.cid, authorHandle: post.authorHandle,
    text: post.text, thumb: post.thumb ?? post.thumbs?.[0], thumbs: post.thumbs,
  });
  save(boards);
  return true;
}

/** Remove a post from an artboard. */
export function removePostFromArtboard(boardId: string, postUri: string): void {
  const boards = load();
  const board = boards.find((b) => b.id === boardId);
  if (!board) return;
  board.posts = board.posts.filter((p) => p.uri !== postUri);
  save(boards);
}

/** Check if a post is in any artboard (for card outline indicator). */
export function isPostInAnyArtboard(postUri: string): boolean {
  return load().some((b) => b.posts.some((p) => p.uri === postUri));
}

/** Replace all artboards (after syncing from PDS). */
export function replaceAllArtboards(boards: Artboard[]): void { save(boards); }

// ── PDS Sync ──────────────────────────────────────────────────────────────

/** List artboards from the user's PDS. */
export async function listArtboardsFromPds(): Promise<Artboard[]> {
  const session = getSession();
  if (!session?.did) return [];
  const res = await agent.com.atproto.repo.listRecords({
    repo: session.did, collection: COLLECTION, limit: 100,
  });
  return (res.data.records ?? []).map((r: { uri: string; value: Record<string, unknown> }) => {
    const rkey = r.uri.split('/').pop() ?? r.uri;
    const v = r.value as { name?: string; posts?: ArtboardPost[]; createdAt?: string };
    return {
      id: rkey, name: v.name ?? 'Untitled',
      posts: Array.isArray(v.posts) ? v.posts : [],
      createdAt: v.createdAt ?? new Date().toISOString(),
    };
  }).sort((a: Artboard, b: Artboard) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Push a single artboard to the PDS. */
export async function syncBoardToPds(board: Artboard): Promise<void> {
  const session = getSession();
  if (!session?.did) return;
  await agent.com.atproto.repo.putRecord({
    repo: session.did, collection: COLLECTION, rkey: board.id,
    record: {
      name: board.name,
      posts: board.posts.map((p) => ({
        uri: p.uri, cid: p.cid, authorHandle: p.authorHandle,
        text: p.text?.slice(0, 2000), thumb: p.thumb, thumbs: p.thumbs,
      })),
      createdAt: board.createdAt,
    },
    validate: false,
  });
}

/** Delete an artboard from the PDS. */
export async function deleteArtboardFromPds(rkey: string): Promise<void> {
  const session = getSession();
  if (!session?.did) return;
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did, collection: COLLECTION, rkey,
  });
}
