"use client";

import { useState } from "react";
import type { SnapshotLead } from "@/lib/backtest/types";

type Label = "phone_correct" | "phone_wrong" | "phone_unknown";

type LabelState = {
  [lead_id: string]: { label: Label; saving: boolean; saved: boolean; error?: string };
};

export function BacktestReviewClient({ leads }: { leads: SnapshotLead[] }) {
  const [labels, setLabels] = useState<LabelState>({});

  async function submitLabel(lead_id: string, label: Label) {
    setLabels((prev) => ({
      ...prev,
      [lead_id]: { label, saving: true, saved: false },
    }));

    try {
      const res = await fetch("/api/backtest-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id, label }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      setLabels((prev) => ({
        ...prev,
        [lead_id]: { label, saving: false, saved: true },
      }));
    } catch (err) {
      setLabels((prev) => ({
        ...prev,
        [lead_id]: {
          label,
          saving: false,
          saved: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {leads.map((lead) => {
        const state = labels[lead.lead_id];
        return (
          <div
            key={lead.lead_id}
            style={{
              border: "1px solid var(--crm-border, #e5e7eb)",
              borderRadius: 8,
              padding: "16px 20px",
              backgroundColor: state?.saved ? "var(--crm-green-bg, #f0fdf4)" : "var(--crm-card, #fff)",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "start",
            }}
          >
            {/* Lead info */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                  }}
                >
                  {lead.owner_full_name ?? "(unknown owner)"}
                </span>
                {lead.company_name && (
                  <span style={{ fontSize: 13, color: "var(--crm-text3, #666)" }}>
                    {lead.company_name}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 99,
                    backgroundColor: statusColor(lead.status),
                    color: "#fff",
                    fontWeight: 500,
                  }}
                >
                  {lead.status ?? "unknown"}
                </span>
              </div>

              <div style={{ fontSize: 13, color: "var(--crm-text2, #444)", display: "flex", gap: 16, flexWrap: "wrap" }}>
                {/* Mailing */}
                {lead.mailing_address && (
                  <span>
                    <strong>Mailing:</strong>{" "}
                    {[lead.mailing_address, lead.mailing_city, lead.mailing_province, lead.mailing_postal]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
                {/* Property */}
                {lead.property_address && (
                  <span>
                    <strong>Property:</strong>{" "}
                    {[lead.property_address, lead.property_city, lead.property_province]
                      .filter(Boolean)
                      .join(", ")}
                    {lead.num_units ? ` (${lead.num_units} units)` : ""}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 13, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {/* Phone */}
                <span>
                  <strong>Phone:</strong>{" "}
                  {lead.current_phone ? (
                    <span style={{ color: "var(--crm-green, #16a34a)", fontWeight: 600 }}>
                      {lead.current_phone}
                      {lead.phone_source ? ` (${lead.phone_source})` : ""}
                    </span>
                  ) : (
                    <span style={{ color: "var(--crm-text3, #999)" }}>none</span>
                  )}
                </span>
                <span>
                  <strong>Candidates:</strong> {lead.candidate_count}
                </span>
                <span style={{ color: "var(--crm-text3, #999)", fontSize: 12 }}>
                  {lead.lead_id.slice(0, 8)}…
                </span>
              </div>

              {state?.error && (
                <div style={{ fontSize: 12, color: "red" }}>Error: {state.error}</div>
              )}
              {state?.saved && (
                <div style={{ fontSize: 12, color: "var(--crm-green, #16a34a)" }}>
                  Saved: {state.label.replace(/_/g, " ")}
                </div>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
              {(
                [
                  { label: "phone_correct" as Label, text: "Phone correct", color: "#16a34a" },
                  { label: "phone_wrong" as Label, text: "Phone wrong", color: "#dc2626" },
                  { label: "phone_unknown" as Label, text: "Unknown", color: "#6b7280" },
                ] as const
              ).map(({ label, text, color }) => {
                const isActive = state?.label === label && (state.saving || state.saved);
                return (
                  <button
                    key={label}
                    disabled={state?.saving}
                    onClick={() => submitLabel(lead.lead_id, label)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: isActive ? `2px solid ${color}` : "1px solid #e5e7eb",
                      backgroundColor: isActive ? `${color}15` : "#fff",
                      color: isActive ? color : "#374151",
                      fontWeight: isActive ? 600 : 400,
                      cursor: state?.saving ? "wait" : "pointer",
                      fontSize: 13,
                      transition: "all 0.1s",
                    }}
                  >
                    {state?.saving && state.label === label ? "Saving…" : text}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function statusColor(status: string | null): string {
  switch (status) {
    case "ready_to_call": return "#16a34a";
    case "needs_phone_review": return "#d97706";
    case "unresolved_after_openclaw": return "#9333ea";
    default: return "#6b7280";
  }
}
