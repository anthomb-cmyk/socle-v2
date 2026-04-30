// Auth helpers for API routes. Return-result pattern (never throw) so route
// handlers can compose cleanly. The previous throw-Response pattern caused
// Next.js to hang requests on the client when 401/403 fired.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase-server";
import type { User } from "@supabase/supabase-js";

export type Role =
  | "admin"
  | "manager"
  | "caller"               // legacy alias for cold_caller
  | "cold_caller"
  | "research_assistant"
  | "viewer";

export const ROLES: readonly Role[] = ["admin", "manager", "cold_caller", "research_assistant", "viewer", "caller"];

// "Caller-tier" roles are everyone who isn't admin — they all share the same
// RLS permissions today. Specialization (manager > caller > viewer) lands later.
export function isCallerTier(role: Role): boolean {
  return role !== "admin";
}

type Ok = {
  ok: true;
  user: User;
  role: Role;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
};
type Err = { ok: false; response: NextResponse };

export async function requireUser(): Promise<Ok | Err> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  const role = (user.app_metadata?.role ?? "caller") as Role;
  return { ok: true, user, role, supabase };
}

export async function requireAdmin(): Promise<Ok | Err> {
  const r = await requireUser();
  if (!r.ok) return r;
  if (r.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({
        ok: false,
        error: `Admin only (your role: ${r.role}). If you were just promoted, sign out and sign back in to refresh your JWT.`,
      }, { status: 403 }),
    };
  }
  return r;
}
