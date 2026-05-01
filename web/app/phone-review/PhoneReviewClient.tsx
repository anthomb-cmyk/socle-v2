"use client";

import { useState, useTransition } from "react";

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
    brave: "bg-blue-100 text-blue-700",
    directory_411: "bg-purple-100 text-purple-700",
    place_api: "bg-teal-100 text-teal-700",
    openclaw: "bg-orange-100 text-orange-700",
  };
  const labels: Record<string, string> = {
    brave: "Brave",
    directory_411: "411",
    place_api: "Places",
    openclaw: "OpenClaw",
  };
  return (
    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${map[stage] ?? "bg-zinc-100 text-zinc-500"}`}>
      {labels[stage] ?? stage}
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

function CandidateCard({
  cand,
  onAction,
}: {
  cand: PhoneCandidate;
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
    <div className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-4">
      {/* Header */}
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
          {cand.openclaw_verdict && <VerdictBadge verdict={cand.openclaw_verdict} />}
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

export default function PhoneReviewClient({
  initialCandidates,
}: {
  initialCandidates: PhoneCandidate[];
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    }
    setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  if (candidates.length === 0) {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl p-10 text-center text-zinc-500">
        <div className="text-2xl mb-2">✓</div>
        <div className="font-medium">Review queue is empty</div>
        <div className="text-sm mt-1">All phone candidates have been reviewed.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {candidates.map((c) => (
        <div key={c.id}>
          <CandidateCard cand={c} onAction={handleAction} />
          {errors[c.id] && (
            <p className="text-sm text-red-600 mt-1 px-1">{errors[c.id]}</p>
          )}
        </div>
      ))}
    </div>
  );
}
