import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { getQuickCallRecents } from "@/lib/quick-call/recents";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();
  const recents = await getQuickCallRecents(sb);
  return NextResponse.json({ ok: true, data: recents });
}
