/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Consensus Page – Polis-like Collaborative Decision Making
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Features:
 *  - Submit statements for group discussion
 *  - Vote agree/disagree/pass on each statement
 *  - Real-time consensus visualization (agreement bars, heatmaps)
 *  - Opinion cluster detection via WASM
 *  - Polls and surveys
 *  - Integration with forums (consensus topics link to forum threads)
 *  - Microcosm constellation cross-references
 *
 * HOW THIS WORKS (Polis-like):
 *  1. A topic is created with an initial set of statements
 *  2. Users vote agree/disagree/pass on each statement
 *  3. WASM analyzes votes to find opinion clusters and consensus
 *  4. Visualization shows which statements have broad agreement
 *
 * HOW TO EDIT:
 *  - To change the voting UI, edit the statement card section
 *  - To change how consensus is calculated, edit wasm/src/lib.rs
 *  - To add new visualization types, add components below
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { component$, useSignal, useStore, useVisibleTask$, $ } from '@builder.io/qwik';
import { useAppState } from '~/context/app-context';
import { RichText } from '~/components/rich-text/rich-text';
import type { ConsensusResult } from '~/lib/types';

const STATEMENT_COLLECTION = 'app.purplesky.forum.post';
const VOTE_COLLECTION = 'app.purplesky.consensus.vote';

export default component$(() => {
  const app = useAppState();

  const statements = useStore<Array<{ id: string; uri: string; text: string; myVote: -1 | 0 | 1 | null; authorHandle?: string }>>([]);
  const newStatement = useSignal('');
  const result = useSignal<ConsensusResult | null>(null);
  const analyzing = useSignal(false);
  const loadingStatements = useSignal(true);

  // Load statements and votes from PDS on mount
  useVisibleTask$(async () => {
    try {
      const { agent, publicAgent, getSession } = await import('~/lib/bsky');
      const session = getSession();
      const client = session ? agent : publicAgent;

      // Load statements tagged with "consensus" from known DIDs
      // For now, load from the logged-in user's repo + any community repos
      const didsToCheck: string[] = [];
      if (session?.did) didsToCheck.push(session.did);

      const loaded: typeof statements = [];
      const seenUris = new Set<string>();

      for (const did of didsToCheck) {
        try {
          const res = await client.com.atproto.repo.listRecords({
            repo: did, collection: STATEMENT_COLLECTION, limit: 100,
          });
          for (const r of res.data.records ?? []) {
            if (seenUris.has(r.uri)) continue;
            const v = r.value as { title?: string; body?: string; tags?: string[] };
            // Only include posts tagged "consensus"
            if (!v.tags?.includes('consensus')) continue;
            seenUris.add(r.uri);
            loaded.push({
              id: r.uri.split('/').pop() ?? r.uri,
              uri: r.uri,
              text: v.title || v.body || '',
              myVote: null,
            });
          }
        } catch { /* ignore */ }
      }

      // Load existing votes
      if (session?.did) {
        try {
          const voteRes = await client.com.atproto.repo.listRecords({
            repo: session.did, collection: VOTE_COLLECTION, limit: 100,
          });
          for (const r of voteRes.data.records ?? []) {
            const v = r.value as { statement?: string; value?: number };
            if (v.statement) {
              const stmt = loaded.find((s) => s.uri === v.statement);
              if (stmt) stmt.myVote = (v.value ?? null) as -1 | 0 | 1 | null;
            }
          }
        } catch { /* ignore */ }
      }

      // If no consensus statements exist yet, seed with examples so the page isn't empty
      if (loaded.length === 0) {
        const examples = [
          'Forums should support markdown formatting',
          'Real-time collaboration features are more important than async tools',
          'The app should prioritize mobile experience over desktop',
          'Blender and Godot workflows should have dedicated UI sections',
          'AI-powered content moderation would improve the community',
        ];
        examples.forEach((text, i) => {
          loaded.push({ id: `seed-${i}`, uri: '', text, myVote: null });
        });
      }

      statements.splice(0, statements.length, ...loaded);
    } catch (err) {
      console.error('Failed to load consensus data:', err);
    }
    loadingStatements.value = false;
  });

  // Analyze consensus whenever votes change
  const analyze = $(async () => {
    analyzing.value = true;
    const votes = statements
      .filter((s) => s.myVote !== null)
      .map((s) => ({
        user_id: app.session.did ?? 'anonymous',
        statement_id: s.id,
        value: s.myVote as number,
      }));

    if (votes.length === 0) { analyzing.value = false; return; }

    try {
      const { analyzeConsensus } = await import('~/lib/wasm-bridge');
      result.value = await analyzeConsensus(votes);
    } catch (err) {
      console.error('Consensus analysis failed:', err);
    }
    analyzing.value = false;
  });

  const vote = $(async (statementId: string, value: -1 | 0 | 1) => {
    const stmt = statements.find((s) => s.id === statementId);
    if (!stmt) return;

    const newVote = stmt.myVote === value ? null : value;
    stmt.myVote = newVote;

    // Persist vote to PDS
    if (stmt.uri) {
      try {
        const { agent, getSession } = await import('~/lib/bsky');
        const session = getSession();
        if (session?.did) {
          const rkey = `vote-${stmt.id.replace(/[^a-zA-Z0-9-]/g, '')}`;
          if (newVote !== null) {
            await agent.com.atproto.repo.putRecord({
              repo: session.did, collection: VOTE_COLLECTION, rkey,
              record: {
                $type: VOTE_COLLECTION,
                statement: stmt.uri,
                value: newVote,
                createdAt: new Date().toISOString(),
              },
              validate: false,
            });
          } else {
            try {
              await agent.com.atproto.repo.deleteRecord({
                repo: session.did, collection: VOTE_COLLECTION, rkey,
              });
            } catch { /* may not exist */ }
          }
        }
      } catch (err) {
        console.error('Failed to persist vote:', err);
      }
    }

    analyze();
  });

  const addStatement = $(async () => {
    if (!newStatement.value.trim()) return;
    const text = newStatement.value.trim();

    // Persist to PDS as a forum post tagged "consensus"
    let uri = '';
    try {
      const { agent, getSession } = await import('~/lib/bsky');
      const session = getSession();
      if (session?.did) {
        const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const res = await agent.com.atproto.repo.putRecord({
          repo: session.did, collection: STATEMENT_COLLECTION, rkey,
          record: {
            $type: STATEMENT_COLLECTION,
            title: text, body: text, tags: ['consensus'],
            createdAt: new Date().toISOString(),
          },
          validate: false,
        });
        uri = res.data.uri;
      }
    } catch (err) {
      console.error('Failed to persist statement:', err);
    }

    statements.push({
      id: uri ? uri.split('/').pop()! : `${Date.now()}`,
      uri,
      text,
      myVote: null,
    });
    newStatement.value = '';
  });

  // Get consensus data for a statement
  const getStatementResult = (id: string) => {
    return result.value?.statements.find((s) => s.statementId === id);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--font-2xl)', fontWeight: '700', marginBottom: 'var(--space-sm)' }}>
        Consensus
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-xl)' }}>
        Vote on statements to find where the community agrees. Powered by WASM consensus analysis.
      </p>

      {loadingStatements.value && (
        <div class="flex-center" style={{ padding: 'var(--space-2xl)' }}><div class="spinner" /></div>
      )}

      {/* Statement Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        {statements.map((stmt) => {
          const sr = getStatementResult(stmt.id);
          return (
            <div key={stmt.id} class="glass" style={{ padding: 'var(--space-md)' }}>
              <p style={{ marginBottom: 'var(--space-md)', lineHeight: '1.5' }}>
                <RichText text={stmt.text} />
              </p>

              {/* Vote buttons */}
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: sr ? 'var(--space-sm)' : '0' }}>
                <button
                  class={stmt.myVote === 1 ? 'btn' : 'btn-ghost'}
                  style={{ fontSize: 'var(--font-sm)', padding: '6px 16px', background: stmt.myVote === 1 ? 'var(--success)' : undefined }}
                  onClick$={() => vote(stmt.id, 1)}
                >
                  Agree
                </button>
                <button
                  class={stmt.myVote === -1 ? 'btn' : 'btn-ghost'}
                  style={{ fontSize: 'var(--font-sm)', padding: '6px 16px', background: stmt.myVote === -1 ? 'var(--error)' : undefined, color: stmt.myVote === -1 ? '#fff' : undefined }}
                  onClick$={() => vote(stmt.id, -1)}
                >
                  Disagree
                </button>
                <button
                  class={stmt.myVote === 0 ? 'btn' : 'btn-ghost'}
                  style={{ fontSize: 'var(--font-sm)', padding: '6px 16px', opacity: stmt.myVote === 0 ? 1 : 0.6 }}
                  onClick$={() => vote(stmt.id, 0)}
                >
                  Pass
                </button>
              </div>

              {/* Consensus bar (if results available) */}
              {sr && (
                <div style={{ marginTop: 'var(--space-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-xs)', color: 'var(--muted)', marginBottom: '4px' }}>
                    <span>{Math.round(sr.agreementRatio * 100)}% agree</span>
                    <span>Divisiveness: {Math.round(sr.divisiveness * 100)}%</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${sr.agreementRatio * 100}%`,
                      background: sr.agreementRatio > 0.66 ? 'var(--success)' : sr.agreementRatio > 0.33 ? 'var(--warning)' : 'var(--error)',
                      borderRadius: '3px', transition: 'width var(--transition-normal)',
                    }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Statement */}
      <div class="glass-strong" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-xl)' }}>
        <h3 style={{ marginBottom: 'var(--space-sm)' }}>Add a Statement</h3>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <input
            type="text"
            placeholder="What should the community decide on?"
            value={newStatement.value}
            onInput$={(_, el) => { newStatement.value = el.value; }}
            style={{ flex: 1 }}
          />
          <button class="btn" onClick$={addStatement}>Add</button>
        </div>
      </div>

      {/* Cluster Visualization */}
      {result.value && result.value.clusterCount > 0 && (
        <div class="glass" style={{ padding: 'var(--space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Opinion Clusters</h3>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--font-sm)', marginBottom: 'var(--space-md)' }}>
            {result.value.totalParticipants} participant{result.value.totalParticipants !== 1 ? 's' : ''} ·{' '}
            {result.value.clusterCount} opinion group{result.value.clusterCount !== 1 ? 's' : ''}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
            {result.value.clusters.map((cluster) => (
              <div key={cluster.id} class="glass" style={{ padding: 'var(--space-md)', flex: '1 1 200px' }}>
                <h4 style={{ fontSize: 'var(--font-sm)', fontWeight: '700', marginBottom: 'var(--space-xs)' }}>
                  Group {cluster.id + 1}
                </h4>
                <p style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)' }}>
                  {cluster.memberCount} member{cluster.memberCount !== 1 ? 's' : ''} ·{' '}
                  Avg agreement: {Math.round(cluster.avgAgreement * 100)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
