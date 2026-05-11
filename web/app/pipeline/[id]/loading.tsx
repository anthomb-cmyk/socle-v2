export default function DealWorkspaceLoading() {
  return (
    <div style={{ padding: "24px", maxWidth: 900, margin: "0 auto" }}>
      {/* Title bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ background: "#E5E7EB", borderRadius: 4, height: 28, width: "40%" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ background: "#E5E7EB", borderRadius: 8, height: 32, width: 100 }} />
          <div style={{ background: "#E5E7EB", borderRadius: 8, height: 32, width: 120 }} />
        </div>
      </div>

      {/* Stage bar */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderRadius: 10, overflow: "hidden", border: "1px solid #E5E7EB" }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} style={{ flex: 1, height: 36, background: i === 0 ? "#F3F4F6" : "#FAFAFA", borderLeft: i > 0 ? "1px solid #E5E7EB" : "none" }} />
        ))}
      </div>

      {/* Two columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E7EB", padding: 16 }}>
            <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: "45%", marginBottom: 12 }} />
            {[0, 1, 2].map((j) => (
              <div key={j} style={{ background: "#F3F4F6", borderRadius: 4, height: 12, marginBottom: 8, width: `${60 + j * 10}%` }} />
            ))}
          </div>
        ))}
      </div>

      {/* Notes panel */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E5E7EB", padding: 16 }}>
        <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: "30%", marginBottom: 12 }} />
        <div style={{ background: "#F3F4F6", borderRadius: 8, height: 80 }} />
      </div>
    </div>
  );
}
