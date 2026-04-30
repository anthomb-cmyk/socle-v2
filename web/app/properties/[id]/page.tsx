import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function PropertyDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  const [propRes, leadsRes, ownersRes] = await Promise.all([
    sb.from("properties").select("*").eq("id", id).single(),
    sb.from("leads_view").select("*").eq("property_id", id),
    sb.from("property_contacts").select("relationship, share_pct, contact_id").eq("property_id", id),
  ]);
  const property = propRes.data as Record<string, unknown> | null;
  if (!property) return notFound();
  const leads = (leadsRes.data ?? []) as Array<{ lead_id: string; full_name: string | null; company_name: string | null; status: string; assigned_to: string | null }>;
  const ownerLinks = (ownersRes.data ?? []) as Array<{ relationship: string; share_pct: number | null; contact_id: string }>;
  let ownerInfo: Record<string, { full_name: string | null; company_name: string | null; kind: string }> = {};
  if (ownerLinks.length > 0) {
    const ids = ownerLinks.map(o => o.contact_id);
    const { data: contacts } = await sb.from("contacts").select("id, full_name, company_name, kind").in("id", ids);
    ownerInfo = Object.fromEntries(((contacts ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null; kind: string }>).map(c => [c.id, c]));
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <Link href="/properties" className="text-sm text-zinc-500 hover:underline">← Back to properties</Link>
      <header>
        <h1 className="text-2xl font-semibold">{property.address as string}</h1>
        <p className="text-sm text-zinc-500">{(property.city as string) ?? "—"} · matricule {(property.matricule as string) ?? "—"}</p>
      </header>

      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Property facts</h2>
        <dl className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm">
          <Dt>Year built</Dt><Dd>{(property.year_built as number) ?? "—"}</Dd>
          <Dt>Units</Dt><Dd>{(property.num_units as number) ?? "—"}</Dd>
          <Dt>Lot area</Dt><Dd>{(property.lot_area_m2 as number) ?? "—"}</Dd>
          <Dt>Building area</Dt><Dd>{(property.building_area_m2 as number) ?? "—"}</Dd>
          <Dt>Eval total</Dt><Dd>{property.evaluation_total ? `$${Number(property.evaluation_total).toLocaleString()}` : "—"}</Dd>
          <Dt>Eval year</Dt><Dd>{(property.evaluation_year as number) ?? "—"}</Dd>
        </dl>
      </section>

      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Owners ({ownerLinks.length})</h2>
        <ul className="text-sm space-y-1">
          {ownerLinks.map(o => {
            const c = ownerInfo[o.contact_id];
            return (
              <li key={o.contact_id} className="flex justify-between">
                <span>{c?.full_name ?? c?.company_name ?? "—"} <span className="text-zinc-400">({o.relationship}{o.share_pct ? ` · ${o.share_pct}%` : ""})</span></span>
                <Link href={`/contacts` as never} className="text-xs text-zinc-500 hover:underline">view contact</Link>
              </li>
            );
          })}
          {ownerLinks.length === 0 && <li className="text-zinc-400">No owners linked.</li>}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Leads on this property ({leads.length})</h2>
        {leads.length === 0 ? <p className="text-zinc-400 text-sm">No leads.</p> : (
          <ul className="text-sm space-y-1">
            {leads.map(l => (
              <li key={l.lead_id} className="flex justify-between">
                <Link href={`/leads/${l.lead_id}` as never} className="hover:underline">
                  {l.full_name ?? l.company_name ?? "—"}
                </Link>
                <span className="text-xs text-zinc-500">{l.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Dt({ children }: { children: React.ReactNode }) { return <dt className="text-zinc-500">{children}</dt>; }
function Dd({ children }: { children: React.ReactNode }) { return <dd>{children}</dd>; }
