import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import ProposedActionsList from "./ProposedActionsList";

export default async function ReviewPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  const [reviewRes, proposedRes] = await Promise.all([
    sb.from("review_items")
      .select("id, title, summary, urgency, created_at, lead_id")
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    sb.from("proposed_actions")
      .select("id, action_type, target_table, target_id, proposed_change, rationale, confidence, source, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);
  const reviews = (reviewRes.data ?? []) as Array<{ id: string; title: string; summary: string | null; urgency: string; created_at: string; lead_id: string | null }>;
  const proposed = (proposedRes.data ?? []) as Array<{ id: string; action_type: string; target_table: string; target_id: string | null; proposed_change: Record<string, unknown>; rationale: string | null; confidence: number | null; source: string; created_at: string }>;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Review</h1>
          <p className="text-sm text-zinc-500">Hot sellers · proposed actions · ambiguous commands.</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/leads" className="border border-zinc-300 rounded-lg px-3 py-1.5">Leads</Link>
          <Link href="/import" className="bg-zinc-900 text-white rounded-lg px-3 py-1.5">Import</Link>
        </nav>
      </header>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-2">Review items ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center text-zinc-500">
            Nothing in your inbox.
          </div>
        ) : (
          <ul className="space-y-2">
            {reviews.map(it => (
              <li key={it.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold">{it.title}</h3>
                  <UrgencyPill urgency={it.urgency} />
                </div>
                {it.summary && <p className="text-sm text-zinc-700 whitespace-pre-wrap">{it.summary}</p>}
                <div className="text-xs text-zinc-500 mt-2 flex gap-4">
                  <span>{new Date(it.created_at).toLocaleString()}</span>
                  {it.lead_id && <Link href={`/leads/${it.lead_id}` as never} className="underline">Open lead →</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-2">Proposed actions ({proposed.length})</h2>
        <ProposedActionsList initial={proposed} />
      </section>
    </main>
  );
}

function UrgencyPill({ urgency }: { urgency: string }) {
  const colors: Record<string, string> = {
    urgent: "bg-red-100 text-red-800",
    high: "bg-amber-100 text-amber-800",
    normal: "bg-zinc-100 text-zinc-700",
    low: "bg-zinc-50 text-zinc-500",
  };
  return <span className={`text-xs uppercase tracking-wide rounded px-2 py-0.5 ${colors[urgency] ?? "bg-zinc-100"}`}>{urgency}</span>;
}
