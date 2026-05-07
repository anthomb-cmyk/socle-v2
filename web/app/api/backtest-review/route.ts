// POST /api/backtest-review — append a label for a lead to ground_truth_labels_v0.json
// GET  /api/backtest-review — return all labels
// Admin-gated.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

const LABELS_PATH = join(process.cwd(), "data", "ground_truth_labels_v0.json");

type LabelEntry = {
  lead_id: string;
  label: string;
  reviewer: string;
  at: string;
};

function readLabels(): LabelEntry[] {
  if (!existsSync(LABELS_PATH)) return [];
  try {
    const raw = readFileSync(LABELS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LabelEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLabels(entries: LabelEntry[]): void {
  writeFileSync(LABELS_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

const PostBodySchema = z.object({
  lead_id: z.string().uuid("lead_id must be a valid UUID"),
  label: z.enum(["phone_correct", "phone_wrong", "phone_unknown"]),
});

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const labels = readLabels();
  return NextResponse.json({ ok: true, count: labels.length, labels });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.errors.map((e) => e.message).join("; ") },
      { status: 400 }
    );
  }

  const { lead_id, label } = parsed.data;
  const reviewer = auth.user.email ?? auth.user.id;
  const at = new Date().toISOString();

  const existing = readLabels();
  // Replace if already labeled by same reviewer for same lead
  const idx = existing.findIndex(
    (e) => e.lead_id === lead_id && e.reviewer === reviewer
  );
  const entry: LabelEntry = { lead_id, label, reviewer, at };
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }

  writeLabels(existing);

  return NextResponse.json({ ok: true, entry });
}
