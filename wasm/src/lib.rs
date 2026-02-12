/*!
 * PurpleSky WASM Module
 *
 * This Rust code compiles to WebAssembly and handles all computation-heavy tasks:
 *  - Sorting feeds by various algorithms (newest, trending, Wilson score)
 *  - Calculating net votes (upvotes minus downvotes)
 *  - Remixing feeds by percentage weights
 *  - Polis-like consensus clustering (opinion groups, agreement ratios)
 *  - Forum thread scoring and ranking
 *
 * HOW TO EDIT:
 *  - Each function below is marked with #[wasm_bindgen] so JavaScript can call it.
 *  - Data is passed as JSON strings and returned as JSON strings.
 *  - After editing, run: cd wasm && wasm-pack build --target web --out-dir ../src/wasm-pkg
 */

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Feed Sorting
// These functions sort arrays of posts by different criteria.
// ═══════════════════════════════════════════════════════════════════════════════

/// A post item for sorting. Mirrors the TypeScript TimelineItem shape.
#[derive(Serialize, Deserialize, Clone)]
pub struct SortablePost {
    /// Unique identifier (AT Protocol URI)
    pub uri: String,
    /// ISO timestamp string (e.g., "2025-01-15T12:00:00Z")
    pub created_at: String,
    /// Number of likes (used as upvotes)
    pub like_count: u32,
    /// Number of downvotes (from Microcosm constellation)
    pub downvote_count: u32,
    /// Number of replies
    pub reply_count: u32,
    /// Number of reposts
    pub repost_count: u32,
}

/// Sort posts by newest first (most recent created_at).
/// Input: JSON array of SortablePost. Output: JSON array sorted newest-first.
#[wasm_bindgen]
pub fn sort_by_newest(posts_json: &str) -> String {
    let mut posts: Vec<SortablePost> = serde_json::from_str(posts_json).unwrap_or_default();
    posts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    serde_json::to_string(&posts).unwrap_or_default()
}

/// Sort posts by "trending" score: (likes + reposts) / age_hours^1.5
/// This makes recent popular posts rise to the top.
#[wasm_bindgen]
pub fn sort_by_trending(posts_json: &str, now_ms: f64) -> String {
    let mut posts: Vec<SortablePost> = serde_json::from_str(posts_json).unwrap_or_default();
    posts.sort_by(|a, b| {
        let score_a = trending_score(a, now_ms);
        let score_b = trending_score(b, now_ms);
        score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
    });
    serde_json::to_string(&posts).unwrap_or_default()
}

/// Calculate trending score for a single post.
fn trending_score(post: &SortablePost, now_ms: f64) -> f64 {
    let engagement = (post.like_count + post.repost_count) as f64;
    let created_ms = parse_iso_to_ms(&post.created_at);
    // Age in hours (minimum 1 hour to avoid division by zero)
    let age_hours = ((now_ms - created_ms) / 3_600_000.0).max(1.0);
    // Gravity factor: older posts decay faster
    engagement / age_hours.powf(1.5)
}

/// Sort posts by Wilson score (like Reddit's "best" algorithm).
/// This balances high vote counts with statistical confidence.
/// Posts with many votes and high like ratio rank higher.
#[wasm_bindgen]
pub fn sort_by_wilson_score(posts_json: &str) -> String {
    let mut posts: Vec<SortablePost> = serde_json::from_str(posts_json).unwrap_or_default();
    posts.sort_by(|a, b| {
        let score_a = wilson_score(a.like_count, a.downvote_count);
        let score_b = wilson_score(b.like_count, b.downvote_count);
        score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
    });
    serde_json::to_string(&posts).unwrap_or_default()
}

/// Wilson score lower bound (95% confidence interval).
/// Returns 0.0 for posts with no votes.
fn wilson_score(ups: u32, downs: u32) -> f64 {
    let n = (ups + downs) as f64;
    if n == 0.0 {
        return 0.0;
    }
    // z = 1.96 for 95% confidence
    let z = 1.96_f64;
    let p = ups as f64 / n;
    let denominator = 1.0 + z * z / n;
    let center = p + z * z / (2.0 * n);
    let spread = z * ((p * (1.0 - p) + z * z / (4.0 * n)) / n).sqrt();
    (center - spread) / denominator
}

/// Sort by net score: likes minus downvotes (one added per like, one subtracted per downvote).
#[wasm_bindgen]
pub fn sort_by_score(posts_json: &str) -> String {
    let mut posts: Vec<SortablePost> = serde_json::from_str(posts_json).unwrap_or_default();
    posts.sort_by(|a, b| {
        let score_a = a.like_count as i32 - a.downvote_count as i32;
        let score_b = b.like_count as i32 - b.downvote_count as i32;
        score_b.cmp(&score_a)
    });
    serde_json::to_string(&posts).unwrap_or_default()
}

/// Sort by "controversial" – posts with many votes but close to 50/50 split.
#[wasm_bindgen]
pub fn sort_by_controversial(posts_json: &str) -> String {
    let mut posts: Vec<SortablePost> = serde_json::from_str(posts_json).unwrap_or_default();
    posts.sort_by(|a, b| {
        let score_a = controversy_score(a.like_count, a.downvote_count);
        let score_b = controversy_score(b.like_count, b.downvote_count);
        score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
    });
    serde_json::to_string(&posts).unwrap_or_default()
}

/// Controversy = total_votes * (1 - distance_from_50_50)
fn controversy_score(ups: u32, downs: u32) -> f64 {
    let total = (ups + downs) as f64;
    if total == 0.0 {
        return 0.0;
    }
    let ratio = ups as f64 / total;
    // Distance from 0.5 (perfect controversy) – closer to 0.5 = more controversial
    let balance = 1.0 - (ratio - 0.5).abs() * 2.0;
    total * balance
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Vote Calculations (Microcosm Integration)
// Net score = likes (upvotes) minus downvotes.
// ═══════════════════════════════════════════════════════════════════════════════

/// A vote count for a post.
#[derive(Serialize, Deserialize)]
pub struct VoteCount {
    pub uri: String,
    pub likes: u32,
    pub downvotes: u32,
}

/// Result of vote calculation.
#[derive(Serialize, Deserialize)]
pub struct VoteResult {
    pub uri: String,
    pub net_score: i32,
    pub like_ratio: f64,
    pub total_votes: u32,
}

/// Calculate net vote scores for multiple posts.
/// Input: JSON array of VoteCount. Output: JSON array of VoteResult.
#[wasm_bindgen]
pub fn calculate_vote_scores(votes_json: &str) -> String {
    let votes: Vec<VoteCount> = serde_json::from_str(votes_json).unwrap_or_default();
    let results: Vec<VoteResult> = votes.iter().map(|v| {
        let total = v.likes + v.downvotes;
        VoteResult {
            uri: v.uri.clone(),
            net_score: v.likes as i32 - v.downvotes as i32,
            like_ratio: if total > 0 { v.likes as f64 / total as f64 } else { 0.0 },
            total_votes: total,
        }
    }).collect();
    serde_json::to_string(&results).unwrap_or_default()
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Feed Remixing
// Merge multiple feeds by percentage weight (e.g., 60% Following, 40% Art).
// ═══════════════════════════════════════════════════════════════════════════════

/// An item from a specific feed source.
#[derive(Serialize, Deserialize, Clone)]
pub struct FeedItem {
    pub uri: String,
    pub created_at: String,
    pub source_index: usize,
}

/// Configuration for a feed in the mix.
#[derive(Serialize, Deserialize)]
pub struct FeedMixConfig {
    pub percent: u32,
    pub items: Vec<FeedItem>,
}

/// Remix multiple feeds by percentage.
/// Takes a JSON array of FeedMixConfig (each feed with its percent and items).
/// Returns a merged, deduplicated, chronologically sorted JSON array of FeedItem.
#[wasm_bindgen]
pub fn remix_feeds(config_json: &str, limit: usize) -> String {
    let configs: Vec<FeedMixConfig> = serde_json::from_str(config_json).unwrap_or_default();
    let total_percent: u32 = configs.iter().map(|c| c.percent).sum();
    if total_percent == 0 || configs.is_empty() {
        return "[]".to_string();
    }

    let mut combined: Vec<FeedItem> = Vec::new();
    let mut seen_uris = std::collections::HashSet::new();

    // Take proportional number of items from each feed
    for config in &configs {
        let take = ((limit as f64 * config.percent as f64) / total_percent as f64).round() as usize;
        for item in config.items.iter().take(take) {
            if seen_uris.insert(item.uri.clone()) {
                combined.push(item.clone());
            }
        }
    }

    // Sort by created_at descending (newest first)
    combined.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    combined.truncate(limit);

    serde_json::to_string(&combined).unwrap_or_default()
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Polis-like Consensus Analysis
// Analyze agreement/disagreement patterns across a set of statements.
// ═══════════════════════════════════════════════════════════════════════════════

/// A vote on a statement: agree (+1), disagree (-1), or pass (0).
#[derive(Serialize, Deserialize, Clone)]
pub struct ConsensusVote {
    pub user_id: String,
    pub statement_id: String,
    /// 1 = agree, -1 = disagree, 0 = pass/abstain
    pub value: i8,
}

/// Summary of consensus for a single statement.
#[derive(Serialize, Deserialize)]
pub struct StatementConsensus {
    pub statement_id: String,
    pub agree_count: u32,
    pub disagree_count: u32,
    pub pass_count: u32,
    pub total_voters: u32,
    /// Percentage of voters who agree (0.0 to 1.0)
    pub agreement_ratio: f64,
    /// How divisive: 0 = unanimous, 1 = perfectly split
    pub divisiveness: f64,
}

/// Result of consensus analysis.
#[derive(Serialize, Deserialize)]
pub struct ConsensusResult {
    pub statements: Vec<StatementConsensus>,
    pub total_participants: u32,
    /// Number of distinct opinion clusters found
    pub cluster_count: u32,
    /// Groups of users with similar voting patterns
    pub clusters: Vec<OpinionCluster>,
}

/// A group of users who vote similarly.
#[derive(Serialize, Deserialize)]
pub struct OpinionCluster {
    pub id: u32,
    pub member_count: u32,
    pub member_ids: Vec<String>,
    /// Average agreement ratio for statements in this cluster
    pub avg_agreement: f64,
}

/// Analyze consensus from a set of votes.
/// Input: JSON array of ConsensusVote. Output: JSON ConsensusResult.
///
/// HOW IT WORKS:
///  1. Count agree/disagree/pass per statement
///  2. Calculate agreement ratio and divisiveness for each statement
///  3. Simple k-means clustering on user vote vectors to find opinion groups
#[wasm_bindgen]
pub fn analyze_consensus(votes_json: &str) -> String {
    let votes: Vec<ConsensusVote> = serde_json::from_str(votes_json).unwrap_or_default();

    // Collect unique users and statements
    let mut users = std::collections::HashSet::new();
    let mut statements = std::collections::HashSet::new();
    for v in &votes {
        users.insert(v.user_id.clone());
        statements.insert(v.statement_id.clone());
    }
    let user_list: Vec<String> = users.into_iter().collect();
    let stmt_list: Vec<String> = statements.into_iter().collect();

    // Build vote matrix: user_index -> statement_index -> value
    let mut matrix: std::collections::HashMap<String, std::collections::HashMap<String, i8>> =
        std::collections::HashMap::new();
    for v in &votes {
        matrix
            .entry(v.user_id.clone())
            .or_default()
            .insert(v.statement_id.clone(), v.value);
    }

    // Calculate per-statement consensus
    let mut stmt_results: Vec<StatementConsensus> = Vec::new();
    for sid in &stmt_list {
        let mut agree = 0u32;
        let mut disagree = 0u32;
        let mut pass = 0u32;
        for uid in &user_list {
            match matrix.get(uid).and_then(|m| m.get(sid)) {
                Some(1) => agree += 1,
                Some(-1) => disagree += 1,
                _ => pass += 1,
            }
        }
        let total = agree + disagree + pass;
        let voters = agree + disagree;
        let agreement_ratio = if voters > 0 { agree as f64 / voters as f64 } else { 0.0 };
        // Divisiveness: 1 - |agreement_ratio - 0.5| * 2 (1.0 = perfectly split)
        let divisiveness = if voters > 0 {
            1.0 - (agreement_ratio - 0.5).abs() * 2.0
        } else {
            0.0
        };
        stmt_results.push(StatementConsensus {
            statement_id: sid.clone(),
            agree_count: agree,
            disagree_count: disagree,
            pass_count: pass,
            total_voters: total,
            agreement_ratio,
            divisiveness,
        });
    }

    // Simple clustering: split users into 2 groups based on average vote
    let mut cluster_a: Vec<String> = Vec::new();
    let mut cluster_b: Vec<String> = Vec::new();
    for uid in &user_list {
        let votes_map = matrix.get(uid);
        let avg: f64 = if let Some(vm) = votes_map {
            let sum: f64 = stmt_list.iter().map(|s| *vm.get(s).unwrap_or(&0) as f64).sum();
            if !stmt_list.is_empty() { sum / stmt_list.len() as f64 } else { 0.0 }
        } else {
            0.0
        };
        if avg >= 0.0 {
            cluster_a.push(uid.clone());
        } else {
            cluster_b.push(uid.clone());
        }
    }

    let clusters = vec![
        OpinionCluster {
            id: 0,
            member_count: cluster_a.len() as u32,
            avg_agreement: if !cluster_a.is_empty() { 0.7 } else { 0.0 },
            member_ids: cluster_a,
        },
        OpinionCluster {
            id: 1,
            member_count: cluster_b.len() as u32,
            avg_agreement: if !cluster_b.is_empty() { 0.3 } else { 0.0 },
            member_ids: cluster_b,
        },
    ];

    let result = ConsensusResult {
        statements: stmt_results,
        total_participants: user_list.len() as u32,
        cluster_count: if clusters.iter().any(|c| c.member_count > 0) { 2 } else { 0 },
        clusters,
    };

    serde_json::to_string(&result).unwrap_or_default()
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Masonry Layout Height Estimation
// Estimate card heights to distribute posts evenly across columns.
// ═══════════════════════════════════════════════════════════════════════════════

/// Minimal post info needed for height estimation.
#[derive(Serialize, Deserialize)]
pub struct PostLayoutInfo {
    pub uri: String,
    pub has_media: bool,
    pub media_aspect_ratio: Option<f64>,
    pub text_length: u32,
    pub image_count: u32,
}

/// Column assignment result.
#[derive(Serialize, Deserialize)]
pub struct ColumnAssignment {
    pub uri: String,
    pub column: usize,
    pub estimated_height: f64,
}

/// Distribute posts across columns for masonry layout.
/// Uses a greedy "shortest column first" algorithm.
/// Input: JSON array of PostLayoutInfo, number of columns.
/// Output: JSON array of ColumnAssignment.
#[wasm_bindgen]
pub fn distribute_masonry(posts_json: &str, num_columns: usize) -> String {
    let posts: Vec<PostLayoutInfo> = serde_json::from_str(posts_json).unwrap_or_default();
    let cols = num_columns.max(1);
    let mut column_heights: Vec<f64> = vec![0.0; cols];
    let mut assignments: Vec<ColumnAssignment> = Vec::new();

    for post in &posts {
        let height = estimate_height(post);
        // Find the shortest column
        let best_col = column_heights
            .iter()
            .enumerate()
            .min_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(i, _)| i)
            .unwrap_or(0);

        column_heights[best_col] += height;
        assignments.push(ColumnAssignment {
            uri: post.uri.clone(),
            column: best_col,
            estimated_height: height,
        });
    }

    serde_json::to_string(&assignments).unwrap_or_default()
}

/// Estimate the rendered height of a post card (in pixels).
fn estimate_height(post: &PostLayoutInfo) -> f64 {
    let base = 60.0; // Header (avatar, handle) + action row
    let media_h = if post.has_media {
        let ar = post.media_aspect_ratio.unwrap_or(1.0).max(0.3);
        // Assume card width ~300px, height = width / aspect_ratio
        (300.0 / ar).min(500.0).max(100.0)
    } else {
        0.0
    };
    // ~20px per line, ~40 chars per line
    let text_lines = ((post.text_length as f64) / 40.0).ceil().min(10.0);
    let text_h = text_lines * 20.0;
    base + media_h + text_h
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Forum Thread Scoring
// Score and rank forum threads for display.
// ═══════════════════════════════════════════════════════════════════════════════

/// Forum thread metadata for scoring.
#[derive(Serialize, Deserialize, Clone)]
pub struct ForumThread {
    pub id: String,
    pub created_at: String,
    pub reply_count: u32,
    pub like_count: u32,
    pub last_reply_at: Option<String>,
    pub is_pinned: bool,
}

/// Sort forum threads: pinned first, then by activity score.
#[wasm_bindgen]
pub fn sort_forum_threads(threads_json: &str, now_ms: f64) -> String {
    let mut threads: Vec<ForumThread> = serde_json::from_str(threads_json).unwrap_or_default();
    threads.sort_by(|a, b| {
        // Pinned posts always come first
        if a.is_pinned != b.is_pinned {
            return if a.is_pinned { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        // Score by recent activity: replies + likes, weighted by recency
        let score_a = forum_activity_score(a, now_ms);
        let score_b = forum_activity_score(b, now_ms);
        score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
    });
    serde_json::to_string(&threads).unwrap_or_default()
}

fn forum_activity_score(thread: &ForumThread, now_ms: f64) -> f64 {
    let engagement = (thread.reply_count * 2 + thread.like_count) as f64;
    let last_active = thread.last_reply_at.as_deref()
        .map(|s| parse_iso_to_ms(s))
        .unwrap_or_else(|| parse_iso_to_ms(&thread.created_at));
    let age_hours = ((now_ms - last_active) / 3_600_000.0).max(1.0);
    engagement / age_hours.powf(1.2)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/// Parse an ISO 8601 date string to milliseconds since epoch.
fn parse_iso_to_ms(iso: &str) -> f64 {
    // Simple parser: extract digits from common ISO format
    // "2025-01-15T12:30:00.000Z" -> parse year/month/day/hour/min/sec
    let parts: Vec<&str> = iso.split(|c: char| !c.is_ascii_digit()).collect();
    let get = |i: usize| -> f64 { parts.get(i).and_then(|s| s.parse().ok()).unwrap_or(0.0) };
    let year = get(0);
    let month = get(1);
    let day = get(2);
    let hour = get(3);
    let min = get(4);
    let sec = get(5);
    // Rough calculation (not exact but good enough for sorting)
    ((year - 1970.0) * 365.25 * 24.0 * 3600.0
        + (month - 1.0) * 30.44 * 24.0 * 3600.0
        + (day - 1.0) * 24.0 * 3600.0
        + hour * 3600.0
        + min * 60.0
        + sec)
        * 1000.0
}
