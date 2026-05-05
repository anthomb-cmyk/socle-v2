import Link from "next/link";
import { Dict } from "@/lib/i18n";

type Props = {
  urgentReviews: number;
  overdueFu: number;
  t: Dict["dashboard"];
};

export default function UrgencyBanner({ urgentReviews, overdueFu, t }: Props) {
  return (
    <div className="dash-urgency">
      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="dash-urgency__eyebrow">{t.actionRequired}</div>
        <div className="dash-urgency__headline">
          {urgentReviews > 0 && (
            <span>{t.reviewUrgent(urgentReviews)}</span>
          )}
          {overdueFu > 0 && (
            <span style={{ color: "var(--so-warn)" }}>{t.followUpsOverdue(overdueFu)}</span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {urgentReviews > 0 && (
          <Link href="/review" className="so-btn so-btn-primary">{t.ctaReviews}</Link>
        )}
        {overdueFu > 0 && (
          <Link href={"/follow-ups?bucket=overdue" as never} className="so-btn so-btn-outline"
            style={{ borderColor: "var(--so-warn)", color: "var(--so-warn)" }}>
            {t.ctaFollowUps}
          </Link>
        )}
      </div>
    </div>
  );
}
