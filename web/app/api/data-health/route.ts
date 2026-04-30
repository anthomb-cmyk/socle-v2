// GET /api/data-health — admin only.
// One round-trip → all the dirty/stuck data signals.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const dayAgo = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);

  const [
    unassignedHotLeads,
    propertiesWithoutOwners,
    contactsWithoutPhones,
    failedAutomations,
    failedImports,
    overdueFollowUps,
    pendingProposed,
    openReviews,
    syncErrors,
    contactsWithPhonesRes,
    leadsAllRes,
  ] = await Promise.all([
    // Hot reviews + leads in motion that are unassigned
    sb.from("leads").select("id", { count: "exact", head: true })
      .in("status", ["in_outreach", "meeting_set", "qualified"])
      .is("assigned_to", null),
    sb.from("properties").select("id", { count: "exact", head: true })
      // a property with no property_contacts row of relationship='owner'
      // — we approximate via "properties.id NOT IN (...)" using an OR + RPC
      // would be cleaner, but for now: count properties with no rows in
      // property_contacts at all
      .not("id", "in", `(select property_id from property_contacts where relationship='owner')`),
    sb.from("contacts").select("id", { count: "exact", head: true })
      .not("id", "in", `(select contact_id from phones where contact_id is not null)`),
    sb.from("automation_events").select("id", { count: "exact", head: true })
      .eq("status", "failed").gte("occurred_at", dayAgo.toISOString()),
    sb.from("import_jobs").select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    sb.from("follow_ups").select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("due_at", todayStart.toISOString()),
    sb.from("proposed_actions").select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    sb.from("review_items").select("id", { count: "exact", head: true })
      .eq("status", "open"),
    sb.from("follow_ups").select("id", { count: "exact", head: true })
      .eq("sync_status", "error"),
    // Phones-by-contact + leads-by-contact for the leads-without-phone calc
    sb.from("phones").select("contact_id").not("contact_id", "is", null),
    sb.from("leads").select("contact_id"),
  ]);

  // Compute leads without any phone client-side (cheap at our scale).
  const withPhones = new Set(((contactsWithPhonesRes.data ?? []) as Array<{ contact_id: string | null }>)
    .map(p => p.contact_id).filter(Boolean) as string[]);
  const leadsNoPhoneCount = ((leadsAllRes.data ?? []) as Array<{ contact_id: string }>)
    .filter(l => !withPhones.has(l.contact_id)).length;

  return NextResponse.json({
    ok: true,
    data: {
      leadsWithoutPhone: leadsNoPhoneCount,
      unassignedHotLeads: unassignedHotLeads.count ?? 0,
      propertiesWithoutOwners: propertiesWithoutOwners.count ?? 0,
      contactsWithoutPhones: contactsWithoutPhones.count ?? 0,
      failedAutomations: failedAutomations.count ?? 0,
      failedImports: failedImports.count ?? 0,
      overdueFollowUps: overdueFollowUps.count ?? 0,
      pendingProposed: pendingProposed.count ?? 0,
      openReviews: openReviews.count ?? 0,
      syncErrors: syncErrors.count ?? 0,
    },
  });
}
