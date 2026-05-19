import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { sendPushToUser } from "@/lib/notifications/web-push";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();
  const result = await sendPushToUser(sb, auth.user.id, {
    title: "Socle",
    body: "Notifications iPhone activees.",
    url: "/",
    tag: "socle-push-test",
  });

  return NextResponse.json({ ok: true, result });
}
