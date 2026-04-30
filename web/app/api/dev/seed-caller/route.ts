// POST /api/dev/seed-caller — admin-only.
// Creates a fake caller auth user (or upserts into users_meta) so we can
// test RLS isolation without a second human.
//
// Body (optional): { email?: string, displayName?: string }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  email: z.string().email().optional(),
  displayName: z.string().optional(),
}).optional();

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body> | undefined;
  try { body = Body.parse(await request.json().catch(() => ({}))); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const email = body?.email ?? "gaylord+seed@socleacquisitions.com";
  const displayName = body?.displayName ?? "Gaylord (seed)";

  const sb = createSupabaseAdminClient();

  // Try to create the auth user via service role admin API. If they already
  // exist, fall back to looking up the existing one.
  let userId: string | null = null;
  let created = false;
  const created_resp = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
    app_metadata: { role: "caller" },
  });
  if (created_resp.data?.user) {
    userId = created_resp.data.user.id;
    created = true;
  } else {
    // Already exists — find them
    const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list.data?.users?.find((u: { email?: string }) => u.email === email);
    if (existing) userId = existing.id;
  }

  if (!userId) {
    return NextResponse.json({ ok: false, error: "Could not create or find seed user" }, { status: 500 });
  }

  // Upsert users_meta + ensure app_metadata.role is caller
  await sb.from("users_meta").upsert({
    user_id: userId,
    display_name: displayName,
    role: "caller",
  });
  await sb.auth.admin.updateUserById(userId, {
    app_metadata: { role: "caller" },
  });

  await sb.from("automation_events").insert({
    source: "system", event_type: "seed_caller", status: "success",
    triggered_by: auth.user.id, payload: { email, displayName, created, userId },
  });

  return NextResponse.json({
    ok: true,
    data: {
      userId, email, displayName, created,
      hint: created
        ? "Caller created. They cannot sign in (no password set). Use seed-leads to assign them work, then test RLS by querying /api/leads with their JWT."
        : "Caller already existed; metadata refreshed.",
    },
  });
}
