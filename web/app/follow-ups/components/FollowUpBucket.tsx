"use client";
import * as React from "react";

type Props = {
  title: string;
  bucket: "overdue" | "today" | "upcoming";
  count: number;
  children: React.ReactNode;
};

/**
 * Phase 7 — bucket section wrapper for follow-ups. Pure presentation.
 * Renders a small uppercase title + count chip and slots a <ul> of
 * <FollowUpCard> elements as its children.
 */
export default function FollowUpBucket({ title, bucket, count, children }: Props) {
  return (
    <section className={`fu-bucket fu-bucket--${bucket}`}>
      <div className="fu-bucket__head">
        <span className="fu-bucket__title">{title}</span>
        <span className={`fu-bucket__count fu-bucket__count--${bucket}`}>{count}</span>
      </div>
      <ul className="fu-bucket__items">{children}</ul>
    </section>
  );
}
