"use client";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

export default function PhoneReviewHeader({
  candidateCount,
  importLabel,
}: {
  candidateCount: number;
  importLabel?: string | null;
}) {
  const { t } = useLocale();

  return (
    <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
      <div>
        <h1 className="crm-page-title">{t.review.title}</h1>
        <p className="crm-page-sub">
          {candidateCount === 0
            ? t.review.empty
            : t.review.candidateCount(candidateCount)}
          {importLabel ? ` · ${importLabel}` : ""}
        </p>
      </div>
      <nav style={{ display: "flex", gap: 8 }}>
        <Link href="/leads" className="crm-btn">Leads</Link>
        <Link href="/review" className="crm-btn">Revue</Link>
      </nav>
    </header>
  );
}
