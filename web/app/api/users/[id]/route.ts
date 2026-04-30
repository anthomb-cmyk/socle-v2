// PATCH /api/users/[id] — admin only. Updates users_meta + mirrors role
// into auth.app_metadata (so JWT carries it on next sign-in).
//
// Body: { display_name?, role?, is_active?, telegram_user_id?, email? }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  display_name: z.string().nullable().optional(),
  role: z.enum(["admin", "manager", "caller", "cold_caller", "research_assistant", "viewer"]).optional(),
  is_active: z.boolean().optional(),
  telegram_user_id: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  twilio_forward_to: z.string().nullable().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // Upsert users_meta — if the row doesn't exist yet (new auth user not seen by
  // any UI yet), create it.
  const { data: existing } = await sb.from("users_meta").select("user_id").eq("user_id", id).maybeSingle();
  if (!existing) {
    await sb.from("users_meta").insert({
      user_id: id,
      display_name: body.display_name ?? null,
      role: body.role ?? "cold_caller",
      is_active: body.is_active ?? true,
      telegram_user_id: body.telegram_user_id ?? null,
      email: body.email ?? null,
      twilio_forward_to: body.twilio_forward_to ?? null,
    });
  } else {
    const update: Record<string, unknown> = {};
    if (body.display_name !== undefined) update.display_name = body.display_name;
    if (body.role !== undefined) update.role = body.role;
    if (body.is_active !== undefined) update.is_active = body.is_active;
    if (body.telegram_user_id !== undefined) update.telegram_user_id = body.telegram_user_id;
    if (body.email !== undefined) update.email = body.email;
    if (body.twilio_forward_to !== undefined) update.twilio_forward_to = body.twilio_forward_to;
    if (Object.keys(update).length > 0) {
      await sb.from("users_meta").update(update).eq("user_id", id);
    }
  }

  // Mirror role to auth.app_metadata so the JWT picks it up on next sign-in.
  if (body.role !== undefined) {
    try {
      await sb.auth.admin.updateUserById(id, { app_metadata: { role: body.role } });
    } catch (err) {
      // Non-fatal — users_meta is the truth; auth metadata is just a JWT echo.
      console.warn("[users.patch] failed to mirror role to app_metadata:", (err as Error).message);
    }
  }

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "user_updated", status: "success",
    triggered_by: auth.user.id, payload: { userId: id, changes: body },
  });

  return NextResponse.json({ ok: true });
}
