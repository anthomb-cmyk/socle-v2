"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewLeadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    address: "", city: "", matricule: "", num_units: "",
    contactKind: "person" as "person" | "company" | "numbered_co" | "trust",
    fullName: "", companyName: "", phone: "", email: "",
    notes: "",
  });

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.address.trim()) { setError("Address required"); return; }
    if (form.contactKind === "person" && !form.fullName.trim()) { setError("Owner name required"); return; }
    if (form.contactKind !== "person" && !form.companyName.trim()) { setError("Company name required"); return; }

    setBusy(true); setError(null);
    // We use the n8n endpoint (without auth in dev) for the upsert logic;
    // but we want session-auth, so call /api/leads/manual-create instead.
    // For now, since /api/n8n/lead requires N8N_SHARED_KEY in prod, route via
    // a dedicated endpoint we'll wire below.
    const r = await fetch("/api/leads/manual-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property: {
          address: form.address.trim(),
          city: form.city.trim() || undefined,
          matricule: form.matricule.trim() || undefined,
          num_units: form.num_units ? parseInt(form.num_units, 10) : undefined,
        },
        contact: {
          kind: form.contactKind,
          full_name: form.contactKind === "person" ? form.fullName.trim() : undefined,
          company_name: form.contactKind !== "person" ? form.companyName.trim() : undefined,
          primary_email: form.email.trim() || undefined,
          primary_phone: form.phone.trim() || undefined,
        },
        phones: form.phone.trim() ? [form.phone.trim()] : undefined,
        lead: { notes: form.notes.trim() || undefined, source: "manual" },
      }),
    });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) { setError(j.error); return; }
    router.push(`/leads/${j.data.leadId}` as never);
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-700">Property</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Address *" wide>
          <input value={form.address} onChange={e => set("address", e.target.value)} required
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="1234 rue Notre-Dame" />
        </Field>
        <Field label="City">
          <input value={form.city} onChange={e => set("city", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Granby" />
        </Field>
        <Field label="Matricule">
          <input value={form.matricule} onChange={e => set("matricule", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm font-mono"
            placeholder="1234-56-7890-…" />
        </Field>
        <Field label="Units">
          <input type="number" value={form.num_units} onChange={e => set("num_units", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
        </Field>
      </div>

      <h2 className="text-sm font-semibold text-zinc-700 pt-2">Owner</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select value={form.contactKind} onChange={e => set("contactKind", e.target.value as typeof form.contactKind)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
            <option value="person">Person</option>
            <option value="company">Company</option>
            <option value="numbered_co">Numbered Co.</option>
            <option value="trust">Trust</option>
          </select>
        </Field>
        {form.contactKind === "person" ? (
          <Field label="Full name *">
            <input value={form.fullName} onChange={e => set("fullName", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Jean Tremblay" />
          </Field>
        ) : (
          <Field label="Company name *">
            <input value={form.companyName} onChange={e => set("companyName", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Gestion CML inc." />
          </Field>
        )}
        <Field label="Phone">
          <input value={form.phone} onChange={e => set("phone", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="(450) 555-0000" />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={e => set("email", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="owner@example.com" />
        </Field>
      </div>

      <Field label="Notes">
        <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={3}
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy}
          className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
          {busy ? "Creating…" : "Create lead"}
        </button>
        <button type="button" onClick={() => router.push("/leads")}
          className="border border-zinc-300 rounded-lg px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
