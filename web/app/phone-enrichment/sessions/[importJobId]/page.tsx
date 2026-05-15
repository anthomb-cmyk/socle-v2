import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import PhoneEnrichmentSessionClient from "./PhoneEnrichmentSessionClient";

export default async function PhoneEnrichmentSessionPage(
  { params }: { params: Promise<{ importJobId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "admin") redirect("/leads");

  const { importJobId } = await params;
  return <PhoneEnrichmentSessionClient importJobId={importJobId} />;
}
