"use client";
import { useLocale } from "@/components/locale-provider";

export default function PhoneReviewRules() {
  const { t, locale } = useLocale();
  return (
    <div style={{ fontSize: 11, color: "var(--crm-text3)", background: "var(--crm-bg-alt)", border: "1px solid var(--crm-card-border)", borderRadius: 10, padding: "8px 14px" }}>
      <strong style={{ color: "var(--crm-text2)" }}>{locale === "fr" ? "Règles :" : "Rules:"}</strong>{" "}
      {t.review.rules}
    </div>
  );
}
