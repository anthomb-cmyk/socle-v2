"use client";
import { useState } from "react";

const SEEDERS = [
  {
    label: "Seed a fake caller user",
    description: "Creates gaylord+seed@socleacquisitions.com as a caller. Used to test RLS isolation.",
    endpoint: "/api/dev/seed-caller",
    body: {},
  },
  {
    label: "Seed 10 leads in Granby",
    description: "Creates a campaign + 10 (property, contact, phone, lead) tuples. Unassigned by default.",
    endpoint: "/api/dev/seed-leads",
    body: { count: 10, city: "Granby" },
  },
  {
    label: "Seed 10 leads + assign to caller (with follow-ups & a review item)",
    description: "Same as above but assigns to the seeded caller and creates 3 follow-ups + a high-urgency review item.",
    endpoint: "/api/dev/seed-leads",
    body: { count: 10, city: "Granby", createFollowUps: true, createReviewItem: true },
    needsCaller: true,
  },
  {
    label: "Seed a hot-seller submission",
    description: "End-to-end: campaign → property → contact → phone → lead → call_log → submission → review_item → automation_event → optional Telegram alert.",
    endpoint: "/api/dev/seed-submission",
    body: {},
  },
  {
    label: "Seed a Telegram-style proposed action",
    description: "Creates a pending append_note proposed action against the most recently-created lead. Approve/reject in /review.",
    endpoint: "/api/dev/seed-proposed-action",
    body: {},
  },
] as const;

export default function SeedActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<{ label: string; ok: boolean; data: unknown } | null>(null);
  const [callerId, setCallerId] = useState<string | null>(null);

  async function run(s: typeof SEEDERS[number]) {
    setBusy(s.label);
    setOutput(null);
    let body: Record<string, unknown> = { ...s.body };
    if ("needsCaller" in s && s.needsCaller && callerId) body = { ...body, assignToUserId: callerId };
    const r = await fetch(s.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    setBusy(null);
    setOutput({ label: s.label, ok: !!j.ok, data: j });
    if (s.endpoint === "/api/dev/seed-caller" && j.ok) {
      setCallerId(j.data?.userId ?? null);
    }
  }

  return (
    <div className="space-y-3">
      {callerId && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
          Cached caller user: <code className="font-mono text-xs">{callerId}</code>. Subsequent seed-leads runs will assign to this user.
        </div>
      )}
      {SEEDERS.map(s => (
        <div key={s.label} className="bg-white border border-zinc-200 rounded-2xl p-4">
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <h3 className="font-semibold text-sm">{s.label}</h3>
              <p className="text-xs text-zinc-500 mt-1">{s.description}</p>
              <code className="block text-xs text-zinc-400 mt-2 font-mono">POST {s.endpoint}</code>
            </div>
            <button onClick={() => run(s)} disabled={busy !== null}
              className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-sm whitespace-nowrap">
              {busy === s.label ? "Running…" : "Run"}
            </button>
          </div>
        </div>
      ))}
      {output && (
        <div className={`rounded-2xl p-4 border ${output.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          <h4 className="font-semibold text-sm mb-2">{output.ok ? "✓" : "✗"} {output.label}</h4>
          <pre className="text-xs overflow-x-auto bg-white rounded p-2">{JSON.stringify(output.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
