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

export async function notifyNewLead(opts: {
  leadId: string;
  ownerLabel: string | null;
  propertyLabel: string | null;
  source: string;
}): Promise<{ ok: boolean; appPush?: unknown; error?: string }> {
  const owner = opts.ownerLabel?.trim() || "Nouveau lead";
  const property = opts.propertyLabel?.trim();
  const result = await appPushNotifyAll({
    title: "Socle - nouveau lead",
    body: [
      owner,
      property ? `Propriete: ${property}` : "",
      opts.source ? `Source: ${opts.source}` : "",
    ].filter(Boolean).join("\n"),
    url: `/leads/${opts.leadId}`,
    tag: `new-lead-${opts.leadId}`,
  });

  return { ok: result.ok, appPush: result };
}

export async function notifyDueFollowUps(opts: {
  count: number;
  firstLabel: string | null;
  firstDueAt: string | null;
}): Promise<{ ok: boolean; appPush?: unknown; error?: string }> {
  if (opts.count <= 0) return { ok: true, appPush: { skipped: "no due follow-ups" } };
  const first = opts.firstLabel?.trim();
  const result = await appPushNotifyAll({
    title: opts.count === 1 ? "Socle - suivi du" : `Socle - ${opts.count} suivis dus`,
    body: [
      first ? `Premier: ${first}` : "Des suivis sont dus.",
      opts.firstDueAt ? `Du: ${new Date(opts.firstDueAt).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })}` : "",
    ].filter(Boolean).join("\n"),
    url: "/follow-ups?bucket=overdue",
    tag: "due-follow-ups",
  });

  return { ok: result.ok, appPush: result };
}
