import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const Body = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Invalid push subscription", details: (error as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();
  const { error } = await sb.from("push_subscriptions").upsert({
    user_id: auth.user.id,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    expiration_time: body.expirationTime ?? null,
    user_agent: request.headers.get("user-agent") ?? null,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
