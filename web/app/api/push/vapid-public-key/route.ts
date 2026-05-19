import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getVapidPublicKey } from "@/lib/notifications/web-push";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const publicKey = getVapidPublicKey();
  return NextResponse.json({
    ok: true,
    enabled: Boolean(publicKey),
    publicKey,
  });
}
