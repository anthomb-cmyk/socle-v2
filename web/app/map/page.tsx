import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { DealMapClient, type DealMapDeal } from "./DealMapClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function stageOrder(stage: string): number {
  return ["prospection", "analyse", "offre", "due_diligence", "financement", "cloture", "abandonne"].indexOf(stage);
}

export default async function MapPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();
  let query = sb
    .from("deals")
    .select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,lat,lng,assigned_to,updated_at")
    .not("stage", "in", '("cloture","abandonne")')
    .order("updated_at", { ascending: false })
    .limit(500);

  if (role !== "admin") query = query.eq("assigned_to", user.id);

  const { data } = await query;
  const deals = ((data ?? []) as unknown as DealMapDeal[])
    .sort((a, b) => {
      const stageDiff = stageOrder(a.stage) - stageOrder(b.stage);
      if (stageDiff !== 0) return stageDiff;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  return <DealMapClient deals={deals} />;
}
