/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WASM Bridge – JavaScript ↔ Rust/WebAssembly Interface
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module lazily loads the Rust-compiled WASM and exposes typed
 * TypeScript functions. The WASM is only loaded when first needed
 * (keeps initial page load fast).
 *
 * HOW TO EDIT:
 *  - After editing wasm/src/lib.rs, rebuild: npm run build:wasm
 *  - Add new wrapper functions here that call the WASM exports
 *  - All data passes through JSON serialization (JS ↔ WASM)
 *
 * FALLBACK: If WASM fails to load, each function has a JavaScript
 * fallback so the app still works (just slightly slower).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ConsensusResult, ConsensusVote } from './types';

// The WASM module (lazy loaded)
let wasmModule: Record<string, unknown> | null = null;
let wasmLoadPromise: Promise<Record<string, unknown>> | null = null;

/**
 * Load the WASM module. Called automatically on first use.
 * Returns the WASM exports object.
 */
async function loadWasm(): Promise<Record<string, unknown>> {
  if (wasmModule) return wasmModule;
  if (wasmLoadPromise) return wasmLoadPromise;

  wasmLoadPromise = (async () => {
    try {
      // Dynamic import of the wasm-pack output
      const mod = await import('../wasm-pkg/purplesky_wasm.js');
      // Initialize the WASM module (wasm-pack generates an init function)
      if (typeof mod.default === 'function') {
        await mod.default();
      }
      wasmModule = mod;
      console.log('[WASM] Module loaded successfully');
      return mod;
    } catch (err) {
      console.warn('[WASM] Failed to load, using JS fallbacks:', err);
      wasmModule = {};
      return {};
    }
  })();

  return wasmLoadPromise;
}

/** Check if WASM is available. */
export async function isWasmReady(): Promise<boolean> {
  const mod = await loadWasm();
  return Object.keys(mod).length > 0;
}

// ── Feed Sorting ──────────────────────────────────────────────────────────

interface SortablePost {
  uri: string;
  created_at: string;
  like_count: number;
  downvote_count: number;
  reply_count: number;
  repost_count: number;
}

/** Sort posts by newest first. Uses WASM if available, JS fallback otherwise. */
export async function sortByNewest(posts: SortablePost[]): Promise<SortablePost[]> {
  const mod = await loadWasm();
  if (typeof mod.sort_by_newest === 'function') {
    const result = (mod.sort_by_newest as (json: string) => string)(JSON.stringify(posts));
    return JSON.parse(result);
  }
  // JS fallback
  return [...posts].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Sort posts by trending score (engagement / age). */
export async function sortByTrending(posts: SortablePost[]): Promise<SortablePost[]> {
  const mod = await loadWasm();
  const now = Date.now();
  if (typeof mod.sort_by_trending === 'function') {
    const result = (mod.sort_by_trending as (json: string, now: number) => string)(
      JSON.stringify(posts), now,
    );
    return JSON.parse(result);
  }
  // JS fallback: simple engagement / age
  return [...posts].sort((a, b) => {
    const scoreA = (a.like_count + a.repost_count) / Math.max(1, (now - new Date(a.created_at).getTime()) / 3600000);
    const scoreB = (b.like_count + b.repost_count) / Math.max(1, (now - new Date(b.created_at).getTime()) / 3600000);
    return scoreB - scoreA;
  });
}

/** Sort posts by Wilson score (statistically confident "best"). */
export async function sortByWilsonScore(posts: SortablePost[]): Promise<SortablePost[]> {
  const mod = await loadWasm();
  if (typeof mod.sort_by_wilson_score === 'function') {
    const result = (mod.sort_by_wilson_score as (json: string) => string)(JSON.stringify(posts));
    return JSON.parse(result);
  }
  // JS fallback
  return [...posts].sort((a, b) => {
    const scoreA = a.like_count - a.downvote_count;
    const scoreB = b.like_count - b.downvote_count;
    return scoreB - scoreA;
  });
}

/** Sort posts by net score (likes minus downvotes). Score = +1 per like, -1 per downvote. */
export async function sortByScore(posts: SortablePost[]): Promise<SortablePost[]> {
  const mod = await loadWasm();
  if (typeof mod.sort_by_score === 'function') {
    const result = (mod.sort_by_score as (json: string) => string)(JSON.stringify(posts));
    return JSON.parse(result);
  }
  // JS fallback
  return [...posts].sort((a, b) => {
    const scoreA = a.like_count - a.downvote_count;
    const scoreB = b.like_count - b.downvote_count;
    return scoreB - scoreA;
  });
}

/** Sort posts by controversial (close to 50/50 vote split). */
export async function sortByControversial(posts: SortablePost[]): Promise<SortablePost[]> {
  const mod = await loadWasm();
  if (typeof mod.sort_by_controversial === 'function') {
    const result = (mod.sort_by_controversial as (json: string) => string)(JSON.stringify(posts));
    return JSON.parse(result);
  }
  // JS fallback
  return [...posts].sort((a, b) => {
    const totalA = a.like_count + a.downvote_count;
    const totalB = b.like_count + b.downvote_count;
    const balanceA = totalA > 0 ? 1 - Math.abs(a.like_count / totalA - 0.5) * 2 : 0;
    const balanceB = totalB > 0 ? 1 - Math.abs(b.like_count / totalB - 0.5) * 2 : 0;
    return (totalB * balanceB) - (totalA * balanceA);
  });
}

// ── Feed Remixing ─────────────────────────────────────────────────────────

interface FeedItemForWasm {
  uri: string;
  created_at: string;
  source_index: number;
}

interface FeedMixConfigForWasm {
  percent: number;
  items: FeedItemForWasm[];
}

/** Remix multiple feeds by percentage weights. */
export async function remixFeeds(
  configs: FeedMixConfigForWasm[],
  limit: number,
): Promise<FeedItemForWasm[]> {
  const mod = await loadWasm();
  if (typeof mod.remix_feeds === 'function') {
    const result = (mod.remix_feeds as (json: string, limit: number) => string)(
      JSON.stringify(configs), limit,
    );
    return JSON.parse(result);
  }
  // JS fallback
  const totalPct = configs.reduce((s, c) => s + c.percent, 0);
  const combined: FeedItemForWasm[] = [];
  const seen = new Set<string>();
  for (const config of configs) {
    const take = Math.round((limit * config.percent) / totalPct);
    for (const item of config.items.slice(0, take)) {
      if (!seen.has(item.uri)) { seen.add(item.uri); combined.push(item); }
    }
  }
  return combined.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

// ── Consensus Analysis ────────────────────────────────────────────────────

/** Analyze Polis-like consensus from votes. */
export async function analyzeConsensus(
  votes: Array<{ user_id: string; statement_id: string; value: number }>,
): Promise<ConsensusResult> {
  const mod = await loadWasm();
  if (typeof mod.analyze_consensus === 'function') {
    const result = (mod.analyze_consensus as (json: string) => string)(JSON.stringify(votes));
    const raw = JSON.parse(result);
    // Map snake_case from Rust to camelCase for TypeScript
    return {
      statements: (raw.statements ?? []).map((s: Record<string, unknown>) => ({
        statementId: s.statement_id,
        agreeCount: s.agree_count,
        disagreeCount: s.disagree_count,
        passCount: s.pass_count,
        totalVoters: s.total_voters,
        agreementRatio: s.agreement_ratio,
        divisiveness: s.divisiveness,
      })),
      totalParticipants: raw.total_participants ?? 0,
      clusterCount: raw.cluster_count ?? 0,
      clusters: (raw.clusters ?? []).map((c: Record<string, unknown>) => ({
        id: c.id,
        memberCount: c.member_count,
        memberIds: c.member_ids,
        avgAgreement: c.avg_agreement,
      })),
    };
  }
  // JS fallback (simplified)
  return { statements: [], totalParticipants: 0, clusterCount: 0, clusters: [] };
}

// ── Masonry Layout ────────────────────────────────────────────────────────

interface PostLayoutInfo {
  uri: string;
  has_media: boolean;
  media_aspect_ratio: number | null;
  text_length: number;
  image_count: number;
}

interface ColumnAssignment {
  uri: string;
  column: number;
  estimated_height: number;
}

/** Distribute posts across masonry columns using WASM. */
export async function distributeMasonry(
  posts: PostLayoutInfo[],
  numColumns: number,
): Promise<ColumnAssignment[]> {
  const mod = await loadWasm();
  if (typeof mod.distribute_masonry === 'function') {
    const result = (mod.distribute_masonry as (json: string, cols: number) => string)(
      JSON.stringify(posts), numColumns,
    );
    return JSON.parse(result);
  }
  // JS fallback: round-robin assignment
  return posts.map((p, i) => ({
    uri: p.uri,
    column: i % numColumns,
    estimated_height: p.has_media ? 300 : 100,
  }));
}
