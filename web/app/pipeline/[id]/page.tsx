// /pipeline/[id] — Deal workspace

import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import DealWorkspaceClient, { type Deal, type DealDocument } from "./DealWorkspaceClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DealWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createSupabaseAdminClient();

  const [{ data: deal }, { data: docs }] = await Promise.all([
    sb.from("deals").select("*").eq("id", id).single(),
    sb.from("deal_documents").select("*").eq("deal_id", id).order("created_at", { ascending: false }),
  ]);

  if (!deal) notFound();

  return (
    <DealWorkspaceClient
      deal={deal as unknown as Deal}
      documents={(docs ?? []) as unknown as DealDocument[]}
    />
  );
}
