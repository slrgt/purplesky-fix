/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FeedSelector – Configure Feed Mixing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lets users mix multiple Bluesky feeds with percentage weights.
 * Includes Following (timeline), Add from saved, Manage saved feeds (edit list
 * on PDS), and Discover feeds.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useVisibleTask$, useSignal, $, type QRL } from '@builder.io/qwik';
import { useAppState } from '~/context/app-context';
import type { SavedFeedItem } from '~/lib/bsky';

interface FeedSelectorProps {
  onClose$: QRL<() => void>;
}

function savedFeedLabel(f: SavedFeedItem): string {
  if (f.type === 'timeline') return 'Following';
  return f.value.split('/').pop() ?? f.value;
}

export const FeedSelector = component$<FeedSelectorProps>(({ onClose$ }) => {
  const app = useAppState();
  /** Local copy of percents so the % label updates live when dragging the slider */
  const percentValues = useSignal<number[]>([]);
  const savedFeeds = useSignal<SavedFeedItem[]>([]);
  const showManage = useSignal(false);
  const suggestedFeeds = useSignal<Array<{ uri: string; displayName?: string; description?: string }>>([]);
  const loadingSuggested = useSignal(false);
  const manageError = useSignal('');

  useVisibleTask$(({ track }) => {
    track(() => app.feedMix.map((e) => e.percent));
    track(() => app.feedMix.length);
    percentValues.value = app.feedMix.map((e) => e.percent);
  });

  const refreshSavedFeeds = $(async () => {
    try {
      const { getSavedFeeds } = await import('~/lib/bsky');
      savedFeeds.value = await getSavedFeeds();
    } catch { /* ignore */ }
  });

  useVisibleTask$(async () => {
    await refreshSavedFeeds();
  });

  return (
    <div class="feed-selector">
      <div class="flex-between feed-selector-header">
        <h3 class="feed-selector-title">Mix Feeds</h3>
        <button class="icon-btn feed-selector-close" onClick$={onClose$} aria-label="Close">✕</button>
      </div>

      {/* Current mix entries */}
      {app.feedMix.map((entry, i) => (
        <div key={i} class="feed-mix-entry">
          <span class="feed-mix-label truncate">{entry.source.label}</span>
          <input
            type="range"
            min="0"
            max="100"
            value={percentValues.value[i] ?? entry.percent}
            class="feed-mix-slider"
            onInput$={(_, el) => {
              const pct = Math.min(100, Math.max(0, parseInt(el.value, 10) || 0));
              const next = app.feedMix.map((e, j) =>
                j === i ? { ...e, percent: pct } : e,
              );
              app.feedMix = next;
              percentValues.value = next.map((e) => e.percent);
            }}
          />
          <span class="feed-mix-pct">{percentValues.value[i] ?? entry.percent}%</span>
          <button
            class="icon-btn feed-mix-remove"
            onClick$={() => {
              app.feedMix = app.feedMix.filter((_, j) => j !== i);
            }}
            aria-label="Remove feed"
          >
            ✕
          </button>
        </div>
      ))}

      {/* Add from saved: Following + saved feeds not already in mix */}
      <div class="feed-selector-add">
        <p class="feed-selector-add-label">Add from saved:</p>
        <div class="feed-selector-add-btns">
          {!app.feedMix.some((m) => m.source.kind === 'timeline') && (
            <button
              class="btn-ghost feed-selector-add-btn"
              onClick$={() => {
                app.feedMix = [
                  ...app.feedMix,
                  { source: { kind: 'timeline', label: 'Following' }, percent: 20 },
                ];
              }}
            >
              + Following
            </button>
          )}
          {savedFeeds.value
            .filter((f) => f.type === 'feed' && !app.feedMix.some((m) => m.source.uri === f.value))
            .map((f) => (
              <button
                key={f.id}
                class="btn-ghost feed-selector-add-btn"
                onClick$={() => {
                  app.feedMix = [
                    ...app.feedMix,
                    { source: { kind: 'custom', label: savedFeedLabel(f), uri: f.value }, percent: 20 },
                  ];
                }}
              >
                + {savedFeedLabel(f)}
              </button>
            ))}
        </div>
      </div>

      {/* Manage saved feeds (edit list on PDS) */}
      <div class="feed-selector-manage">
        <button
          type="button"
          class="btn-ghost feed-selector-manage-btn"
          onClick$={() => {
            showManage.value = !showManage.value;
            manageError.value = '';
            if (showManage.value) suggestedFeeds.value = [];
          }}
        >
          {showManage.value ? 'Done' : 'Edit saved feeds'}
        </button>
        {showManage.value && (
          <div class="feed-selector-manage-panel">
            {manageError.value && <p class="feed-selector-error">{manageError.value}</p>}
            <p class="feed-selector-add-label">Saved on your account (remove to delete from list):</p>
            <ul class="feed-selector-saved-list">
              {savedFeeds.value.map((f) => (
                <li key={f.id} class="feed-selector-saved-item">
                  <span class="feed-selector-saved-label">{savedFeedLabel(f)}</span>
                  {f.type === 'timeline' ? (
                    <span class="feed-selector-saved-note">(built-in)</span>
                  ) : (
                    <button
                      type="button"
                      class="btn-ghost feed-selector-remove-saved"
                      onClick$={$(async () => {
                        try {
                          const { removeSavedFeeds } = await import('~/lib/bsky');
                          await removeSavedFeeds([f.id]);
                          await refreshSavedFeeds();
                        } catch (e) {
                          manageError.value = e instanceof Error ? e.message : 'Failed to remove';
                        }
                      })}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p class="feed-selector-add-label" style={{ marginTop: 'var(--space-sm)' }}>Discover feeds (add to your saved list):</p>
            {suggestedFeeds.value.length === 0 && !loadingSuggested.value && (
              <button
                type="button"
                class="btn-ghost feed-selector-add-btn"
                onClick$={$(async () => {
                  loadingSuggested.value = true;
                  manageError.value = '';
                  try {
                    const { getSuggestedFeeds } = await import('~/lib/bsky');
                    const { feeds } = await getSuggestedFeeds(20);
                    suggestedFeeds.value = feeds;
                  } catch (e) {
                    manageError.value = e instanceof Error ? e.message : 'Failed to load suggestions';
                  }
                  loadingSuggested.value = false;
                })}
              >
                Load suggested feeds
              </button>
            )}
            {loadingSuggested.value && <span class="feed-selector-muted">Loading…</span>}
            <ul class="feed-selector-suggested-list">
              {suggestedFeeds.value
                .filter((s) => !savedFeeds.value.some((f) => f.type === 'feed' && f.value === s.uri))
                .map((s) => (
                  <li key={s.uri} class="feed-selector-suggested-item">
                    <span class="feed-selector-saved-label">{s.displayName || s.uri.split('/').pop() || s.uri}</span>
                    <button
                      type="button"
                      class="btn-ghost feed-selector-add-btn"
                      onClick$={$(async () => {
                        try {
                          const { addSavedFeeds } = await import('~/lib/bsky');
                          await addSavedFeeds([{ type: 'feed', value: s.uri }]);
                          await refreshSavedFeeds();
                        } catch (e) {
                          manageError.value = e instanceof Error ? e.message : 'Failed to add';
                        }
                      })}
                    >
                      Save
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      {/* Balance button */}
      <button
        class="btn feed-selector-balance"
        onClick$={() => {
          if (app.feedMix.length === 0) return;
          const each = Math.floor(100 / app.feedMix.length);
          app.feedMix = app.feedMix.map((e) => ({ ...e, percent: each }));
        }}
      >
        Balance Evenly
      </button>

      <style>{`
        .feed-selector { padding: var(--space-sm) 0; margin: 0; min-width: 0; }
        .feed-selector-header { margin-bottom: var(--space-sm); }
        .feed-selector-title { font-size: var(--font-base); font-weight: 700; margin: 0; }
        .feed-selector-close { width: 28px; height: 28px; min-width: 28px; min-height: 28px; font-size: var(--font-sm); }
        .feed-mix-entry { display: flex; align-items: center; gap: var(--space-xs); margin-bottom: var(--space-xs); }
        .feed-mix-label { flex: 0 0 72px; font-size: var(--font-xs); font-weight: 600; min-width: 0; }
        .feed-mix-slider { flex: 1; min-width: 0; accent-color: var(--accent); }
        .feed-mix-pct { font-size: var(--font-xs); font-weight: 700; color: var(--accent); min-width: 28px; text-align: right; }
        .feed-mix-remove { width: 24px; height: 24px; min-width: 24px; min-height: 24px; font-size: var(--font-xs); }
        .feed-selector-add { margin-top: var(--space-sm); }
        .feed-selector-add-label { font-size: var(--font-xs); color: var(--muted); margin: 0 0 var(--space-xs); }
        .feed-selector-add-btns { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
        .feed-selector-add-btn { font-size: var(--font-xs); padding: 2px 6px; }
        .feed-selector-balance { margin-top: var(--space-sm); width: 100%; justify-content: center; font-size: var(--font-sm); padding: var(--space-xs) var(--space-sm); }
        .feed-selector-manage { margin-top: var(--space-sm); }
        .feed-selector-manage-btn { font-size: var(--font-xs); padding: 2px 6px; }
        .feed-selector-manage-panel { margin-top: var(--space-xs); padding: var(--space-sm) 0; border-top: 1px solid var(--border); }
        .feed-selector-error { font-size: var(--font-xs); color: var(--danger); margin: 0 0 var(--space-xs); }
        .feed-selector-saved-list, .feed-selector-suggested-list { list-style: none; margin: 0; padding: 0; }
        .feed-selector-saved-item, .feed-selector-suggested-item { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); padding: var(--space-xs) 0; font-size: var(--font-xs); }
        .feed-selector-saved-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .feed-selector-saved-note { font-size: var(--font-xs); color: var(--muted); }
        .feed-selector-remove-saved { font-size: var(--font-xs); padding: 2px 6px; color: var(--danger); }
        .feed-selector-muted { font-size: var(--font-xs); color: var(--muted); }
        @media (max-width: 480px) {
          .feed-mix-label { flex: 0 0 56px; }
        }
      `}</style>
    </div>
  );
});
