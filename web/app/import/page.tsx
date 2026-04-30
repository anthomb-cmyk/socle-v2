"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type PreviewSummary = {
  jobId: string;
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

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Counts | null>(null);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null); setBusy(true); setPreview(null); setResult(null);

    const fd = new FormData();
    fd.append("file", file);
    if (campaignName) fd.append("campaignName", campaignName);
    if (city) fd.append("city", city);

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
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import a rôle</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Upload a Québec rôle XLSX. We&rsquo;ll parse it, show you a preview, then write to the database when you confirm.
        </p>
      </div>

      <form onSubmit={onUpload} className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">XLSX file</label>
          <input type="file" accept=".xlsx,.xls"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Campaign name <span className="text-zinc-400 font-normal">(optional)</span></label>
            <input type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)}
              placeholder="e.g. Granby rôle April 2026"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">City <span className="text-zinc-400 font-normal">(optional)</span></label>
            <input type="text" value={city} onChange={e => setCity(e.target.value)}
              placeholder="e.g. Granby"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <button type="submit" disabled={busy || !file}
          className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
          {busy ? "Parsing…" : "Parse and preview"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {preview && !result && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Preview</h2>
            <p className="text-sm text-zinc-500">Format: <code className="bg-zinc-100 px-1 rounded">{preview.format}</code> · {preview.totalRows} rows scanned</p>
          </div>
          <dl className="grid grid-cols-4 gap-4 text-sm">
            <Stat label="Properties" value={preview.summary.properties} />
            <Stat label="Owners" value={preview.summary.owners} />
            <Stat label="Phones" value={preview.summary.phones} />
            <Stat label="Errors" value={preview.errorsCount} negative={preview.errorsCount > 0} />
          </dl>
          {preview.summary.cities.length > 0 && (
            <p className="text-sm text-zinc-600">Cities detected: {preview.summary.cities.slice(0, 8).join(", ")}{preview.summary.cities.length > 8 ? "…" : ""}</p>
          )}
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr><th className="text-left p-2">#</th><th className="text-left p-2">Address</th><th className="text-left p-2">City</th><th className="text-left p-2">Owners</th><th className="text-left p-2">Phones</th></tr>
              </thead>
              <tbody>
                {preview.previewRows.map(r => (
                  <tr key={r.row} className="border-t border-zinc-100">
                    <td className="p-2 text-zinc-400">{r.row}</td>
                    <td className="p-2">{r.address}</td>
                    <td className="p-2">{r.city ?? <span className="text-zinc-400">—</span>}</td>
                    <td className="p-2">{r.owners.map(o => o.name).join("; ") || <span className="text-zinc-400">none</span>}</td>
                    <td className="p-2 font-mono text-xs">{r.owners.flatMap(o => o.phones).slice(0, 2).join(" ") || <span className="text-zinc-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.totalRows > 10 && <p className="p-2 text-xs text-zinc-400 bg-zinc-50">Showing first 10 of {preview.totalRows} rows.</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={onConfirm} disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
              {busy ? "Importing…" : "Confirm import"}
            </button>
            <button onClick={() => { setPreview(null); setFile(null); }} disabled={busy}
              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-lg px-4 py-2 text-sm font-medium">Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-semibold text-emerald-900">Import complete</h2>
          <dl className="grid grid-cols-4 gap-4 text-sm">
            <Stat label="Properties created" value={result.properties_created} />
            <Stat label="Properties updated" value={result.properties_updated} />
            <Stat label="Contacts created" value={result.contacts_created} />
            <Stat label="Contacts updated" value={result.contacts_updated} />
            <Stat label="Phones created" value={result.phones_created} />
            <Stat label="Leads created" value={result.leads_created} />
            <Stat label="Leads updated" value={result.leads_updated} />
            <Stat label="Errors" value={result.errors.length} negative={result.errors.length > 0} />
          </dl>
          <div className="flex gap-2 pt-2">
            <button onClick={() => router.push("/leads")} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg px-4 py-2 text-sm font-medium">
              View leads →
            </button>
            <button onClick={() => { setPreview(null); setResult(null); setFile(null); }}
              className="bg-white border border-zinc-200 hover:bg-zinc-50 rounded-lg px-4 py-2 text-sm font-medium">
              Import another file
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, negative = false }: { label: string; value: number; negative?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={`text-xl font-semibold ${negative ? "text-red-600" : "text-zinc-900"}`}>{value}</dd>
    </div>
  );
}
