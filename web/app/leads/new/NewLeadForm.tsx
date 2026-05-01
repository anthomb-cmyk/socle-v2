"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Campaign = { id: string; name: string; city: string | null };
type User = { user_id: string; display_name: string | null; role: string };

const CONTACT_KINDS = [
  { value: "person",      label: "Person" },
  { value: "company",     label: "Company / Inc." },
  { value: "numbered_co", label: "Numbered Co." },
  { value: "trust",       label: "Trust" },
  { value: "unknown",     label: "Unknown" },
] as const;

const initialForm = {
  // Property
  address: "", city: "", postal_code: "", matricule: "",
  num_units: "", year_built: "",
  evaluation_total: "", evaluation_land: "", evaluation_bldg: "",
  // Primary contact
  contactKind: "person" as "person" | "company" | "numbered_co" | "trust" | "unknown",
  fullName: "", companyName: "",
  email: "",
  mailingAddress: "", mailingCity: "", mailingPostal: "",
  // Secondary contact
  showSecondary: false,
  secKind: "person" as "person" | "company" | "numbered_co" | "trust" | "unknown",
  secFullName: "", secCompanyName: "", secEmail: "",
  // Phones
  phone: "",
  // Lead
  notes: "", priority: "50",
  campaignId: "", assignedTo: "",
};

function parseOptionalInt(s: string) { const n = parseInt(s, 10); return isNaN(n) ? undefined : n; }
function parseOptionalFloat(s: string) { const n = parseFloat(s); return isNaN(n) ? undefined : n; }

export default function NewLeadForm({ campaigns, users }: { campaigns: Campaign[]; users: User[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(initialForm);

  function set<K extends keyof typeof initialForm>(k: K, v: typeof initialForm[K]) {
    setF(prev => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate
    if (!f.address.trim()) { setError("Property address is required."); return; }
    const isPersonKind = f.contactKind === "person";
    if (isPersonKind && !f.fullName.trim()) { setError("Owner full name is required for person contacts."); return; }
    if (!isPersonKind && !f.companyName.trim()) { setError("Company / entity name is required."); return; }
    // For company types, also allow a full_name (e.g. the rep/principal) — it's optional

    setBusy(true);

    // Build secondary contact if shown and filled
    const hasSecondary = f.showSecondary && (f.secFullName.trim() || f.secCompanyName.trim());
    const secondaryContact = hasSecondary ? {
      kind: f.secKind,
      full_name: f.secFullName.trim() || undefined,
      company_name: f.secCompanyName.trim() || undefined,
      primary_email: f.secEmail.trim() || undefined,
    } : undefined;

    const phones: string[] = [];
    if (f.phone.trim()) phones.push(f.phone.trim());

    const payload = {
      property: {
        address: f.address.trim(),
        city: f.city.trim() || undefined,
        postal_code: f.postal_code.trim() || undefined,
        matricule: f.matricule.trim() || undefined,
        num_units: parseOptionalInt(f.num_units),
        year_built: parseOptionalInt(f.year_built),
        evaluation_total: parseOptionalFloat(f.evaluation_total),
        evaluation_land: parseOptionalFloat(f.evaluation_land),
        evaluation_bldg: parseOptionalFloat(f.evaluation_bldg),
      },
      contact: {
        kind: f.contactKind,
        // For persons: full_name is the primary key.
        // For companies/numbered_co: company_name is primary, full_name holds the rep/contact person.
        full_name: f.fullName.trim() || undefined,
        company_name: !isPersonKind ? (f.companyName.trim() || undefined) : undefined,
        primary_email: f.email.trim() || undefined,
        mailing_address: f.mailingAddress.trim() || undefined,
        mailing_city: f.mailingCity.trim() || undefined,
        mailing_postal: f.mailingPostal.trim() || undefined,
      },
      secondary_contact: secondaryContact,
      phones: phones.length > 0 ? phones : undefined,
      lead: {
        notes: f.notes.trim() || undefined,
        priority: parseOptionalInt(f.priority) ?? 50,
        source: "manual",
        campaign_id: f.campaignId || undefined,
        assigned_to: f.assignedTo || undefined,
      },
    };

    const r = await fetch("/api/leads/manual-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let j: { ok: boolean; error?: string; errors?: unknown[]; data?: { leadId: string } };
    try { j = await r.json(); }
    catch { setBusy(false); setError("Server returned an unexpected response."); return; }

    setBusy(false);

    if (!j.ok) {
      const detail = j.errors ? ` (${JSON.stringify(j.errors).slice(0, 200)})` : "";
      setError((j.error ?? "Unknown error") + detail);
      return;
    }

    router.push(`/leads/${j.data!.leadId}` as never);
  }

  return (
    <form onSubmit={submit} className="space-y-6">

      {/* ─── Property ─── */}
      <Section title="Property">
        <Grid cols={2}>
          <F label="Street address *" wide>
            <Input value={f.address} onChange={v => set("address", v)} placeholder="3661-3667 rue de Mont-Royal" required />
          </F>
          <F label="City">
            <Input value={f.city} onChange={v => set("city", v)} placeholder="Longueuil" />
          </F>
          <F label="Postal code">
            <Input value={f.postal_code} onChange={v => set("postal_code", v)} placeholder="J4T 2G9" mono />
          </F>
          <F label="Matricule">
            <Input value={f.matricule} onChange={v => set("matricule", v)} placeholder="0638-99-8626" mono />
          </F>
          <F label="Units">
            <Input type="number" value={f.num_units} onChange={v => set("num_units", v)} placeholder="5" />
          </F>
          <F label="Year built">
            <Input type="number" value={f.year_built} onChange={v => set("year_built", v)} placeholder="1958" />
          </F>
          <F label="Assessment total ($)">
            <Input type="number" value={f.evaluation_total} onChange={v => set("evaluation_total", v)} placeholder="727500" />
          </F>
          <F label="Land value ($)">
            <Input type="number" value={f.evaluation_land} onChange={v => set("evaluation_land", v)} placeholder="" />
          </F>
          <F label="Building value ($)">
            <Input type="number" value={f.evaluation_bldg} onChange={v => set("evaluation_bldg", v)} placeholder="" />
          </F>
        </Grid>
      </Section>

      {/* ─── Primary owner / contact ─── */}
      <Section title="Primary owner / contact">
        <Grid cols={2}>
          <F label="Kind">
            <select
              value={f.contactKind}
              onChange={e => set("contactKind", e.target.value as typeof f.contactKind)}
              className={INPUT_CLS}>
              {CONTACT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </F>
          {f.contactKind !== "person" ? (
            <F label="Company / entity name *">
              <Input value={f.companyName} onChange={v => set("companyName", v)} placeholder="W ZH INVESTISSEMENT INC." />
            </F>
          ) : (
            <F label="Full name *">
              <Input value={f.fullName} onChange={v => set("fullName", v)} placeholder="Jun Xia Wang" />
            </F>
          )}
          {f.contactKind !== "person" && (
            <F label="Contact person (optional)">
              <Input value={f.fullName} onChange={v => set("fullName", v)} placeholder="Jun Xia Wang" />
            </F>
          )}
          <F label="Email (optional)">
            <Input type="email" value={f.email} onChange={v => set("email", v)} placeholder="owner@example.com" />
          </F>
          <F label="Phone (optional)">
            <Input value={f.phone} onChange={v => set("phone", v)} placeholder="(450) 555-0000" />
          </F>
        </Grid>

        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Mailing address</p>
          <Grid cols={3}>
            <F label="Street" wide>
              <Input value={f.mailingAddress} onChange={v => set("mailingAddress", v)} placeholder="1755 chemin des Prairies" />
            </F>
            <F label="City">
              <Input value={f.mailingCity} onChange={v => set("mailingCity", v)} placeholder="Brossard" />
            </F>
            <F label="Postal code">
              <Input value={f.mailingPostal} onChange={v => set("mailingPostal", v)} placeholder="J4X 1G5" mono />
            </F>
          </Grid>
        </div>
      </Section>

      {/* ─── Secondary contact ─── */}
      <Section title="Secondary contact">
        {!f.showSecondary ? (
          <button
            type="button"
            onClick={() => set("showSecondary", true)}
            className="text-sm text-zinc-500 hover:text-zinc-800 border border-dashed border-zinc-300 rounded-lg px-3 py-2 w-full text-left">
            + Add secondary contact (co-owner, rep, spouse…)
          </button>
        ) : (
          <div>
            <Grid cols={2}>
              <F label="Kind">
                <select
                  value={f.secKind}
                  onChange={e => set("secKind", e.target.value as typeof f.secKind)}
                  className={INPUT_CLS}>
                  {CONTACT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </F>
              {f.secKind === "person" ? (
                <F label="Full name">
                  <Input value={f.secFullName} onChange={v => set("secFullName", v)} placeholder="Jason Zhang" />
                </F>
              ) : (
                <F label="Company name">
                  <Input value={f.secCompanyName} onChange={v => set("secCompanyName", v)} placeholder="Gestion XYZ inc." />
                </F>
              )}
              <F label="Email (optional)">
                <Input type="email" value={f.secEmail} onChange={v => set("secEmail", v)} placeholder="contact@example.com" />
              </F>
            </Grid>
            <button
              type="button"
              onClick={() => { set("showSecondary", false); setF(p => ({ ...p, secFullName: "", secCompanyName: "", secEmail: "" })); }}
              className="mt-2 text-xs text-zinc-400 hover:text-zinc-700">
              × Remove secondary contact
            </button>
          </div>
        )}
      </Section>

      {/* ─── Lead settings ─── */}
      <Section title="Lead settings">
        <Grid cols={2}>
          {campaigns.length > 0 && (
            <F label="Campaign (optional)">
              <select value={f.campaignId} onChange={e => set("campaignId", e.target.value)} className={INPUT_CLS}>
                <option value="">— no campaign —</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.city ? ` (${c.city})` : ""}</option>
                ))}
              </select>
            </F>
          )}
          {users.length > 0 && (
            <F label="Assign to (optional)">
              <select value={f.assignedTo} onChange={e => set("assignedTo", e.target.value)} className={INPUT_CLS}>
                <option value="">— unassigned —</option>
                {users.map(u => (
                  <option key={u.user_id} value={u.user_id}>{u.display_name ?? u.user_id} ({u.role})</option>
                ))}
              </select>
            </F>
          )}
          <F label={`Priority (${f.priority})`}>
            <input
              type="range" min={0} max={100} value={f.priority}
              onChange={e => set("priority", e.target.value)}
              className="w-full mt-2" />
          </F>
        </Grid>
        <F label="Notes" className="mt-3">
          <textarea
            value={f.notes}
            onChange={e => set("notes", e.target.value)}
            rows={3}
            className={INPUT_CLS}
            placeholder="Context, strategy, source of the lead, anything Anthony should remember…" />
        </F>
      </Section>

      {/* ─── Error + actions ─── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 whitespace-pre-wrap">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-lg px-5 py-2.5 text-sm font-medium">
          {busy ? "Creating…" : "Create lead"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/leads")}
          className="border border-zinc-300 hover:bg-zinc-50 rounded-lg px-4 py-2.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Shared design primitives ──────────────────────────────────────────────────

const INPUT_CLS = "w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

function Input({ value, onChange, placeholder, type = "text", required, mono }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; mono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className={`${INPUT_CLS}${mono ? " font-mono" : ""}`} />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-700">{title}</h2>
      {children}
    </div>
  );
}

function Grid({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) {
  return (
    <div className={`grid gap-3 ${cols === 3 ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
      {children}
    </div>
  );
}

function F({ label, children, wide, className = "" }: {
  label: string; children: React.ReactNode; wide?: boolean; className?: string;
}) {
  return (
    <div className={`${wide ? "sm:col-span-2" : ""} ${className}`}>
      <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
