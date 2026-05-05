"use client";
import * as React from "react";

type Props = {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
};

export default function CallerField({ label, hint, children }: Props) {
  return (
    <div className="crm-field">
      <label className="crm-field-label">{label}</label>
      {children}
      {hint ? <div className="crm-field-hint">{hint}</div> : null}
    </div>
  );
}
