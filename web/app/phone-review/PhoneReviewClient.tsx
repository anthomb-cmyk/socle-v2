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
  /** v3 gate engine results (jsonb) — present on candidates produced by pipeline_v3. */
  gate_results: {
    outcomes: Array<{ gate: string; pass: boolean; reason: string; signal?: Record<string, unknown> }>;
    passed: boolean;
    firstFailure: string | null;
    disposition: "auto_attached" | "needs_anthony_review" | "weak_review" | "quarantined" | "pipeline_rejected";
    score: number;
    scoreFactors?: { source: number; address: number; name: number; phoneAuthority: number };
    haiku?: { isOwnersPhone: boolean; confidence: number; reasoning: string; nameInSource: boolean; addressInSource: boolean };
  } | null;
  /** v3 source classification (page-shape classifier output). */
  source_class: string | null;
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

  // Build immediate rule-based verdict summaries from existing fields — no API call needed.
  // Shape matches the AI output: "<✓|✗|?> <raison ≤ 12 mots>".
  // AI summaries (fetched below) replace these when ready.
  const fallbackSummaries = useMemo<Record<string, string>>(() => {
    const matchLabels: Record<string, string> = {
      mailing_address:      "adresse postale concorde",
      postal_prefix:        "code postal seulement",
      city:                 "ville seulement",
      contact_name:         "nom concorde",
      company_name:         "entreprise concorde",
      property_address:     "adresse propriété concorde",
      director_name:        "directeur concorde",
      related_company:      "entreprise liée",
      same_address_company: "même adresse entreprise",
      public_directory:     "annuaire public",
      company_website:      "site web entreprise",
      openclaw:             "OpenClaw",
    };

    // Smoking-gun signal detection from snippet/evidence text.
    // Returns a specific reason string if a clear signal is found, else null.
    function detectSignal(c: PhoneCandidate): { verdict: "✓" | "✗" | "?"; reason: string } | null {
      const phone = (c.phone_e164 ?? c.phone_raw ?? "").replace(/\D/g, "");
      const phone7 = phone.slice(-7);
      const blob = `${c.snippet ?? ""} ${c.openclaw_evidence ?? ""} ${c.openclaw_reasoning ?? ""} ${c.candidate_address ?? ""}`.toLowerCase();

      // 1. Fax detection — "Fax: <our_number>" or "Télécopieur: <our_number>"
      if (phone7) {
        // Look for fax label within ~30 chars before the number
        const faxNear = new RegExp(`(fax|t[eé]l[eé]copieur)[\\s:.-]{0,3}\\(?\\d{0,3}\\)?[\\s.-]?\\d{0,3}[\\s.-]?\\d{0,4}.{0,30}${phone7.slice(0,3)}.?${phone7.slice(3,6)}.?${phone7.slice(6)}`, "is");
        if (faxNear.test(blob)) return { verdict: "✗", reason: "Marqué « Fax » dans la source — refuser" };
      }

      // 2. Senior residence / institution detection
      if (/\b(r[ée]sidence pour a[îi]n[ée]s|chsld|rpa|manoir|centre d['e]?h[ée]bergement)\b/.test(blob)) {
        return { verdict: "✗", reason: "Résidence/CHSLD, pas le proprio — refuser" };
      }

      // 3. Different last name (only meaningful when both names present)
      const propOwner = (c.leads?.contacts?.full_name ?? "").toLowerCase().trim();
      const sourceName = (c.candidate_name ?? "").toLowerCase().trim();
      if (propOwner && sourceName) {
        const ownerLast = propOwner.split(/\s+/).pop() ?? "";
        const sourceLast = sourceName.split(/\s+/).pop() ?? "";
        if (ownerLast.length >= 3 && sourceLast.length >= 3 && ownerLast !== sourceLast && !sourceName.includes(ownerLast) && !propOwner.includes(sourceLast)) {
          return { verdict: "✗", reason: `Nom source « ${c.candidate_name} » ≠ proprio — refuser` };
        }
      }

      return null;
    }

    const result: Record<string, string> = {};
    for (const c of initialCandidates) {
      const conf = c.initial_confidence;
      const v = c.openclaw_verdict;
      const matched = c.matched_on ? (matchLabels[c.matched_on] ?? c.matched_on) : null;
      let host: string | null = null;
      if (c.source_url) {
        try { host = new URL(c.source_url).hostname.replace(/^www\./, ""); }
        catch { /* ignore */ }
      }

      // First — try to detect a smoking-gun signal in the data itself
      const signal = detectSignal(c);
      if (signal) {
        result[c.id] = `${signal.verdict} ${signal.reason}`;
        continue;
      }

      // Fall back to confidence + verdict rules
      let verdict: "✓" | "✗" | "?";
      if ((v === "likely_match" && conf >= 70) || conf >= 80) verdict = "✓";
      else if (v === "unlikely_match" || conf < 25) verdict = "✗";
      else verdict = "?";

      // Reason — opinionated, ≤ 14 words, points the signal
      let reason: string;
      if (verdict === "✓") {
        if (matched && host) reason = `${matched} sur ${host} — approuver`;
        else if (matched)    reason = `${matched} (${conf}%) — approuver`;
        else if (v === "likely_match") reason = `OpenClaw confirme (${conf}%) — approuver`;
        else reason = `Confiance élevée (${conf}%) — approuver`;
      } else if (verdict === "✗") {
        if (v === "unlikely_match") {
          reason = host ? `OpenClaw rejette via ${host} — refuser` : `OpenClaw rejette ce numéro — refuser`;
        } else if (conf < 10) {
          reason = `Aucune preuve directe (${conf}%) — refuser`;
        } else {
          reason = `Confiance trop faible (${conf}%) — refuser`;
        }
      } else {
        // uncertain — point what's missing
        if (c.matched_on === "postal_prefix") {
          reason = `Code postal seulement, nom absent — vérifier`;
        } else if (c.matched_on === "city") {
          reason = `Ville seulement, lien faible — vérifier`;
        } else if (matched && host) {
          reason = `${matched} via ${host} — vérifier`;
        } else if (matched) {
          reason = `${matched} (${conf}%) — vérifier`;
        } else if (host) {
          reason = `Source ${host} (${conf}%) — vérifier`;
        } else {
          reason = `Aucun match clair (${conf}%) — vérifier`;
        }
      }

      result[c.id] = `${verdict} ${reason}`;
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [summaries, setSummaries] = useState<Record<string, string>>(fallbackSummaries);

  // Fetch AI summaries on mount — replaces rule-based summaries when ready
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
      openclawReasoning: c.openclaw_reasoning,
      matchedOn: c.matched_on,
      confidence: c.initial_confidence,
    }));
    fetch("/api/phone-review/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: payload }),
    })
      .then((r) => r.json())
      .then((data: { summaries: Record<string, string> }) => {
        const ai = data.summaries ?? {};
        if (Object.keys(ai).length > 0) setSummaries(ai);
        // else keep fallbacks
      })
      .catch(() => {}); // keep fallbacks on error
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
  // Only bails inside text-input contexts (INPUT/TEXTAREA/SELECT/contenteditable).
  // Buttons and links DO NOT block — arrows always navigate, Enter/Space act on
  // the focused row. We preventDefault + blur the focused button so its own
  // onClick handler doesn't also fire (the cause of the previous double-fire).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? "";

      // Only bail when the user is actively typing into a text field
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable) return;

      const list = filteredRef.current;
      const cur  = selectedIdRef.current;
      const idx  = list.findIndex((c) => c.id === cur);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        // If a button has focus (bucket pill, sidebar nav, etc.), drop it so
        // arrow keys keep working on the next press too.
        if (tag === "BUTTON" || tag === "A") active?.blur();
        const next = list[Math.min(idx + 1, list.length - 1)];
        if (next && next.id !== cur) setSelectedId(next.id);
        else if (idx === -1 && list[0]) setSelectedId(list[0].id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (tag === "BUTTON" || tag === "A") active?.blur();
        const prev = list[Math.max(idx - 1, 0)];
        if (prev && prev.id !== cur) setSelectedId(prev.id);
        else if (idx === -1 && list[list.length - 1]) setSelectedId(list[list.length - 1].id);
      } else if (e.key === "Enter" && cur) {
        e.preventDefault();
        e.stopPropagation();
        // Blur first so the focused button's keydown→click default doesn't ALSO fire
        if (tag === "BUTTON" || tag === "A") active?.blur();
        void handleQuickActionRef.current(cur, "approve");
      } else if (e.key === " " && cur) {
        e.preventDefault();
        e.stopPropagation();
        if (tag === "BUTTON" || tag === "A") active?.blur();
        void handleQuickActionRef.current(cur, "reject");
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
