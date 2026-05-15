import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export type PhoneEnrichmentOperatorAuth =
  | {
      ok: true;
      userId: string | null;
      actor: "admin" | "codex_operator_key" | "codex_session";
      sessionId?: string;
      importJobId?: string;
    }
  | { ok: false; response: NextResponse };

export function createCodexSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCodexSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function touchCodexSession(sessionId: string): Promise<void> {
  const sb = createSupabaseAdminClient();
  await sb
    .from("codex_sessions")
    .update({ last_action_at: new Date().toISOString() })
    .eq("id", sessionId);
}

export async function requirePhoneEnrichmentOperator(
  request: Request,
  importJobId?: string,
): Promise<PhoneEnrichmentOperatorAuth> {
  const sessionToken = request.headers.get("x-socle-codex-session-token") ?? "";
  if (sessionToken) {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("codex_sessions")
      .select("id,import_job_id,status,expires_at")
      .eq("token_hash", hashCodexSessionToken(sessionToken))
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: error.message }, { status: 500 }),
      };
    }

    const session = data as {
      id: string;
      import_job_id: string;
      status: string;
      expires_at: string;
    } | null;

    if (!session || session.status !== "active" || new Date(session.expires_at).getTime() <= Date.now()) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "Codex session token is invalid or expired." }, { status: 401 }),
      };
    }

    if (importJobId && session.import_job_id !== importJobId) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "Codex session token is scoped to another import." }, { status: 403 }),
      };
    }

    return {
      ok: true,
      userId: null,
      actor: "codex_session",
      sessionId: session.id,
      importJobId: session.import_job_id,
    };
  }

  const operatorKey = process.env.SOCLE_CODEX_OPERATOR_KEY ?? "";
  const presentedKey = request.headers.get("x-socle-codex-operator-key") ?? request.headers.get("x-service-key") ?? "";

  if (operatorKey && presentedKey && presentedKey === operatorKey) {
    return { ok: true, userId: null, actor: "codex_operator_key" };
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.user.id, actor: "admin" };
}
