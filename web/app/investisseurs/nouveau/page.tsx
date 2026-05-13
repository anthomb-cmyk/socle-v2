"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function NewInvestorPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    firm_name: "",
    email: "",
    phone_e164: "",
    city: "",
    status: "prospect",
    source: "",
    capital_available_cad: "",
    ticket_size_min_cad: "",
    ticket_size_max_cad: "",
    preferred_geography: "",
    asset_class_focus: "",
    notes: "",
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      // Coerce empty strings → null; numeric fields → numbers
      for (const k of Object.keys(payload)) {
        if (payload[k] === "") payload[k] = null;
      }
      for (const k of ["capital_available_cad", "ticket_size_min_cad", "ticket_size_max_cad"]) {
        if (payload[k] != null) payload[k] = Number(payload[k]);
      }
      const res = await fetch("/api/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "Erreur de création");
      router.push(`/investisseurs/${j.data.id}` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <Link href={"/investisseurs" as never} className="text-sm text-zinc-500 hover:underline">
          ← Investisseurs
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Nouvel investisseur</h1>
      </header>

      <form onSubmit={onSubmit} className="space-y-4 bg-white rounded-2xl border border-zinc-200 p-5">
        <Field label="Nom complet *" required>
          <input
            required
            value={form.full_name}
            onChange={(e) => update("full_name", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Firme">
            <input
              value={form.firm_name}
              onChange={(e) => update("firm_name", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Ville">
            <input
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Téléphone (E.164)">
            <input
              placeholder="+15145551234"
              value={form.phone_e164}
              onChange={(e) => update("phone_e164", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Statut">
            <select
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="prospect">Prospect</option>
              <option value="active">Actif</option>
              <option value="inactive">Inactif</option>
              <option value="lost">Perdu</option>
            </select>
          </Field>
          <Field label="Source">
            <input
              placeholder="ex. appel entrant, LinkedIn, intro…"
              value={form.source}
              onChange={(e) => update("source", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Capital dispo (CAD)">
            <input
              type="number"
              value={form.capital_available_cad}
              onChange={(e) => update("capital_available_cad", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Ticket min (CAD)">
            <input
              type="number"
              value={form.ticket_size_min_cad}
              onChange={(e) => update("ticket_size_min_cad", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Ticket max (CAD)">
            <input
              type="number"
              value={form.ticket_size_max_cad}
              onChange={(e) => update("ticket_size_max_cad", e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <Field label="Géographie préférée">
          <input
            placeholder="Montréal, Estrie, Rive-Sud…"
            value={form.preferred_geography}
            onChange={(e) => update("preferred_geography", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Focus actif">
          <input
            placeholder="ex. multifamily 10-50 unités"
            value={form.asset_class_focus}
            onChange={(e) => update("asset_class_focus", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Notes">
          <textarea
            rows={4}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          />
        </Field>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href={"/investisseurs" as never}
            className="border border-zinc-300 rounded-lg px-4 py-2 text-sm"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="bg-zinc-900 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {submitting ? "Création…" : "Créer l'investisseur"}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}
