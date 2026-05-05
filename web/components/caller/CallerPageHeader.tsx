import Link from "next/link";
import * as React from "react";

type BackLink = { href: string; label: string };

type Props = {
  /** Required page title. */
  title: string;
  /** Optional subtitle, rendered below the title. */
  subtitle?: React.ReactNode;
  /** Optional back link rendered above the title row. */
  back?: BackLink;
  /** Optional right-aligned actions (buttons/links). */
  actions?: React.ReactNode;
};

/**
 * Page header for caller-module routes — back link + title + subtitle +
 * right-aligned actions slot. Server component (no hooks).
 *
 * Created in Phase 2 as part of the shell foundation. Phases 3-7 will
 * wire it into the queue / workspace / phone-review / follow-ups pages
 * as those screens are redesigned.
 */
export default function CallerPageHeader({ title, subtitle, back, actions }: Props) {
  return (
    <div className="so-page-header">
      {back ? (
        <Link href={back.href as never} className="so-page-header__back">
          ← {back.label}
        </Link>
      ) : null}
      <div className="so-page-header__row">
        <div className="so-page-header__titles">
          <h1 className="so-page-header__title">{title}</h1>
          {subtitle ? <p className="so-page-header__sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="so-page-header__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
