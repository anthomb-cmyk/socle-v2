"use client";
// Translated header for the call workspace page.
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

type Lead = {
  full_name: string | null;
  company_name: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  contact_kind: string | null;
  status: string;
  campaign_name: string | null;
};

export default function CallLeadHeader({ lead }: { lead: Lead }) {
  const { t } = useLocale();
  const statusLabel = t.status[lead.status] ?? lead.status;

  return (
    <>
      <Link href="/calls/queue" className="text-sm text-zinc-500 hover:underline">
        ← {t.workspace.backToQueue}
      </Link>
      <header className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold">
          {lead.full_name ?? lead.company_name ?? "—"}
        </h1>
        <p className="text-zinc-600">
          {lead.address}
          {lead.city ? `, ${lead.city}` : ""}
        </p>
        <p className="text-sm text-zinc-500 mt-1">
          {lead.num_units != null && <>{lead.num_units} {lead.num_units === 1 ? "log." : "log."} · </>}
          {lead.contact_kind} · <span className="font-medium">{statusLabel}</span>
          {lead.campaign_name && <> · {lead.campaign_name}</>}
        </p>
      </header>
    </>
  );
}
