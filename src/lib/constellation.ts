/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Microcosm Constellation API
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Constellation is a backlink index for AT Protocol.
 * It indexes records from the firehose so we can query:
 *  - How many people downvoted a post
 *  - Cross-references between feeds and forums
 *  - Analytics on voting patterns
 *
 * @see https://www.microcosm.blue/
 * @see https://constellation.microcosm.blue/
 *
 * HOW TO EDIT:
 *  - To add a new collection type, add a new function following the pattern
 *  - The CONSTELLATION_BASE URL points to the public API
 *  - New downvotes may take a few seconds to appear (firehose indexing delay)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';

/** Collection name for ArtSky/PurpleSky downvotes. */
const DOWNVOTE_COLLECTION = 'app.artsky.feed.downvote';
const DOWNVOTE_PATH = '.subject.uri';

/** Collection name for upvotes (Microcosm constellation references). */
const UPVOTE_COLLECTION = 'app.artsky.graph.upVote';
const UPVOTE_PATH = '.subject.uri';

/**
 * Get the number of distinct users who have downvoted a post.
 * Uses Constellation's distinct-dids endpoint for accurate counts.
 */
export async function getDownvoteCount(postUri: string): Promise<number> {
  const params = new URLSearchParams({
    target: postUri,
    collection: DOWNVOTE_COLLECTION,
    path: DOWNVOTE_PATH,
  });
  try {
    const res = await fetch(
      `${CONSTELLATION_BASE}/links/count/distinct-dids?${params}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { total?: number };
    return typeof data.total === 'number' ? data.total : 0;
  } catch {
    return 0;
  }
}

/**
 * Get downvote counts for multiple posts in parallel.
 * Returns a map: post URI -> downvote count.
 */
export async function getDownvoteCounts(
  postUris: string[],
): Promise<Record<string, number>> {
  const unique = [...new Set(postUris)];
  const results = await Promise.all(
    unique.map(async (uri) => ({ uri, count: await getDownvoteCount(uri) })),
  );
  const out: Record<string, number> = {};
  for (const { uri, count } of results) out[uri] = count;
  return out;
}

/**
 * Get upvote count from Microcosm constellation.
 * Upvotes are referenced as app.artsky.graph.upVote on app.bsky.feed.post.
 */
export async function getUpvoteCount(postUri: string): Promise<number> {
  const params = new URLSearchParams({
    target: postUri,
    collection: UPVOTE_COLLECTION,
    path: UPVOTE_PATH,
  });
  try {
    const res = await fetch(
      `${CONSTELLATION_BASE}/links/count/distinct-dids?${params}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { total?: number };
    return typeof data.total === 'number' ? data.total : 0;
  } catch {
    return 0;
  }
}

/**
 * Get both upvote and downvote counts for a post.
 * Returns { upvotes, downvotes, netScore }.
 */
export async function getVoteCounts(
  postUri: string,
): Promise<{ upvotes: number; downvotes: number; netScore: number }> {
  const [upvotes, downvotes] = await Promise.all([
    getUpvoteCount(postUri),
    getDownvoteCount(postUri),
  ]);
  return { upvotes, downvotes, netScore: upvotes - downvotes };
}

/**
 * Query cross-references between records (for graph visualizations).
 * Returns list of referencing record URIs.
 */
export async function getReferences(
  targetUri: string,
  collection: string,
  path: string,
): Promise<string[]> {
  const params = new URLSearchParams({ target: targetUri, collection, path });
  try {
    const res = await fetch(
      `${CONSTELLATION_BASE}/links?${params}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { links?: Array<{ uri: string }> };
    return (data.links ?? []).map((l) => l.uri);
  } catch {
    return [];
  }
}
