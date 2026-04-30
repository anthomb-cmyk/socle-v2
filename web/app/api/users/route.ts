// GET /api/users — list workspace users (admin sees all, caller sees self only).
// When admin, also hydrates with email + last_sign_in_at from auth.users.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  const sb = createSupabaseAdminClient();
  let query = sb.from("users_meta")
    .select("user_id, display_name, role, is_active, telegram_user_id, email, twilio_forward_to, created_at")
    .order("display_name");
  if (role !== "admin") query = query.eq("user_id", user.id);
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hydrated: any[] = data ?? [];
  if (role === "admin") {
    // Pull auth.users for email + sign-in stats — service-role only
    try {
      const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      const byId = new Map<string, { email?: string; last_sign_in_at?: string; created_at?: string }>(
        (list.data?.users ?? []).map(u => [u.id, { email: u.email, last_sign_in_at: u.last_sign_in_at, created_at: u.created_at }]),
      );
      const seen = new Set((data ?? []).map((d: { user_id: string }) => d.user_id));
      const orphans = (list.data?.users ?? []).filter(u => !seen.has(u.id)).map(u => ({
        user_id: u.id,
        display_name: null,
        role: ((u.app_metadata?.role as string) ?? "cold_caller"),
        is_active: true,
        telegram_user_id: null,
        email: u.email ?? null,
        twilio_forward_to: null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        _orphan: true,
      }));
      const merged = (data ?? []).map((d: Record<string, unknown>) => ({
        ...d,
        email: (d.email as string | null | undefined) ?? byId.get(d.user_id as string)?.email ?? null,
        last_sign_in_at: byId.get(d.user_id as string)?.last_sign_in_at ?? null,
      }));
      hydrated = [...merged, ...orphans];
    } catch (err) {
      console.warn("[users.GET] auth admin listUsers failed:", (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true, data: hydrated });
}
