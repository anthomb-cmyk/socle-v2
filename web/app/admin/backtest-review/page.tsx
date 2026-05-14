// /admin/backtest-review — stratified random sample of leads for ground-truth labeling.
// Server component. Admin-only.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { readFileSync } from "fs";
import { join } from "path";
import type { Snapshot, SnapshotLead } from "@/lib/backtest/types";
import { BacktestReviewClient } from "./BacktestReviewClient";

function loadSnapshot(): Snapshot {
  const filePath = join(process.cwd(), "data", "ground_truth_v0.json");
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Snapshot;
}

function stratifiedSample(leads: SnapshotLead[], n: number): SnapshotLead[] {
  const byStatus: Record<string, SnapshotLead[]> = {};
  for (const lead of leads) {
    const s = lead.status ?? "unknown";
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(lead);
  }

  // Shuffle each bucket (seeded by lead_id for reproducibility-ish)
  function deterministicShuffle(arr: SnapshotLead[]): SnapshotLead[] {
    return [...arr].sort((a, b) => (a.lead_id < b.lead_id ? -1 : 1));
  }

  const result: SnapshotLead[] = [];
  const keys = ["ready_to_call", "needs_phone_review", "unresolved_after_openclaw"];
  for (const key of keys) {
    const bucket = deterministicShuffle(byStatus[key] ?? []);
    result.push(...bucket.slice(0, n));
  }

  // Fill remainder from any status not yet covered
  if (result.length < keys.length * n) {
    const covered = new Set(result.map((l) => l.lead_id));
    for (const key of Object.keys(byStatus)) {
      if (keys.includes(key)) continue;
      const bucket = deterministicShuffle(byStatus[key] ?? []);
      for (const lead of bucket) {
        if (!covered.has(lead.lead_id)) {
          result.push(lead);
          covered.add(lead.lead_id);
          if (result.length >= keys.length * n) break;
        }
      }
    }
  }

  return result;
}

export const dynamic = "force-dynamic";

export default async function BacktestReviewPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") redirect("/login");

  const snapshot = loadSnapshot();
  // 10 per status bucket = 30 total
  const sample = stratifiedSample(snapshot.leads, 10);

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "32px 16px",
        fontFamily: "var(--font-geist-sans, system-ui, sans-serif)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Backtest Review — Ground Truth Labels
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--crm-text3, #666)", fontSize: 14 }}>
          Stratified sample of {sample.length} leads ({snapshot.count} total in snapshot,
          generated {new Date(snapshot.generated_at).toLocaleDateString()}).
          Label each lead to build ground truth for pipeline accuracy measurement.
        </p>
      </div>

      <BacktestReviewClient leads={sample} />
    </main>
  );
}
