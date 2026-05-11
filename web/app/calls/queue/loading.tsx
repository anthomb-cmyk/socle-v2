export default function QueueLoading() {
  return (
    <div className="queue-wrap" style={{ padding: "20px 16px" }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ background: "#E5E7EB", borderRadius: 4, height: 20, width: 220, marginBottom: 6 }} />
        <div style={{ background: "#F3F4F6", borderRadius: 4, height: 13, width: 140 }} />
      </div>

      {/* Stat tiles */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: 1, background: "#F9FAFB", borderRadius: 10, border: "1px solid #E5E7EB", padding: "12px 14px" }}>
            <div style={{ background: "#E5E7EB", borderRadius: 4, height: 22, width: 40, marginBottom: 6 }} />
            <div style={{ background: "#F3F4F6", borderRadius: 4, height: 11, width: "70%" }} />
          </div>
        ))}
      </div>

      {/* Lead list skeleton */}
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          {/* Search bar */}
          <div style={{ background: "#F9FAFB", borderRadius: 10, border: "1px solid #E5E7EB", padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ background: "#E5E7EB", borderRadius: 4, height: 32 }} />
          </div>
          {/* Rows */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} style={{
              background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB",
              padding: "12px 14px", marginBottom: 6,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: `${50 + (i * 11) % 35}%` }} />
              <div style={{ background: "#F3F4F6", borderRadius: 4, height: 11, width: `${35 + (i * 17) % 30}%` }} />
              <div style={{ background: "#F9F9F9", borderRadius: 4, height: 11, width: "55%" }} />
            </div>
          ))}
        </div>

        {/* Preview panel — hidden on mobile */}
        <div style={{ width: 300, flexShrink: 0, display: "none" }} className="queue-preview-skeleton" />
      </div>
    </div>
  );
}
