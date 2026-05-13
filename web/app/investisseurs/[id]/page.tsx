import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import InvestorDetailClient from "./InvestorDetailClient";

export default async function InvestorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  // Server-side initial fetch — client takes over for mutations
  const admin = createSupabaseAdminClient();
  const { data: investor } = await admin
    .from("investors")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!investor) notFound();

  // The supabase admin client returns loose row types; the detail client owns
  // the strict Investor shape and the API routes enforce it on every write.
  return <InvestorDetailClient initialInvestor={investor as Parameters<typeof InvestorDetailClient>[0]["initialInvestor"]} />;
}
