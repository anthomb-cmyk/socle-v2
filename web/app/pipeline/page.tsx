// /pipeline — Deals acquisition pipeline (kanban view)
// Stages: Prospection → Analyse → Offre → Due Diligence → Financement
// Closed stages (Clôturé / Abandonné) accessible via a filter toggle

import { createSupabaseAdminClient } from "@/lib/supabase-server";
import PipelineClient from "./PipelineClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PipelinePage() {
  const sb = createSupabaseAdminClient();

  // Fetch all active deals (not closed/abandoned)
  const { data: deals } = await sb
    .from("deals")
    .select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,checklists,activities,updated_at")
    .not("stage", "in", '("cloture","abandonne")')
    .order("updated_at", { ascending: false });

  // Closed deals for toggle
  const { data: closedDeals } = await sb
    .from("deals")
    .select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,checklists,activities,updated_at")
    .in("stage", ["cloture","abandonne"])
    .order("updated_at", { ascending: false })
    .limit(20);

  return (
    <PipelineClient
      initialDeals={deals ?? []}
      closedDeals={closedDeals ?? []}
    />
  );
}
