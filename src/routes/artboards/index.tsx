/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Artboards (Collections) Page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lets users manage their saved post collections:
 *  - Create, rename, and delete artboards
 *  - View saved posts in each artboard
 *  - Sync artboards to PDS for cross-device access
 *  - Remove posts from artboards
 *
 * HOW TO EDIT:
 *  - To change the grid layout, edit the grid styles
 *  - To add new collection features, add UI and call artboards.ts functions
 *  - Data is stored in localStorage and synced to PDS
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useVisibleTask$, $ } from '@builder.io/qwik';
import { Link } from '~/components/app-link/app-link';
import { useAppState } from '~/context/app-context';
import { RichText } from '~/components/rich-text/rich-text';
import { withBase } from '~/lib/path';
import type { Artboard } from '~/lib/types';

export default component$(() => {
  const app = useAppState();
  const boards = useSignal<Artboard[]>([]);
  const selectedBoard = useSignal<string | null>(null);
  const newBoardName = useSignal('');

  // Load artboards
  useVisibleTask$(async () => {
    try {
      const { getArtboards, listArtboardsFromPds, replaceAllArtboards } = await import('~/lib/artboards');
      // Try PDS first, fall back to localStorage
      if (app.session.did) {
        try {
          const pdsBoards = await listArtboardsFromPds();
          if (pdsBoards.length > 0) {
            replaceAllArtboards(pdsBoards);
            boards.value = pdsBoards;
            return;
          }
        } catch { /* fall back to local */ }
      }
      boards.value = getArtboards();
    } catch {
      boards.value = [];
    }
  });

  const createBoard = $(async () => {
    if (!newBoardName.value.trim()) return;
    const { createArtboard, getArtboards, syncBoardToPds } = await import('~/lib/artboards');
    const board = createArtboard(newBoardName.value);
    newBoardName.value = '';
    boards.value = getArtboards();
    // Sync to PDS
    if (app.session.did) {
      try { await syncBoardToPds(board); } catch { /* ignore */ }
    }
  });

  const deleteBoard = $(async (id: string) => {
    const { deleteArtboard, getArtboards, deleteArtboardFromPds } = await import('~/lib/artboards');
    deleteArtboard(id);
    boards.value = getArtboards();
    if (selectedBoard.value === id) selectedBoard.value = null;
    if (app.session.did) {
      try { await deleteArtboardFromPds(id); } catch { /* ignore */ }
    }
  });

  const selected = boards.value.find((b) => b.id === selectedBoard.value);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--font-2xl)', fontWeight: '700', marginBottom: 'var(--space-lg)' }}>
        Collections
      </h1>

      {/* Create new board */}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <input
          type="text"
          placeholder="New collection name..."
          value={newBoardName.value}
          onInput$={(_, el) => { newBoardName.value = el.value; }}
          onKeyDown$={(e) => { if (e.key === 'Enter') createBoard(); }}
          style={{ flex: 1 }}
        />
        <button class="btn" onClick$={createBoard}>Create</button>
      </div>

      {/* Board list */}
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
        {boards.value.map((board) => (
          <button
            key={board.id}
            class={`glass ${selectedBoard.value === board.id ? '' : ''}`}
            style={{
              padding: 'var(--space-md)', textAlign: 'left', minWidth: '150px',
              border: selectedBoard.value === board.id ? '2px solid var(--accent)' : undefined,
            }}
            onClick$={() => { selectedBoard.value = selectedBoard.value === board.id ? null : board.id; }}
          >
            <div class="truncate" style={{ fontWeight: '600', marginBottom: 'var(--space-xs)' }}>
              {board.name}
            </div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>
              {board.posts.length} post{board.posts.length !== 1 ? 's' : ''}
            </div>
          </button>
        ))}
        {boards.value.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No collections yet. Create one above!</p>
        )}
      </div>

      {/* Selected board posts */}
      {selected && (
        <div>
          <div class="flex-between" style={{ marginBottom: 'var(--space-md)' }}>
            <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: '600' }}>
              {selected.name} ({selected.posts.length})
            </h2>
            <button
              class="btn-ghost"
              style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)' }}
              onClick$={() => deleteBoard(selected.id)}
            >
              Delete Collection
            </button>
          </div>

          {selected.posts.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--space-xl)' }}>
              No posts saved. Use the bookmark icon on posts in the feed to save them here.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-md)' }}>
              {selected.posts.map((post) => (
                <div key={post.uri} class="glass" style={{ padding: 'var(--space-sm)', overflow: 'hidden' }}>
                  {post.thumb && (
                    <img
                      src={post.thumb}
                      alt=""
                      style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: 'var(--glass-radius-sm)', marginBottom: 'var(--space-xs)' }}
                      loading="lazy"
                    />
                  )}
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>
                    {post.authorHandle && (
                      <Link href={withBase(`/profile/${encodeURIComponent(post.authorHandle)}/`)} style={{ color: 'inherit', textDecoration: 'none' }}>@{post.authorHandle}</Link>
                    )}
                  </div>
                  {post.text && (
                    <p class="truncate" style={{ fontSize: 'var(--font-xs)' }}>
                      <RichText text={post.text.slice(0, 60) + (post.text.length > 60 ? '…' : '')} />
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
