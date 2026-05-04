"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";

type Campaign = { name: string } | null;
type Property = { address: string; city: string | null; num_units: number | null } | null;
type Contact = { id: string; full_name: string | null; company_name: string | null; mailing_address: string | null; mailing_city: string | null; mailing_postal: string | null } | null;
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

// ── Confidence filter buckets ─────────────────────────────────────────────────
type ConfidenceBucket = "all" | "ge80" | "70-79" | "60-69" | "50-59" | "lt50";

function bucketLabel(b: ConfidenceBucket, count: number): string {
  const labels: Record<ConfidenceBucket, string> = {
    all:    `Tous (${count})`,
    ge80:   `≥ 80 (${count})`,
    "70-79": `70-79 (${count})`,
    "60-69": `60-69 (${count})`,
    "50-59": `50-59 (${count})`,
    lt50:   `< 50 (${count})`,
  };
  return labels[b];
}

function matchBucket(conf: number, b: ConfidenceBucket): boolean {
  if (b === "all") return true;
  if (b === "ge80") return conf >= 80;
  if (b === "70-79") return conf >= 70 && conf <= 79;
  if (b === "60-69") return conf >= 60 && conf <= 69;
  if (b === "50-59") return conf >= 50 && conf <= 59;
  if (b === "lt50") return conf < 50;
  return true;
}

// ── Badge components ──────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-emerald-100 text-emerald-800" :
    score >= 50 ? "bg-amber-100 text-amber-800" :
    "bg-red-100 text-red-700";
  return (
    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${color}`}>
      {score}%
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  const map: Record<string, string> = {
    likely_match: "bg-emerald-100 text-emerald-800",
    uncertain: "bg-amber-100 text-amber-800",
    unlikely_match: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = {
    likely_match: "Likely match",
    uncertain: "Uncertain",
    unlikely_match: "Unlikely match",
  };
  return (
    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${map[verdict] ?? "bg-zinc-100 text-zinc-600"}`}>
      OpenClaw: {labels[verdict] ?? verdict}
    </span>
  );
}

function StagePill({ stage }: { stage: string }) {
  const map: Record<string, string> = {
    address_search: "bg-blue-100 text-blue-700",
    company_search: "bg-purple-100 text-purple-700",
    openclaw:       "bg-orange-100 text-orange-700",
  };
  const labels: Record<string, string> = {
    address_search: "Adresse",
    company_search: "Entreprise",
    openclaw:       "OpenClaw",
  };
  return (
    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${map[stage] ?? "bg-zinc-100 text-zinc-500"}`}>
      {labels[stage] ?? stage}
    </span>
  );
}

function MatchedOnPill({ matchedOn }: { matchedOn: string | null }) {
  if (!matchedOn) return null;
  const labels: Record<string, string> = {
    mailing_address:    "adresse postale",
    mailing_postal:     "code postal",
    address_company:    "co. à l'adresse",
    property_address:   "adresse immeuble",
    company_name:       "nom entreprise",
    director_name:      "nom directeur",
    related_company:    "co. liée",
    same_address_company: "co. même adresse",
    public_directory:   "annuaire public",
    company_website:    "site web co.",
    public_b2bhint_page: "B2BHint public",
    openclaw:           "OpenClaw",
  };
  return (
    <span className="text-xs bg-zinc-100 text-zinc-500 rounded-full px-2 py-0.5">
      via {labels[matchedOn] ?? matchedOn}
    </span>
  );
}

function formatPhone(raw: string | null): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1")
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

// ── CandidateCard ─────────────────────────────────────────────────────────────

function CandidateCard({
  cand,
  selected,
  onToggleSelect,
  onAction,
}: {
  cand: PhoneCandidate;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onAction: (id: string, action: "approve" | "reject" | "retry" | "keep_unresolved", note?: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  const contact = cand.leads?.contacts;
  const property = cand.leads?.properties;
  const name = contact?.full_name ?? contact?.company_name ?? "—";
  const address = property?.address ?? "—";
  const city = property?.city ?? "";

  function act(action: "approve" | "reject" | "retry" | "keep_unresolved") {
    startTransition(() => {
      onAction(cand.id, action, note || undefined);
    });
  }

  return (
    <div
      className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-4"
      style={selected ? { borderColor: "#6ee7b7", boxShadow: "0 0 0 2px #6ee7b733" } : {}}
    >
      {/* Checkbox + Header */}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(cand.id)}
          className="mt-1 h-4 w-4 rounded border-zinc-300 text-emerald-600 cursor-pointer"
          aria-label={`Sélectionner ${name}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-zinc-900 truncate">{name}</div>
              <div className="text-sm text-zinc-500 truncate">
                {address}{city ? `, ${city}` : ""}
                {property?.num_units ? ` · ${property.num_units} units` : ""}
              </div>
              {contact?.mailing_address && (
                <div className="text-xs text-zinc-400 mt-0.5">
                  Mail: {contact.mailing_address}{contact.mailing_city ? `, ${contact.mailing_city}` : ""}
                  {contact.mailing_postal ? ` ${contact.mailing_postal}` : ""}
                </div>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap shrink-0">
              <StagePill stage={cand.stage} />
              <ConfidenceBadge score={cand.initial_confidence} />
              <MatchedOnPill matchedOn={cand.matched_on} />
              {cand.openclaw_verdict && <VerdictBadge verdict={cand.openclaw_verdict} />}
            </div>
          </div>
        </div>
      </div>

      {/* Phone candidate */}
      <div className="bg-zinc-50 rounded-xl p-3 flex items-center gap-3">
        <span className="font-mono text-lg font-semibold text-zinc-900">
          {formatPhone(cand.phone_e164 ?? cand.phone_raw)}
        </span>
        {cand.phone_e164 && (
          <span className="text-xs text-zinc-400 font-mono">{cand.phone_e164}</span>
        )}
        {cand.source_label && (
          <span className="text-xs text-zinc-400 ml-auto">{cand.source_label}</span>
        )}
      </div>

      {/* Match context */}
      {(cand.candidate_name || cand.candidate_address) && (
        <div className="text-xs text-zinc-500 space-y-0.5">
          {cand.candidate_name && (
            <div><span className="text-zinc-400">Nom trouvé :</span> <span className="font-medium text-zinc-700">{cand.candidate_name}</span></div>
          )}
          {cand.candidate_address && (
            <div><span className="text-zinc-400">Adresse source :</span> {cand.candidate_address}</div>
          )}
          {cand.search_query && (
            <div className="text-zinc-300 italic truncate">Requête : {cand.search_query}</div>
          )}
        </div>
      )}

      {/* Evidence */}
      {cand.snippet && (
        <div className="text-xs text-zinc-500 bg-zinc-50 rounded-lg p-2 border border-zinc-100 max-h-20 overflow-y-auto whitespace-pre-wrap">
          {cand.snippet}
        </div>
      )}
      {cand.source_url && (
        <div className="text-xs">
          <a
            href={cand.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline truncate block"
          >
            {cand.source_url}
          </a>
        </div>
      )}

      {/* OpenClaw analysis */}
      {(cand.openclaw_reasoning || cand.openclaw_evidence) && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer font-medium text-zinc-700">OpenClaw analysis</summary>
          <div className="mt-2 space-y-1">
            {cand.openclaw_confidence != null && (
              <div>Confidence: <strong>{cand.openclaw_confidence}%</strong></div>
            )}
            {cand.openclaw_evidence && <div>{cand.openclaw_evidence}</div>}
            {cand.openclaw_reasoning && (
              <div className="whitespace-pre-wrap">{cand.openclaw_reasoning}</div>
            )}
          </div>
        </details>
      )}

      {/* Review reason */}
      {cand.review_reason && (
        <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1">
          {cand.review_reason}
        </div>
      )}

      {/* Note */}
      <input
        type="text"
        placeholder="Optional note (stored with your decision)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
        disabled={isPending}
      />

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => act("approve")}
          disabled={isPending}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl px-4 py-2 disabled:opacity-50 transition"
        >
          ✓ Approve — make callable
        </button>
        <button
          onClick={() => act("reject")}
          disabled={isPending}
          className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-xl px-4 py-2 disabled:opacity-50 transition border border-red-200"
        >
          ✗ Reject
        </button>
        <button
          onClick={() => act("retry")}
          disabled={isPending}
          className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm rounded-xl px-3 py-2 disabled:opacity-50 transition"
        >
          ↺ Retry
        </button>
        <button
          onClick={() => act("keep_unresolved")}
          disabled={isPending}
          className="bg-zinc-50 hover:bg-zinc-100 text-zinc-500 text-sm rounded-xl px-3 py-2 disabled:opacity-50 transition border border-zinc-200"
        >
          Keep unresolved
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const BULK_CONCURRENCY = 10;

export default function PhoneReviewClient({
  initialCandidates,
}: {
  initialCandidates: PhoneCandidate[];
}) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(initialCandidates);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeBucket, setActiveBucket] = useState<ConfidenceBucket>("all");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // Filtered list based on active bucket
  const filtered = useMemo(
    () => candidates.filter((c) => matchBucket(c.initial_confidence, activeBucket)),
    [candidates, activeBucket],
  );

  // Count per bucket for pill labels
  const bucketCounts = useMemo<Record<ConfidenceBucket, number>>(() => {
    const counts: Record<ConfidenceBucket, number> = {
      all: candidates.length,
      ge80: 0,
      "70-79": 0,
      "60-69": 0,
      "50-59": 0,
      lt50: 0,
    };
    for (const c of candidates) {
      if (c.initial_confidence >= 80) counts.ge80++;
      else if (c.initial_confidence >= 70) counts["70-79"]++;
      else if (c.initial_confidence >= 60) counts["60-69"]++;
      else if (c.initial_confidence >= 50) counts["50-59"]++;
      else counts.lt50++;
    }
    return counts;
  }, [candidates]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.add(c.id));
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

    if (!data.ok) {
      setErrors((prev) => ({ ...prev, [id]: data.error ?? "Unknown error" }));
      return;
    }

    // Remove from queue on success (approve, reject, keep_unresolved)
    // Keep on retry so user can see it's been re-queued
    if (action !== "retry") {
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
    setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  async function runBulkAction(action: "approve" | "reject" | "keep_unresolved") {
    const ids = Array.from(selectedIds).filter((id) =>
      filtered.some((c) => c.id === id),
    );
    if (ids.length === 0) return;

    setBulkProgress({ done: 0, total: ids.length });

    // Process in batches of BULK_CONCURRENCY
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
              // Bulk actions are never "retry", so always remove from list
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

    // After bulk approve, redirect with _just_approved flag
    if (action === "approve") {
      router.push("/phone-review?_just_approved=1");
      router.refresh();
    }
  }

  const selectedCount = Array.from(selectedIds).filter((id) =>
    filtered.some((c) => c.id === id),
  ).length;

  if (candidates.length === 0) {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl p-10 text-center text-zinc-500">
        <div className="text-2xl mb-2">✓</div>
        <div className="font-medium">Review queue is empty</div>
        <div className="text-sm mt-1">All phone candidates have been reviewed.</div>
      </div>
    );
  }

  const BUCKETS: ConfidenceBucket[] = ["all", "ge80", "70-79", "60-69", "50-59", "lt50"];

  return (
    <div className="space-y-4">
      {/* ── Confidence filter pills ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {BUCKETS.map((b) => (
          <button
            key={b}
            onClick={() => setActiveBucket(b)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 12px",
              borderRadius: 999,
              border: "1px solid",
              cursor: "pointer",
              transition: "all 0.15s",
              borderColor: activeBucket === b ? "#059669" : "#e5e7eb",
              background: activeBucket === b ? "#059669" : "#f9fafb",
              color: activeBucket === b ? "#fff" : "#374151",
            }}
          >
            {bucketLabel(b, bucketCounts[b])}
          </button>
        ))}
      </div>

      {/* ── Master checkbox + select all label ── */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px" }}>
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-zinc-300 text-emerald-600 cursor-pointer"
            aria-label="Tout sélectionner"
          />
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            {allFilteredSelected
              ? `Tout désélectionner (${filtered.length})`
              : `Tout sélectionner (${filtered.length})`}
          </span>
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectedCount > 0 && (
        <div
          style={{
            position: "sticky",
            top: 12,
            zIndex: 20,
            background: "#1f2937",
            color: "#f9fafb",
            borderRadius: 12,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 120 }}>
            {bulkProgress
              ? `Approbation en cours… ${bulkProgress.done} / ${bulkProgress.total}`
              : `${selectedCount} candidat${selectedCount !== 1 ? "e" : ""}${selectedCount !== 1 ? "s" : ""} sélectionné${selectedCount !== 1 ? "e" : ""}${selectedCount !== 1 ? "s" : ""}`}
          </span>
          <button
            onClick={() => runBulkAction("approve")}
            disabled={bulkProgress !== null}
            style={{
              background: "#059669", color: "#fff", border: "none",
              borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", opacity: bulkProgress ? 0.6 : 1,
            }}
          >
            Approuver tous
          </button>
          <button
            onClick={() => runBulkAction("reject")}
            disabled={bulkProgress !== null}
            style={{
              background: "#dc2626", color: "#fff", border: "none",
              borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", opacity: bulkProgress ? 0.6 : 1,
            }}
          >
            Rejeter tous
          </button>
          <button
            onClick={() => runBulkAction("keep_unresolved")}
            disabled={bulkProgress !== null}
            style={{
              background: "#374151", color: "#d1d5db", border: "1px solid #4b5563",
              borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", opacity: bulkProgress ? 0.6 : 1,
            }}
          >
            Garder non-résolu
          </button>
        </div>
      )}

      {/* ── Candidate list ── */}
      {filtered.map((c) => (
        <div key={c.id}>
          <CandidateCard
            cand={c}
            selected={selectedIds.has(c.id)}
            onToggleSelect={toggleSelect}
            onAction={handleAction}
          />
          {errors[c.id] && (
            <p className="text-sm text-red-600 mt-1 px-1">{errors[c.id]}</p>
          )}
        </div>
      ))}

      {filtered.length === 0 && candidates.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center text-zinc-400 text-sm">
          Aucun candidat dans ce filtre de confiance.
        </div>
      )}
    </div>
  );
}
