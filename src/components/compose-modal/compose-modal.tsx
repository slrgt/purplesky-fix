/**
 * Compose Modal – New post / thread with optional images
 *
 * Supports multiple segments (thread): first post can have text + images,
 * follow-up posts text only (Bluesky reply chain).
 */

import { component$, useStore, useSignal, $ } from '@builder.io/qwik';
import { useAppState } from '~/context/app-context';
import { ComposerSuggestions } from '~/components/composer-suggestions/composer-suggestions';
import './compose-modal.css';

export interface ComposeSegment {
  text: string;
  imageFiles: File[];
  imageAlts: string[];
}

export const ComposeModal = component$(() => {
  const app = useAppState();
  const segments = useStore<ComposeSegment[]>([
    { text: '', imageFiles: [], imageAlts: [] },
  ]);
  const currentIndex = useSignal(0);
  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);

  const addSegment = $(() => {
    segments.push({ text: '', imageFiles: [], imageAlts: [] });
    currentIndex.value = segments.length - 1;
  });

  const removeSegment = $((i: number) => {
    if (i <= 0 || segments.length <= 1) return;
    segments.splice(i, 1);
    currentIndex.value = Math.min(currentIndex.value, segments.length - 1);
  });

  const onSegmentTextChange = $((i: number, value: string) => {
    segments[i].text = value;
  });

  const onSegmentImagesChange = $((i: number, files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 4);
    segments[i].imageFiles = list;
    while (segments[i].imageAlts.length < list.length) segments[i].imageAlts.push('');
    segments[i].imageAlts = segments[i].imageAlts.slice(0, list.length);
  });

  const setSegmentAlt = $((segIdx: number, imgIdx: number, alt: string) => {
    const seg = segments[segIdx];
    const next = [...seg.imageAlts];
    next[imgIdx] = alt;
    seg.imageAlts = next;
  });

  const submit = $(async () => {
    const withContent = segments
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => i === 0 ? (s.text.trim() || s.imageFiles.length > 0) : s.text.trim().length > 0);
    if (withContent.length === 0) {
      error.value = 'Add some text or an image.';
      return;
    }
    error.value = null;
    submitting.value = true;
    try {
      const bsky = await import('~/lib/bsky');
      let rootUri: string | null = null;
      let rootCid: string | null = null;
      let parentUri: string | null = null;
      let parentCid: string | null = null;

      for (const { s, i } of withContent) {
        const text = s.text.trim() || (i === 0 && s.imageFiles.length > 0 ? '' : ' ');
        if (i === 0) {
          const res = await bsky.createPost(
            text,
            s.imageFiles.length ? s.imageFiles : undefined,
            s.imageAlts.length ? s.imageAlts : undefined,
          );
          rootUri = res.uri;
          rootCid = res.cid;
          parentUri = res.uri;
          parentCid = res.cid;
        } else {
          if (!rootUri || !rootCid || !parentUri || !parentCid) continue;
          const res = await bsky.postReply(rootUri, rootCid, parentUri, parentCid, text);
          parentUri = res.uri;
          parentCid = res.cid;
        }
      }
      app.showComposeModal = false;
      segments.length = 0;
      segments.push({ text: '', imageFiles: [], imageAlts: [] });
      currentIndex.value = 0;
      // Optionally trigger feed refresh (e.g. window.dispatchEvent or callback)
      window.dispatchEvent(new CustomEvent('purplesky-feed-refresh'));
    } catch (err) {
      console.error('Compose submit failed:', err);
      error.value = err instanceof Error ? err.message : 'Failed to post.';
    } finally {
      submitting.value = false;
    }
  });

  const close = $(() => {
    app.showComposeModal = false;
  });

  return (
    <div class="compose-overlay" onClick$={close}>
      <div class="compose-modal glass-strong" onClick$={(e) => e.stopPropagation()}>
        <div class="compose-header">
          <h2 class="compose-title">New post</h2>
          <button type="button" class="compose-close" onClick$={close} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Segment tabs when multiple */}
        {segments.length > 1 && (
          <div class="compose-segment-tabs">
            {segments.map((_, i) => (
              <button
                key={i}
                type="button"
                class={`compose-segment-tab ${currentIndex.value === i ? 'active' : ''}`}
                onClick$={() => { currentIndex.value = i; }}
              >
                Post {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* Current segment */}
        {segments[currentIndex.value] && (
          <div class="compose-body">
            <ComposerSuggestions
              value={segments[currentIndex.value].text}
              onInput$={(v) => onSegmentTextChange(currentIndex.value, v)}
              placeholder="What's on your mind? Use @ for mentions, # for hashtags, $ for cashtags, % for forum tags."
              rows={4}
            />
            {currentIndex.value === 0 && (
              <>
                <div class="compose-images">
                  <label class="compose-image-label">
                    <span>Add images (max 4)</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange$={(_, el) => onSegmentImagesChange(0, el.files)}
                    />
                  </label>
                  {segments[0].imageFiles.map((file, imgIdx) => (
                    <div key={imgIdx} class="compose-image-preview">
                      <img
                        src={URL.createObjectURL(file)}
                        alt=""
                        width={80}
                        height={80}
                        style={{ objectFit: 'cover', borderRadius: 'var(--glass-radius-sm)' }}
                      />
                      <input
                        type="text"
                        placeholder="Alt text"
                        value={segments[0].imageAlts[imgIdx] ?? ''}
                        onInput$={(_, input) => setSegmentAlt(0, imgIdx, input.value)}
                        class="compose-alt-input"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {error.value && (
          <p class="compose-error" role="alert">{error.value}</p>
        )}

        <div class="compose-actions">
          <button
            type="button"
            class="btn-ghost"
            onClick$={addSegment}
          >
            Add post (thread)
          </button>
          {segments.length > 1 && (
            <button
              type="button"
              class="btn-ghost"
              onClick$={() => removeSegment(currentIndex.value)}
            >
              Remove this post
            </button>
          )}
          <button
            type="button"
            class="btn modal-submit"
            onClick$={submit}
            disabled={submitting.value}
          >
            {submitting.value ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
});
