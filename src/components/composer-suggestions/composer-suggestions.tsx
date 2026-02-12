/**
 * ComposerSuggestions – @ # $ % autosuggest in compose textarea
 *
 * @ = usernames (searchActorsTypeahead)
 * # = hashtags (suggest current query as tag)
 * $ = cashtags (suggest current query)
 * % = forum tags (suggestForumTags from forum lexicon)
 */

import { component$, useSignal, useVisibleTask$, $ } from '@builder.io/qwik';
import './composer-suggestions.css';

type Trigger = '@' | '#' | '$' | '%';

interface SuggestionItem {
  label: string;
  value: string;
  sub?: string;
}

interface ComposerSuggestionsProps {
  value: string;
  onInput$: (value: string) => void;
  placeholder?: string;
  class?: string;
  rows?: number;
}

export const ComposerSuggestions = component$<ComposerSuggestionsProps>(({
  value,
  onInput$,
  placeholder,
  class: className,
  rows = 4,
}) => {
  const textareaRef = useSignal<HTMLTextAreaElement>();
  const showDropdown = useSignal(false);
  const triggerStart = useSignal(0);
  const triggerChar = useSignal<Trigger | null>(null);
  const query = useSignal('');
  const items = useSignal<SuggestionItem[]>([]);
  const loading = useSignal(false);
  const selectedIndex = useSignal(0);

  const replaceTriggerAndQuery = $((replacement: string) => {
    const el = textareaRef.value;
    if (!el) return;
    const start = triggerStart.value;
    const end = start + 1 + query.value.length;
    const newVal = value.slice(0, start) + replacement + ' ' + value.slice(end);
    onInput$(newVal);
    triggerChar.value = null;
    showDropdown.value = false;
    items.value = [];
    selectedIndex.value = 0;
    // Restore focus and cursor
    setTimeout(() => {
      el.focus();
      const pos = start + replacement.length + 1;
      el.setSelectionRange(pos, pos);
    }, 0);
  });

  useVisibleTask$(async ({ track, cleanup }) => {
    track(() => value);
    const el = textareaRef.value;
    if (!el) return;
    const cursor = el.selectionStart;
    const textBefore = value.slice(0, cursor);
    const lastAt = textBefore.lastIndexOf('@');
    const lastHash = textBefore.lastIndexOf('#');
    const lastDollar = textBefore.lastIndexOf('$');
    const lastPct = textBefore.lastIndexOf('%');
    const triggers: { i: number; c: Trigger }[] = [
      { i: lastAt, c: '@' },
      { i: lastHash, c: '#' },
      { i: lastDollar, c: '$' },
      { i: lastPct, c: '%' },
    ].filter((t) => t.i >= 0);
    // No space between trigger and cursor (allow only word chars)
    const valid = triggers.filter((t) => {
      const between = textBefore.slice(t.i + 1, cursor);
      return /^[\w.-]*$/.test(between);
    });
    if (valid.length === 0) {
      showDropdown.value = false;
      return;
    }
    const best = valid.reduce((a, b) => (a.i > b.i ? a : b));
    const q = textBefore.slice(best.i + 1, cursor);
    triggerStart.value = best.i;
    triggerChar.value = best.c;
    query.value = q;

    if (best.c === '@') {
      if (q.length < 1) {
        showDropdown.value = false;
        return;
      }
      showDropdown.value = true;
      loading.value = true;
      let cancelled = false;
      const t = setTimeout(async () => {
        try {
          const bsky = await import('~/lib/bsky');
          const res = await bsky.searchActorsTypeahead(q, 8);
          if (cancelled) return;
          const actors = (res as { actors?: Array<{ handle: string; displayName?: string }> }).actors ?? [];
          items.value = actors.map((a) => ({
            label: a.displayName || a.handle,
            value: `@${a.handle}`,
            sub: a.displayName ? `@${a.handle}` : undefined,
          }));
          selectedIndex.value = 0;
        } catch {
          if (!cancelled) items.value = [];
        }
        loading.value = false;
      }, 200);
      cleanup(() => { cancelled = true; clearTimeout(t); });
      return;
    }

    if (best.c === '#') {
      showDropdown.value = true;
      if (q.length > 0) {
        items.value = [{ label: q, value: `#${q}` }];
      } else {
        items.value = [];
      }
      selectedIndex.value = 0;
      return;
    }

    if (best.c === '$') {
      showDropdown.value = true;
      if (q.length > 0) {
        items.value = [{ label: q, value: `$${q}` }];
      } else {
        items.value = [];
      }
      selectedIndex.value = 0;
      return;
    }

    if (best.c === '%') {
      showDropdown.value = true;
      loading.value = true;
      let cancelled = false;
      const t = setTimeout(async () => {
        try {
          const forum = await import('~/lib/forum');
          const tags = await forum.suggestForumTags(q, 10);
          if (cancelled) return;
          items.value = tags.map((t) => ({ label: t, value: `%${t}` }));
          selectedIndex.value = 0;
        } catch {
          if (!cancelled) items.value = [];
        }
        loading.value = false;
      }, 200);
      cleanup(() => { cancelled = true; clearTimeout(t); });
    }
  });

  return (
    <div class={`composer-suggestions-wrap ${className ?? ''}`}>
      <textarea
        ref={textareaRef}
        class="compose-textarea"
        placeholder={placeholder}
        rows={rows}
        value={value}
        onInput$={(_, el) => onInput$(el.value)}
        onKeyDown$={(e, el) => {
          if (!showDropdown.value || items.value.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex.value = Math.min(selectedIndex.value + 1, items.value.length - 1);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab' || ((e.ctrlKey || e.metaKey) && e.key === 'e')) {
            e.preventDefault();
            const item = items.value[selectedIndex.value];
            if (item) replaceTriggerAndQuery(item.value);
            return;
          }
          if (e.key === 'Escape') {
            showDropdown.value = false;
          }
        }}
      />
      {showDropdown.value && (items.value.length > 0 || loading.value) && (
        <div class="composer-suggestions-dropdown glass">
          {loading.value && items.value.length === 0 && (
            <div class="composer-suggestions-loading">Loading…</div>
          )}
          {items.value.map((item, i) => (
            <button
              key={`${item.value}-${i}`}
              type="button"
              class={`composer-suggestion-item ${i === selectedIndex.value ? 'selected' : ''}`}
              onClick$={() => replaceTriggerAndQuery(item.value)}
              onMouseDown$={(e) => e.preventDefault()}
            >
              <span class="composer-suggestion-label">{item.label}</span>
              {item.sub && <span class="composer-suggestion-sub">{item.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
