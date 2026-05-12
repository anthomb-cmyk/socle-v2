/**
 * scorer.ts — Shared hypothesis scoring logic for Pipeline A and Pipeline B.
 *
 * Extracts the tier/label assignment logic so both pipelines produce
 * consistent scores without duplicating rules.
 *
 * Tier matrix:
 *   A — 2+ independent sources AND ≥1 authoritative (req_phone, postalCorroborated=true, etc.)
 *   B — 1 authoritative source, no corroboration
 *   C — directory match only, no other corroboration (postalCorroborated may be false)
 *   D — connected: any row with isDirectorOf=true and no stronger evidence
 *   E — single weak source OR all rows older than 12 months (or no evidence)
 *
 * Independence rules (see source-independence.json):
 *   - Sources in the same sibling_group collapse to a single logical source.
 *   - Two sources are independent if they appear together in independent_pairs (symmetric).
 *   - For pairs not listed: treat as independent unless they are the same source string
 *     or share a sibling group.
 */

import independenceData from "./source-independence.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScoreInput = {
  evidenceRows: Array<{
    source: string;
    sourceUrl?: string | null;
    isAuthoritative?: boolean;
    postalCorroborated?: boolean;
    isDirectorOf?: boolean;
    fetchedAt?: string; // ISO date string
  }>;
  ownerType: "individual" | "numbered_co" | "named_co" | "trust" | "government";
  pipeline: "A" | "B";
};

export type ScoreResult = {
  tier: "A" | "B" | "C" | "D" | "E";
  label: "confirmed" | "likely" | "connected" | "weak";
  isDirect: boolean;
  statusReason: string;
};

// ---------------------------------------------------------------------------
// Sibling group helpers
// ---------------------------------------------------------------------------

const siblingGroups: string[][] = independenceData.sibling_groups;

/**
 * Return the sibling-group key for a hostname (or the hostname itself if not
 * in any sibling group). Used to collapse sibling sources into one.
 */
function siblingKey(hostname: string): string {
  for (const group of siblingGroups) {
    if (group.includes(hostname)) {
      // Normalise to the first member of the group
      return group[0];
    }
  }
  return hostname;
}

/**
 * Extract the hostname from a URL string (best-effort; returns "" on failure).
 */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Independence helpers
// ---------------------------------------------------------------------------

const independentPairs: Array<[string, string]> = independenceData.independent_pairs as Array<
  [string, string]
>;

/**
 * Return true if the given hostname appears in any sibling group.
 */
function isInSiblingGroup(hostname: string): boolean {
  return siblingGroups.some((group) => group.includes(hostname));
}

/**
 * Build a Set<string> of canonical "source keys" from a list of evidence rows,
 * collapsing rows whose sourceUrl hostname is in the same sibling group.
 *
 * The canonical key is:
 *   - siblingKey(hostname) when sourceUrl is present and its hostname is in a
 *     sibling group (both the canonical member and its siblings map to the same key)
 *   - Otherwise the source string itself (e.g. "req_phone", "twilio_caller_name")
 */
function canonicalSourceKey(row: ScoreInput["evidenceRows"][number]): string {
  if (row.sourceUrl) {
    const hostname = extractHostname(row.sourceUrl);
    if (hostname && isInSiblingGroup(hostname)) {
      // Return the sibling-group representative (always the first member)
      return siblingKey(hostname);
    }
  }
  return row.source;
}

/**
 * True if source A and source B are independent according to the rules.
 *
 * Independence check (in order):
 * 1. Same canonical key → NOT independent.
 * 2. Pair is in independent_pairs (symmetric) → independent.
 * 3. Both keys are hostname-based and map to the same sibling group → NOT independent.
 * 4. Otherwise → independent (open world).
 */
function areIndependent(a: string, b: string): boolean {
  if (a === b) return false;

  // Check independent_pairs (symmetric)
  for (const [p1, p2] of independentPairs) {
    if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) {
      return true;
    }
  }

  // If both are sibling-group representatives, they are the same group → not independent.
  // (This case is handled by the `a === b` check above, since both collapse to the same key.)

  // Default: treat as independent
  return true;
}

// ---------------------------------------------------------------------------
// countIndependentSources
// ---------------------------------------------------------------------------

/**
 * Count the number of logically independent sources represented in the evidence
 * rows, using the independence rules from source-independence.json.
 *
 * Algorithm:
 *   1. Compute canonical source key for each row (sibling-collapse).
 *   2. Deduplicate by canonical key.
 *   3. Build a graph where each pair of distinct canonical sources has an edge
 *      if they are independent.
 *   4. Count the size of the maximum independent set — but for our use-case,
 *      we simply count how many *distinct* canonical sources there are, because
 *      two sources are independent unless they fail one of the override rules.
 *      (The independence check is between pairs; for 3+ sources we count all
 *      distinct sources that have at least one independent peer.)
 *
 * Practical simplification: return the number of distinct canonical source keys
 * that are mutually or pairwise independent from at least one other. If only 1
 * distinct source, return 1. For multi-source scenarios, count all distinct
 * sources where no pair is "not independent".
 *
 * Simpler still (matching spec intent): count distinct canonical keys. Two
 * identical-key rows collapse to 1.  Then verify that at least one pair among
 * those keys qualifies as independent; if none do (e.g. all are the same source
 * repeated), the independent count is still 1.
 *
 * For the scoring rules, "2+ independent sources" means the independent count ≥ 2.
 */
export function countIndependentSources(rows: ScoreInput["evidenceRows"]): number {
  if (rows.length === 0) return 0;

  // Step 1 & 2: collapse to distinct canonical keys
  const keySet = new Set<string>();
  for (const row of rows) {
    keySet.add(canonicalSourceKey(row));
  }
  const keys = [...keySet];

  if (keys.length === 1) return 1;

  // Step 3: check if there is at least one independent pair among the keys.
  // We want to count "logically independent" sources: sources are independent
  // unless they are the same canonical key or in the same sibling group.
  // We use a greedy approach: start with an empty set of "counted" sources,
  // add each key if it is independent from at least one already counted, OR if
  // it is the first one.
  const counted: string[] = [keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    // A source contributes if it is independent from at least one already-counted source
    const hasIndependentPeer = counted.some((c) => areIndependent(c, key));
    if (hasIndependentPeer) {
      counted.push(key);
    }
  }

  return counted.length;
}

// ---------------------------------------------------------------------------
// Tier and label helpers
// ---------------------------------------------------------------------------

function tierToLabel(
  tier: "A" | "B" | "C" | "D" | "E",
): "confirmed" | "likely" | "connected" | "weak" {
  switch (tier) {
    case "A":
      return "confirmed";
    case "B":
      return "likely";
    case "C":
    case "D":
      return "connected";
    default:
      return "weak";
  }
}

// ---------------------------------------------------------------------------
// scoreHypothesis
// ---------------------------------------------------------------------------

/**
 * Compute the tier, label, isDirect, and statusReason for a hypothesis given
 * a set of evidence rows.
 *
 * Pipeline-specific notes:
 *   - Both pipelines use the same tier→label mapping.
 *   - Pipeline B allows tier D (connected via director listing).
 *   - Pipeline A does not emit tier D in normal operation (no director lookups),
 *     but the scorer handles it uniformly.
 */
export function scoreHypothesis(input: ScoreInput): ScoreResult {
  const { evidenceRows, pipeline } = input;

  // --- Edge case: no evidence ---
  if (evidenceRows.length === 0) {
    return {
      tier: "E",
      label: "weak",
      isDirect: false,
      statusReason: "no evidence",
    };
  }

  // --- Check if all evidence is older than 12 months ---
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const rowsWithDates = evidenceRows.filter((r) => r.fetchedAt != null);
  const allStale =
    rowsWithDates.length > 0 &&
    rowsWithDates.length === evidenceRows.length &&
    rowsWithDates.every((r) => new Date(r.fetchedAt!) < twelveMonthsAgo);

  if (allStale) {
    return {
      tier: "E",
      label: "weak",
      isDirect: true,
      statusReason: "all evidence older than 12 months",
    };
  }

  // --- Aggregate flags ---
  const hasDirectorOf = evidenceRows.some((r) => r.isDirectorOf === true);
  const hasAuthoritative = evidenceRows.some((r) => r.isAuthoritative === true);
  const hasPostalCorroborated = evidenceRows.some((r) => r.postalCorroborated === true);
  const hasDirectoryMatch = evidenceRows.some(
    (r) =>
      r.source === "name_postal_directory" ||
      r.source === "pages_jaunes_business" ||
      r.source === "req_address_lookup" ||
      r.source === "pages_jaunes_personal" ||
      r.source === "canada411_personal" ||
      r.source === "reverse_address",
  );

  const independentCount = countIndependentSources(evidenceRows);

  // Collect source names for human-readable reason
  const sourceNames = [...new Set(evidenceRows.map((r) => r.source))];
  const sourceSummary = sourceNames.join(" + ");

  // --- Tier D: connected via director listing ---
  // Only applies when there is no stronger evidence.
  // We check for D after A/B/C so stronger tiers win.

  // --- Tier A: 2+ independent sources AND ≥1 authoritative ---
  if (independentCount >= 2 && hasAuthoritative) {
    const tier = "A";
    return {
      tier,
      label: tierToLabel(tier),
      isDirect: true,
      statusReason: `${independentCount} independent sources (${sourceSummary})`,
    };
  }

  // --- Tier B: 1 authoritative source, no independent corroboration ---
  if (hasAuthoritative) {
    const tier = "B";
    const authSources = evidenceRows
      .filter((r) => r.isAuthoritative)
      .map((r) => r.source)
      .join(", ");
    return {
      tier,
      label: tierToLabel(tier),
      isDirect: true,
      statusReason: `single authoritative source (${authSources})`,
    };
  }

  // Pipeline B: Tier A can also come from 2+ independent sources with postal corroboration
  // (even without an "authoritative" flag)
  if (pipeline === "B" && independentCount >= 2 && hasPostalCorroborated) {
    const tier = "A";
    return {
      tier,
      label: tierToLabel(tier),
      isDirect: true,
      statusReason: `${independentCount} independent sources with postal corroboration (${sourceSummary})`,
    };
  }

  // Pipeline B: Tier B can also come from 2+ independent sources with a directory match
  // but no postal corroboration. This is the pipeline B "2+ sources + directoryMatch" rule.
  if (pipeline === "B" && independentCount >= 2 && hasDirectoryMatch && !hasPostalCorroborated) {
    const tier = "B";
    return {
      tier,
      label: tierToLabel(tier),
      isDirect: true,
      statusReason: `${independentCount} independent sources with directory match (${sourceSummary})`,
    };
  }

  // --- Tier C: directory match only, no postal corroboration ---
  if (hasDirectoryMatch && !hasPostalCorroborated) {
    const tier = "C";
    return {
      tier,
      label: tierToLabel(tier),
      isDirect: true,
      statusReason: "single directory match without postal corroboration",
    };
  }

  // --- Tier D: connected via director listing ---
  if (hasDirectorOf) {
    const tier = "D";
    return {
      tier,
      label: tierToLabel(tier),
      isDirect: false,
      statusReason: "connected via director listing",
    };
  }

  // --- Tier E: single weak source ---
  const tier = "E";
  return {
    tier,
    label: tierToLabel(tier),
    isDirect: true,
    statusReason: `single weak source (${sourceSummary})`,
  };
}
