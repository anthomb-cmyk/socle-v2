import { appPushNotifyAll } from "@/lib/notifications/web-push";

function shortPhoneLabel(label: string, phone: string) {
  const cleanLabel = label.trim();
  if (cleanLabel && cleanLabel !== phone) return `${cleanLabel} (${phone})`;
  return phone || "Numero inconnu";
}

export async function notifyInboundPhoneCall(opts: {
  from: string;
  to: string;
  callerLabel: string;
  matchType: string;
  appUrl: string;
}): Promise<{ ok: boolean; appPush?: unknown; error?: string }> {
  const caller = shortPhoneLabel(opts.callerLabel, opts.from);
  const link = `${opts.appUrl.replace(/\/$/, "")}/quick-call?tab=recents`;

  const body = [
    `Appel entrant de ${caller}`,
    opts.matchType !== "unmatched" ? `Match: ${opts.matchType}` : "Aucun contact lie",
    opts.to ? `Numero Socle: ${opts.to}` : "",
  ].filter(Boolean).join("\n");

  const appPush = await appPushNotifyAll({
    title: "Socle - appel entrant",
    body,
    url: link,
    tag: `inbound-call-${opts.from || Date.now()}`,
  });

  return {
    ok: appPush.ok,
    appPush,
  };
}

export async function notifyInboundSms(opts: {
  from: string;
  senderLabel: string;
  body: string;
  appUrl: string;
}): Promise<{ ok: boolean; appPush?: unknown; error?: string }> {
  const sender = shortPhoneLabel(opts.senderLabel, opts.from);
  const preview = opts.body.trim() || "(message vide)";
  const result = await appPushNotifyAll({
    title: "Socle - SMS entrant",
    body: `SMS de ${sender}\n${preview.slice(0, 180)}`,
    url: `${opts.appUrl.replace(/\/$/, "")}/textos`,
    tag: `inbound-sms-${opts.from || Date.now()}`,
  });

  return { ok: result.ok, appPush: result };
}
