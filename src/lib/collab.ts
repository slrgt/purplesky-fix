/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Collaboration Tools for Animators & Game Devs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module provides:
 *  - Project metadata storage on PDS (Blender, Godot, general projects)
 *  - External storage references (Git LFS, cloud, torrent v2 / hybrid magnets)
 *  - Lightweight preview management
 *  - Kanban boards for task management
 *  - Annotation and threaded feedback on assets
 *
 * WORKFLOW (recommended):
 *  - Full files (.blend, Godot projects) → stored externally (Git LFS, cloud, torrent)
 *  - PDS stores metadata only: name, owner, description, tags, version, preview links
 *  - Lightweight previews (GLTF, screenshots, HTML5 exports) → stored on PDS
 *  - Annotations and feedback → stored as forum replies linked to the project
 *
 * HOW TO EDIT:
 *  - To add a new project type, add it to ProjectType in types.ts
 *  - To add new metadata fields, update the record schema below
 *  - Kanban boards are stored in localStorage (could be synced to PDS)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { agent, getSession, parseAtUri, publicAgent } from './bsky';
import type { CollabProject, KanbanBoard, KanbanCard, ProjectType } from './types';

// ── Collection Names ──────────────────────────────────────────────────────

const PROJECT_COLLECTION = 'app.purplesky.collab.project';
const ANNOTATION_COLLECTION = 'app.purplesky.collab.annotation';
const KANBAN_KEY = 'purplesky-kanban';

// ── Projects ──────────────────────────────────────────────────────────────

/** Create a new collaboration project. */
export async function createProject(opts: {
  name: string;
  description: string;
  type: ProjectType;
  tags?: string[];
  version?: string;
  externalUrl?: string;
  magnetLink?: string;
  previewUrl?: string;
}): Promise<{ uri: string; cid: string }> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const rkey = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: PROJECT_COLLECTION,
    rkey,
    record: {
      $type: PROJECT_COLLECTION,
      name: opts.name.trim(),
      description: opts.description.trim(),
      type: opts.type,
      tags: opts.tags ?? [],
      version: opts.version ?? '0.1.0',
      externalUrl: opts.externalUrl,
      magnetLink: opts.magnetLink,
      previewUrl: opts.previewUrl,
      owner: session.did,
      createdAt: new Date().toISOString(),
    },
    validate: false,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/** List projects from a user's repo. */
export async function listProjects(
  did: string,
  opts?: { limit?: number; cursor?: string },
): Promise<{ projects: CollabProject[]; cursor?: string }> {
  const client = getSession() ? agent : publicAgent;
  try {
    const res = await client.com.atproto.repo.listRecords({
      repo: did,
      collection: PROJECT_COLLECTION,
      limit: opts?.limit ?? 30,
      cursor: opts?.cursor,
    });
    const projects: CollabProject[] = (res.data.records ?? []).map(
      (r: { uri: string; value: Record<string, unknown> }) => {
        const v = r.value as CollabProject;
        return { ...v, uri: r.uri };
      },
    );
    return { projects, cursor: res.data.cursor };
  } catch {
    return { projects: [], cursor: undefined };
  }
}

/** Get a single project by URI. */
export async function getProject(uri: string): Promise<CollabProject | null> {
  const parsed = parseAtUri(uri);
  if (!parsed) return null;
  const client = getSession() ? agent : publicAgent;
  try {
    const res = await client.com.atproto.repo.getRecord({
      repo: parsed.did, collection: PROJECT_COLLECTION, rkey: parsed.rkey,
    });
    const v = res.data.value as CollabProject;
    return { ...v, uri: res.data.uri as string };
  } catch {
    return null;
  }
}

/** Update project metadata. */
export async function updateProject(
  uri: string,
  updates: Partial<Omit<CollabProject, 'uri' | 'owner' | 'createdAt'>>,
): Promise<void> {
  const project = await getProject(uri);
  if (!project) throw new Error('Project not found');
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const parsed = parseAtUri(uri);
  if (!parsed) throw new Error('Invalid URI');
  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: PROJECT_COLLECTION,
    rkey: parsed.rkey,
    record: {
      $type: PROJECT_COLLECTION,
      ...project,
      ...updates,
      uri: undefined, // Don't store uri in the record
    },
    validate: false,
  });
}

// ── Annotations (Feedback on Assets) ──────────────────────────────────────

/** Create an annotation on a project asset (keyframe, node, sprite, etc.). */
export async function createAnnotation(opts: {
  projectUri: string;
  target: string; // e.g., "keyframe:42", "node:Player/Sprite", "object:Cube.001"
  text: string;
  replyToUri?: string;
}): Promise<{ uri: string; cid: string }> {
  const session = getSession();
  if (!session?.did) throw new Error('Not logged in');
  const rkey = `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: ANNOTATION_COLLECTION,
    rkey,
    record: {
      $type: ANNOTATION_COLLECTION,
      project: opts.projectUri,
      target: opts.target,
      text: opts.text.trim(),
      replyTo: opts.replyToUri,
      createdAt: new Date().toISOString(),
    },
    validate: false,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

// ── Kanban Boards (Local Storage) ─────────────────────────────────────────

/** Get or create a kanban board for a project. */
export function getKanbanBoard(projectUri: string): KanbanBoard {
  const all = getAllKanbanBoards();
  const existing = all.find((b) => b.projectUri === projectUri);
  if (existing) return existing;

  const newBoard: KanbanBoard = {
    id: `kanban-${Date.now()}`,
    projectUri,
    columns: [
      { id: 'todo', title: 'To Do', cards: [] },
      { id: 'in-progress', title: 'In Progress', cards: [] },
      { id: 'review', title: 'Review', cards: [] },
      { id: 'done', title: 'Done', cards: [] },
    ],
  };
  all.push(newBoard);
  saveKanbanBoards(all);
  return newBoard;
}

function getAllKanbanBoards(): KanbanBoard[] {
  try {
    const raw = localStorage.getItem(KANBAN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveKanbanBoards(boards: KanbanBoard[]): void {
  try { localStorage.setItem(KANBAN_KEY, JSON.stringify(boards)); } catch { /* ignore */ }
}

/** Add a card to a kanban column. */
export function addKanbanCard(
  projectUri: string,
  columnId: string,
  card: Omit<KanbanCard, 'id' | 'createdAt'>,
): KanbanCard {
  const board = getKanbanBoard(projectUri);
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) throw new Error('Column not found');
  const newCard: KanbanCard = {
    ...card,
    id: `card-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  col.cards.push(newCard);
  const all = getAllKanbanBoards();
  const idx = all.findIndex((b) => b.id === board.id);
  if (idx >= 0) all[idx] = board;
  saveKanbanBoards(all);
  return newCard;
}

/** Move a card between columns. */
export function moveKanbanCard(
  projectUri: string,
  cardId: string,
  toColumnId: string,
): void {
  const board = getKanbanBoard(projectUri);
  let card: KanbanCard | undefined;
  for (const col of board.columns) {
    const idx = col.cards.findIndex((c) => c.id === cardId);
    if (idx >= 0) {
      card = col.cards.splice(idx, 1)[0];
      break;
    }
  }
  if (!card) return;
  const toCol = board.columns.find((c) => c.id === toColumnId);
  if (toCol) toCol.cards.push(card);
  const all = getAllKanbanBoards();
  const idx = all.findIndex((b) => b.id === board.id);
  if (idx >= 0) all[idx] = board;
  saveKanbanBoards(all);
}
