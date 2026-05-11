export default function PipelineLoading() {
  const COLS = 5;
  return (
    <div style={{ padding: "24px 24px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ background: "#E5E7EB", borderRadius: 4, height: 24, width: 220, marginBottom: 8 }} />
        <div style={{ background: "#F3F4F6", borderRadius: 4, height: 14, width: 160 }} />
      </div>

      {/* Kanban columns */}
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 20 }}>
        {Array.from({ length: COLS }).map((_, col) => (
          <div key={col} style={{ minWidth: 240, width: 260, flexShrink: 0 }}>
            {/* Column header */}
            <div style={{ background: "#F9FAFB", borderRadius: "12px 12px 0 0", borderBottom: "3px solid #E5E7EB", padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: "60%" }} />
            </div>
            {/* Cards */}
            {Array.from({ length: 2 + (col % 2) }).map((_, card) => (
              <div key={card} style={{
                background: "#fff", border: "1px solid #E8EAED", borderRadius: 10,
                padding: "12px 14px", marginBottom: 8,
              }}>
                <div style={{ background: "#F3F4F6", borderRadius: 4, height: 12, width: "70%", marginBottom: 8 }} />
                <div style={{ background: "#E5E7EB", borderRadius: 4, height: 15, width: "85%", marginBottom: 6 }} />
                <div style={{ background: "#F3F4F6", borderRadius: 4, height: 11, width: "50%", marginBottom: 10 }} />
                <div style={{ background: "#F9FAFB", borderRadius: 4, height: 20, width: "40%", marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
