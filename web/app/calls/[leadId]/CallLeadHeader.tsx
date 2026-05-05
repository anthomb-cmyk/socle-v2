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
  const pillKey =
    lead.status === "no_answer" ? "sans-reponse"
    : lead.status === "in_outreach" ? "contacte"
    : lead.status === "phone_verified" ? "a-appeler"
    : "nouveau";

  return (
    <>
      <Link href="/calls/queue" className="crm-caller-back">
        ← {t.workspace.backToQueue}
      </Link>
      <header className="crm-caller-header">
        <h1 className="crm-caller-header__name">
          {lead.full_name ?? lead.company_name ?? "—"}
        </h1>
        <p className="crm-caller-header__address">
          {lead.address}
          {lead.city ? `, ${lead.city}` : ""}
        </p>
        <div className="crm-caller-header__meta">
          {lead.num_units != null && <span className="crm-chip crm-chip-units">{lead.num_units} log.</span>}
          {lead.contact_kind && <span>{lead.contact_kind}</span>}
          <span className={`crm-pill crm-pill--${pillKey}`}>{statusLabel}</span>
          {lead.campaign_name && <span>· {lead.campaign_name}</span>}
        </div>
      </header>
    </>
  );
}
