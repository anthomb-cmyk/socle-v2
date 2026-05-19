import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { getQuickCallRecents } from "@/lib/quick-call/recents";
import PhoneClient from "./PhoneClient";

export const metadata: Metadata = {
  title: "Téléphone — Socle CRM",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function QuickCallPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const initialTabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab: "keypad" | "recents" = initialTabRaw === "recents" ? "recents" : "keypad";

  // Fetch the 50 most recent inbound + outbound calls so the Récents
  // tab shows real data immediately (like the iOS Phone Recents tab).
  const sb = createSupabaseAdminClient();
  const recents = await getQuickCallRecents(sb);

  return <PhoneClient initialTab={initialTab} recents={recents} />;
}
