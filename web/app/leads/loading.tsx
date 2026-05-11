export default function LeadsLoading() {
  return (
    <main className="crm-page">
      {/* Stat bar skeleton */}
      <div className="crm-stat-bar" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="crm-stat-pill" style={{ opacity: 0.4 }}>
            <span className="crm-stat-pill-value" style={{ background: "#E5E7EB", borderRadius: 6, width: 40, height: 24, display: "inline-block" }} />
            <span className="crm-stat-pill-label" style={{ background: "#E5E7EB", borderRadius: 4, width: 70, height: 12, display: "inline-block", marginTop: 4 }} />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="crm-card" style={{ overflow: "hidden", padding: 0, marginTop: 16 }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 150px 100px",
              gap: 0,
              padding: "14px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--crm-card-border)",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: `${45 + (i * 17) % 35}%` }} />
              <div style={{ background: "#F3F4F6", borderRadius: 4, height: 11, width: `${30 + (i * 13) % 40}%` }} />
            </div>
            <div style={{ background: "#F3F4F6", borderRadius: 4, height: 13, width: "80%", marginLeft: "auto" }} />
            <div style={{ background: "#EEF2FF", borderRadius: 12, height: 20, width: 70 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
