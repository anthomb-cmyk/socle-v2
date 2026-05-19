import type { SupabaseClient } from "@supabase/supabase-js";
import webpush, { type PushSubscription } from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export type AppPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

let configured = false;

export function getVapidPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
}

function configureWebPush() {
  if (configured) return;
  const publicKey = getVapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:notifications@socleacquisitions.com";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

function toSubscription(row: PushSubscriptionRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

async function sendRows(
  sb: SupabaseClient,
  rows: PushSubscriptionRow[],
  payload: AppPushPayload,
) {
  if (rows.length === 0) return { sent: 0, failed: 0, stale: 0 };
  configureWebPush();

  let sent = 0;
  let failed = 0;
  let stale = 0;
  const body = JSON.stringify(payload);

  for (const row of rows) {
    try {
      await webpush.sendNotification(toSubscription(row), body);
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        stale += 1;
        await sb.from("push_subscriptions").delete().eq("id", row.id);
      }
    }
  }

  return { sent, failed, stale };
}

export async function sendPushToUser(
  sb: SupabaseClient,
  userId: string,
  payload: AppPushPayload,
) {
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("user_id", userId);

  if (error) throw error;
  return sendRows(sb, (data ?? []) as PushSubscriptionRow[], payload);
}

export async function sendPushToAllUsers(
  sb: SupabaseClient,
  payload: AppPushPayload,
) {
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth");

  if (error) throw error;
  return sendRows(sb, (data ?? []) as PushSubscriptionRow[], payload);
}

export async function appPushNotifyAll(payload: AppPushPayload): Promise<{
  ok: boolean;
  sent?: number;
  failed?: number;
  stale?: number;
  skipped?: string;
  error?: string;
}> {
  if (!getVapidPublicKey() || !process.env.VAPID_PRIVATE_KEY?.trim()) {
    return { ok: true, skipped: "VAPID keys missing" };
  }

  try {
    const sb = createSupabaseAdminClient();
    const result = await sendPushToAllUsers(sb, payload);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
