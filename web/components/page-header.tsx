// Shared V1-style page header: title + subtitle + right-side actions.
// Matches V1 Topbar feel: .crm-page-title + .crm-page-sub pattern.

import { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 20,
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 className="crm-page-title">{title}</h1>
        {subtitle && <p className="crm-page-sub">{subtitle}</p>}
      </div>
      {children && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          {children}
        </div>
      )}
    </header>
  );
}
