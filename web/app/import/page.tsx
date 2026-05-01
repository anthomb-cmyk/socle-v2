"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type PreviewSummary = {
  jobId: string;
  campaignId: string | null;
  format: string;
  totalRows: number;
  summary: { properties: number; owners: number; phones: number; cities: string[] };
  previewRows: Array<{
    row: number; address: string; city: string | null; matricule?: string;
    num_units?: number;
    owners: Array<{ kind: string; name: string; phones: string[] }>;
    errors: string[];
  }>;
  errorsCount: number;
};

type Counts = {
  properties_created: number; properties_updated: number;
  contacts_created: number; contacts_updated: number;
  phones_created: number; leads_created: number; leads_updated: number;
  duplicates_seen: number; errors: { row: number; message: string }[];
};

type User = { user_id: string; display_name: string; role: string };

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Counts | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);

  // Post-import quick-assign state
  const [users, setUsers] = useState<User[]>([]);
  const [assignTarget, setAssignTarget] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ count: number; name: string } | null>(null);
  const [newLeadIds, setNewLeadIds] = useState<string[]>([]);
  const [campaignIdForResult, setCampaignIdForResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users").then(r => r.json()).then(j => {
      if (j.ok) setUsers(j.data.filter((u: User) => u.role === "caller" || u.role === "cold_caller"));
    });
  }, []);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null); setBusy(true); setPreview(null); setResult(null);
    setAssignResult(null); setNewLeadIds([]);

    const fd = new FormData();
    fd.append("file", file);
    if (campaignName.trim()) fd.append("campaignName", campaignName.trim());
    if (city.trim()) fd.append("city", city.trim());

    const resp = await fetch("/api/import/upload", { method: "POST", body: fd });
    const json = await resp.json();
    setBusy(false);
    if (!json.ok) { setError(json.error); return; }
    setPreview(json.data);
  }

  async function onConfirm() {
    if (!preview) return;
    setBusy(true); setError(null);
    const resp = await fetch(`/api/import/${preview.jobId}/confirm`, { method: "POST" });
    const json = await resp.json();
    setBusy(false);
    if (!json.ok) { setError(json.error); return; }
    setResult(json.data);
    setCampaignIdForResult(preview.campaignId);
    // Fetch the newly created lead IDs so we can assign them
    if (preview.campaignId) {
      const leadsResp = await fetch(`/api/leads?campaign_id=${preview.campaignId}&limit=500`);
      const leadsJson = await leadsResp.json();
      if (leadsJson.ok) {
        setNewLeadIds(leadsJson.data.leads.map((l: { lead_id: string }) => l.lead_id));
      }
    }
  }

  async function quickAssign() {
    if (!assignTarget || newLeadIds.length === 0) return;
    setAssigning(true);
    const resp = await fetch("/api/leads/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: newLeadIds, userId: assignTarget }),
    });
    const json = await resp.json();
    setAssigning(false);
    if (!json.ok) { setError(json.error); return; }
    const name = users.find(u => u.user_id === assignTarget)?.display_name ?? "caller";
    setAssignResult({ count: newLeadIds.length, name });
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import a rôle</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Upload a Québec rôle XLSX. Preview first, then confirm to write to the database.
        </p>
      </div>

      {/* ─── Upload form ─── */}
      {!result && (
        <form onSubmit={onUpload} className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              XLSX file <span className="text-red-500">*</span>
            </label>
            <input type="file" accept=".xlsx,.xls"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Campaign name <span className="text-zinc-400 font-normal text-xs">(recommended — groups leads for assignment)</span>
              </label>
              <input type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)}
                placeholder="e.g. Granby rôle avril 2026"
                className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City <span className="text-zinc-400 font-normal text-xs">(optional hint)</span></label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)}
                placeholder="e.g. Granby"
                className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !file}
              className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
              {busy ? "Parsing…" : "Parse and preview"}
            </button>
            {preview && (
              <button type="button" onClick={() => { setPreview(null); setFile(null); setResult(null); }}
                className="text-sm text-zinc-600 hover:underline">
                Reset
              </button>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      {/* ─── Preview ─── */}
      {preview && !result && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Preview</h2>
            <p className="text-sm text-zinc-500">
              Format: <code className="bg-zinc-100 px-1 rounded">{preview.format}</code> · {preview.totalRows} rows scanned
              {!campaignName && (
                <span className="ml-2 text-amber-600">⚠ No campaign name — leads will have no campaign tag</span>
              )}
            </p>
          </div>

          <dl className="grid grid-cols-4 gap-4">
            <StatBox label="Properties" value={preview.summary.properties} />
            <StatBox label="Owners / leads" value={preview.summary.owners} />
            <StatBox label="Callable (with phone)" value={preview.summary.phones} highlight />
            <StatBox label="Parse errors" value={preview.errorsCount} negative={preview.errorsCount > 0} />
          </dl>

          {preview.summary.cities.length > 0 && (
            <p className="text-sm text-zinc-600">
              Cities: {preview.summary.cities.slice(0, 8).join(", ")}{preview.summary.cities.length > 8 ? "…" : ""}
            </p>
          )}

          {/* Preview table */}
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-500 text-xs">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Address</th>
                  <th className="text-left p-2">City</th>
                  <th className="text-left p-2">Owners</th>
                  <th className="text-left p-2">Phones</th>
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map(r => (
                  <tr key={r.row} className="border-t border-zinc-100">
                    <td className="p-2 text-zinc-400">{r.row}</td>
                    <td className="p-2">{r.address}</td>
                    <td className="p-2">{r.city ?? <span className="text-zinc-400">—</span>}</td>
                    <td className="p-2">{r.owners.map(o => o.name).join("; ") || <span className="text-zinc-400">none</span>}</td>
                    <td className="p-2 font-mono text-xs text-emerald-700">
                      {r.owners.flatMap(o => o.phones).slice(0, 2).join(" ") || <span className="text-zinc-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.totalRows > 10 && (
              <p className="p-2 text-xs text-zinc-400 bg-zinc-50">
                Showing first 10 of {preview.totalRows} rows.
              </p>
            )}
          </div>

          {preview.errorsCount > 0 && (
            <div>
              <button onClick={() => setErrorsOpen(o => !o)}
                className="text-sm text-amber-700 hover:underline">
                {errorsOpen ? "▾" : "▸"} {preview.errorsCount} parse error{preview.errorsCount === 1 ? "" : "s"} (soft — rows still import with available data)
              </button>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={onConfirm} disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg px-5 py-2 text-sm font-medium">
              {busy ? "Importing…" : "Confirm import"}
            </button>
            <button onClick={() => { setPreview(null); setFile(null); }} disabled={busy}
              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-lg px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {/* ─── Result + quick assign ─── */}
      {result && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-emerald-900">✓ Import complete</h2>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <StatBox label="Properties created" value={result.properties_created} />
              <StatBox label="Properties updated" value={result.properties_updated} />
              <StatBox label="Contacts created" value={result.contacts_created} />
              <StatBox label="Contacts updated" value={result.contacts_updated} />
              <StatBox label="Phones (callable)" value={result.phones_created} highlight />
              <StatBox label="Leads created" value={result.leads_created} />
              <StatBox label="Leads updated" value={result.leads_updated} />
              <StatBox label="Errors" value={result.errors.length} negative={result.errors.length > 0} />
            </dl>
            {result.errors.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-amber-700 hover:underline">
                  {result.errors.length} row error{result.errors.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>Row {e.row}: {e.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Quick assign panel — only shown if we have a campaign and leads */}
          {newLeadIds.length > 0 && !assignResult && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 space-y-3">
              <h2 className="text-base font-semibold text-blue-900">Assign leads to a caller</h2>
              <p className="text-sm text-blue-800">
                {newLeadIds.length} leads are ready to assign (from this campaign).
                {result.phones_created > 0 && (
                  <> <strong>{result.phones_created}</strong> have a phone number and are immediately callable.</>
                )}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)}
                  className="border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white min-w-48">
                  <option value="">Select caller…</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
                </select>
                <button onClick={quickAssign} disabled={assigning || !assignTarget}
                  className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
                  {assigning ? "Assigning…" : `Assign all ${newLeadIds.length} leads`}
                </button>
                <button onClick={() => router.push(campaignIdForResult
                  ? `/leads?campaign_id=${campaignIdForResult}` : "/leads")}
                  className="text-sm text-blue-700 hover:underline">
                  Skip → view leads
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}

          {/* Assignment done */}
          {assignResult && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
              <p className="text-emerald-900 font-medium">
                ✓ {assignResult.count} leads assigned to {assignResult.name}
              </p>
              <p className="text-sm text-emerald-800 mt-1">
                {assignResult.name} will see these leads in their call queue immediately.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => router.push(campaignIdForResult
              ? `/leads?campaign_id=${campaignIdForResult}` : "/leads")}
              className="bg-zinc-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-zinc-800">
              View leads →
            </button>
            {assignResult && (
              <button onClick={() => router.push("/calls/queue")}
                className="bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-emerald-800">
                Open caller queue →
              </button>
            )}
            <button onClick={() => {
              setPreview(null); setResult(null); setFile(null);
              setCampaignName(""); setCity(""); setAssignResult(null); setNewLeadIds([]);
            }}
              className="bg-white border border-zinc-200 hover:bg-zinc-50 rounded-lg px-4 py-2 text-sm">
              Import another file
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function StatBox({ label, value, negative = false, highlight = false }: {
  label: string; value: number; negative?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-emerald-100" : "bg-zinc-50"}`}>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={`text-2xl font-semibold ${negative ? "text-red-600" : highlight ? "text-emerald-800" : "text-zinc-900"}`}>
        {value}
      </dd>
    </div>
  );
}
