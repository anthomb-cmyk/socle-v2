"use client";
// Phase 5 orchestrator. The state shape, the bucket logic, the
// BULK_CONCURRENCY constant, and the action handlers (handleAction,
// runBulkAction) are byte-identical to the previous orchestrator. The
// only new piece of state is `selectedId`, explicitly carved out by the
// Phase 5 directive: it tracks which candidate is shown in the right
// rail (desktop) or the slide-over (mobile). Cosmetic only — does not
// interact with the action lifecycle.

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import PhoneReviewBucketBar, { type Bucket } from "./components/PhoneReviewBucketBar";
import PhoneReviewCandidateList from "./components/PhoneReviewCandidateList";
import PhoneReviewEvidencePanel from "./components/PhoneReviewEvidencePanel";
import PhoneReviewBulkBar from "./components/PhoneReviewBulkBar";
import PhoneReviewMobileSlideover from "./components/PhoneReviewMobileSlideover";

type Campaign = { name: string } | null;
type Property = { address: string; city: string | null; num_units: number | null } | null;
type Contact = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_postal: string | null;
} | null;
type Lead = {
  id: string;
  status: string;
  campaign_id: string | null;
  campaigns: Campaign;
  properties: Property;
  contacts: Contact;
} | null;

export type PhoneCandidate = {
  id: string;
  lead_id: string;
  phone_raw: string;
  phone_e164: string | null;
  stage: string;
  matched_on: string | null;
  search_query: string | null;
  candidate_name: string | null;
  candidate_address: string | null;
  source_label: string | null;
  source_url: string | null;
  snippet: string | null;
  initial_confidence: number;
  openclaw_verdict: string | null;
  openclaw_confidence: number | null;
  openclaw_evidence: string | null;
  openclaw_reasoning: string | null;
  candidate_status: string;
  review_reason: string | null;
  created_at: string;
  leads: Lead;
};

// ── Confidence bucket helper ──────────────────────────────────────────────
type ConfidenceBucket = Bucket;

function matchBucket(conf: number, b: ConfidenceBucket): boolean {
  if (b === "all") return true;
  if (b === "ge80") return conf >= 80;
  if (b === "70-79") return conf >= 70 && conf <= 79;
  if (b === "60-69") return conf >= 60 && conf <= 69;
  if (b === "50-59") return conf >= 50 && conf <= 59;
  if (b === "lt50") return conf < 50;
  return true;
}

const BUCKETS: ConfidenceBucket[] = ["all", "ge80", "70-79", "60-69", "50-59", "lt50"];
const BULK_CONCURRENCY = 10;

export default function PhoneReviewClient({
  initialCandidates,
}: {
  initialCandidates: PhoneCandidate[];
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [candidates, setCandidates] = useState(initialCandidates);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeBucket, setActiveBucket] = useState<ConfidenceBucket>("all");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [expandedSnippets, setExpandedSnippets] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  // Fetch AI summaries for all candidates on mount
  useEffect(() => {
    if (initialCandidates.length === 0) return;
    const payload = initialCandidates.map((c) => ({
      id: c.id,
      ownerName: c.leads?.contacts?.full_name ?? c.leads?.contacts?.company_name ?? "—",
      address: [c.leads?.properties?.address, c.leads?.properties?.city].filter(Boolean).join(", "),
      phone: c.phone_e164 ?? c.phone_raw,
      candidateName: c.candidate_name,
      candidateAddress: c.candidate_address,
      sourceUrl: c.source_url,
      snippet: c.snippet,
      reviewReason: c.review_reason,
      openclawEvidence: c.openclaw_evidence,
      openclawVerdict: c.openclaw_verdict,
      confidence: c.initial_confidence,
    }));
    fetch("/api/phone-review/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: payload }),
    })
      .then((r) => r.json())
      .then((data: { summaries: Record<string, string> }) => setSummaries(data.summaries ?? {}))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refs so keyboard handler always sees latest state without re-registering
  const filteredRef = useRef<typeof filtered>([]);
  const selectedIdRef = useRef<string | null>(null);
  const handleQuickActionRef = useRef<(id: string, action: "approve" | "reject") => Promise<void>>(
    async () => {}
  );

  const toggleSnippet = useCallback((id: string) => {
    setExpandedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const filtered = useMemo(
    () => candidates.filter((c) => matchBucket(c.initial_confidence, activeBucket)),
    [candidates, activeBucket],
  );

  const bucketCounts = useMemo<Record<ConfidenceBucket, number>>(() => {
    const counts: Record<ConfidenceBucket, number> = { all: candidates.length, ge80: 0, "70-79": 0, "60-69": 0, "50-59": 0, lt50: 0 };
    for (const c of candidates) {
      if (c.initial_confidence >= 80) counts.ge80++;
      else if (c.initial_confidence >= 70) counts["70-79"]++;
      else if (c.initial_confidence >= 60) counts["60-69"]++;
      else if (c.initial_confidence >= 50) counts["50-59"]++;
      else counts.lt50++;
    }
    return counts;
  }, [candidates]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); filtered.forEach((c) => next.delete(c.id)); return next; });
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); filtered.forEach((c) => next.add(c.id)); return next; });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Action handlers ──────────────────────────────────────────────────────
  // Bodies preserved byte-identical from the previous orchestrator.

  async function handleAction(
    id: string,
    action: "approve" | "reject" | "retry" | "keep_unresolved",
    note?: string,
  ) {
    const res = await fetch(`/api/phone-review/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok) { setErrors((prev) => ({ ...prev, [id]: data.error ?? "Unknown error" })); return; }
    if (action !== "retry") {
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
    setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  async function runBulkAction(action: "approve" | "reject" | "keep_unresolved") {
    const ids = Array.from(selectedIds).filter((id) => filtered.some((c) => c.id === id));
    if (ids.length === 0) return;
    setBulkProgress({ done: 0, total: ids.length });
    let done = 0;
    for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) {
      const batch = ids.slice(i, i + BULK_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (id) => {
          try {
            const res = await fetch(`/api/phone-review/${id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action }),
            });
            const data = await res.json() as { ok: boolean; error?: string };
            if (data.ok) {
              setCandidates((prev) => prev.filter((c) => c.id !== id));
              setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
            } else {
              setErrors((prev) => ({ ...prev, [id]: data.error ?? "Unknown error" }));
            }
          } catch {
            setErrors((prev) => ({ ...prev, [id]: "Network error" }));
          }
          done++;
          setBulkProgress({ done, total: ids.length });
        }),
      );
    }
    setBulkProgress(null);
    if (action === "approve") {
      router.push("/phone-review?_just_approved=1");
      router.refresh();
    }
  }

  // ── Action wrapper for the evidence panel ───────────────────────────────
  function handleEvidenceAction(
    id: string,
    action: "approve" | "reject" | "retry" | "keep_unresolved",
    note?: string,
  ) {
    handleAction(id, action, note);
    if (action !== "retry") {
      setSelectedId(null);
    }
  }

  // ── Inline quick-action with auto-advance ────────────────────────────────
  async function handleQuickAction(id: string, action: "approve" | "reject") {
    const idx = filteredRef.current.findIndex((c) => c.id === id);
    const next = filteredRef.current[idx + 1] ?? filteredRef.current[idx - 1] ?? null;
    await handleAction(id, action);
    setSelectedId(next?.id ?? null);
  }

  // Keep refs in sync every render
  filteredRef.current = filtered;
  selectedIdRef.current = selectedId;
  handleQuickActionRef.current = handleQuickAction;

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // ↑/↓ navigate · Enter = approve · Space = reject
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept while typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const list = filteredRef.current;
      const cur  = selectedIdRef.current;
      const idx  = list.findIndex((c) => c.id === cur);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = list[idx + 1] ?? list[0];
        if (next) setSelectedId(next.id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = list[idx - 1] ?? list[list.length - 1];
        if (prev) setSelectedId(prev.id);
      } else if (e.key === "Enter" && cur) {
        e.preventDefault();
        handleQuickActionRef.current(cur, "approve");
      } else if (e.key === " " && cur) {
        e.preventDefault();
        handleQuickActionRef.current(cur, "reject");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // intentionally empty — reads latest values via refs

  const selectedCount = Array.from(selectedIds).filter((id) =>
    filtered.some((c) => c.id === id),
  ).length;

  // Empty state: no candidates at all
  if (candidates.length === 0) {
    return (
      <div className="so-empty-state">
        <div className="so-empty-state__title">{t.review.empty}</div>
        <div className="so-empty-state__sub">{t.review.emptyDetail}</div>
      </div>
    );
  }

  const focusedCandidate = filtered.find((c) => c.id === selectedId) ?? null;
  const focusedTitle = focusedCandidate
    ? (focusedCandidate.leads?.contacts?.full_name
        ?? focusedCandidate.leads?.contacts?.company_name
        ?? "—")
    : t.review.title;

  return (
    <div className="pr-grid">
      <div className="pr-grid__left">
        <PhoneReviewBucketBar
          buckets={BUCKETS}
          counts={bucketCounts}
          active={activeBucket}
          onSelect={setActiveBucket}
        />

        <PhoneReviewCandidateList
          candidates={filtered}
          selectedIds={selectedIds}
          focusedId={selectedId}
          allFilteredSelected={allFilteredSelected}
          summaries={summaries}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelect={toggleSelect}
          onSelectFocus={(id) => setSelectedId(id)}
          onQuickAction={handleQuickAction}
        />

        {/* Per-row error list (rare path; surfaces server failures from handleAction) */}
        {Object.keys(errors).length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {filtered.map((c) =>
              errors[c.id] ? (
                <li
                  key={c.id}
                  style={{ fontSize: 12, color: "var(--so-danger)", padding: "2px 4px" }}
                >
                  {c.leads?.contacts?.full_name ?? c.leads?.contacts?.company_name ?? "—"} : {errors[c.id]}
                </li>
              ) : null
            )}
          </ul>
        )}
      </div>

      {/* DESKTOP — sticky right rail */}
      <div className="pr-grid__right">
        <PhoneReviewBulkBar
          visible={selectedCount > 0}
          selectedCount={selectedCount}
          bulkProgress={bulkProgress}
          onApprove={() => runBulkAction("approve")}
          onReject={() => runBulkAction("reject")}
          onKeepUnresolved={() => runBulkAction("keep_unresolved")}
        />
        <PhoneReviewEvidencePanel
          candidate={focusedCandidate}
          snippetExpanded={focusedCandidate ? expandedSnippets.has(focusedCandidate.id) : false}
          errorText={focusedCandidate ? (errors[focusedCandidate.id] ?? null) : null}
          onToggleSnippet={toggleSnippet}
          onAction={handleEvidenceAction}
        />
      </div>

      {/* MOBILE — fixed-bottom bulk bar (visible regardless of slide-over).
          Wrapped in a mobile-only container so the desktop instance inside
          .pr-grid__right is the single render on desktop. */}
      <div className="pr-only-mobile">
        <PhoneReviewBulkBar
          visible={selectedCount > 0}
          selectedCount={selectedCount}
          bulkProgress={bulkProgress}
          onApprove={() => runBulkAction("approve")}
          onReject={() => runBulkAction("reject")}
          onKeepUnresolved={() => runBulkAction("keep_unresolved")}
        />
      </div>

      {/* MOBILE — slide-over for the candidate evidence */}
      <PhoneReviewMobileSlideover
        open={selectedId !== null}
        title={focusedTitle}
        onClose={() => setSelectedId(null)}
        returnFocusToId={selectedId ? `pr-row-${selectedId}` : null}
      >
        <PhoneReviewEvidencePanel
          candidate={focusedCandidate}
          snippetExpanded={focusedCandidate ? expandedSnippets.has(focusedCandidate.id) : false}
          errorText={focusedCandidate ? (errors[focusedCandidate.id] ?? null) : null}
          onToggleSnippet={toggleSnippet}
          onAction={handleEvidenceAction}
        />
      </PhoneReviewMobileSlideover>
    </div>
  );
}
