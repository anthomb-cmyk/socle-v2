"use client";
import { useState } from "react";
import LeadsTable from "@/components/leads-table";
import KanbanBoard from "@/components/kanban-board";

export default function LeadsViewToggle({ canEdit }: { canEdit: boolean }) {
  const [view, setView] = useState<"table" | "kanban">("table");

  return (
    <div>
      {/* Toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button
          onClick={() => setView("table")}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 8,
            border: "1px solid #E5E7EB",
            background: view === "table" ? "#111827" : "#fff",
            color: view === "table" ? "#fff" : "#374151",
            cursor: "pointer",
          }}
        >
          Table
        </button>
        <button
          onClick={() => setView("kanban")}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 8,
            border: "1px solid #E5E7EB",
            background: view === "kanban" ? "#111827" : "#fff",
            color: view === "kanban" ? "#fff" : "#374151",
            cursor: "pointer",
          }}
        >
          ⬜ Kanban
        </button>
      </div>

      {view === "table" && <LeadsTable canAssign={canEdit} />}
      {view === "kanban" && <KanbanBoard canEdit={canEdit} />}
    </div>
  );
}
