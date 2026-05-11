export default function LeadDetailLoading() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      {/* Back nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: 100 }} />
        <div style={{ background: "#E5E7EB", borderRadius: 8, height: 28, width: 160 }} />
      </div>

      {/* Header skeleton */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ background: "#E5E7EB", borderRadius: 4, height: 28, width: "40%" }} />
        <div style={{ background: "#F3F4F6", borderRadius: 4, height: 14, width: "60%" }} />
      </div>

      {/* Two panels skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 16, border: "1px solid #E5E7EB", padding: 16 }}>
            <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: "40%", marginBottom: 12 }} />
            {[0, 1, 2, 3].map((j) => (
              <div key={j} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                <div style={{ background: "#F3F4F6", borderRadius: 4, height: 12 }} />
                <div style={{ background: "#F3F4F6", borderRadius: 4, height: 12 }} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Phones panel */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E5E7EB", padding: 16 }}>
        <div style={{ background: "#E5E7EB", borderRadius: 4, height: 14, width: "25%", marginBottom: 12 }} />
        {[0, 1].map((j) => (
          <div key={j} style={{ background: "#F3F4F6", borderRadius: 4, height: 32, marginBottom: 8 }} />
        ))}
      </div>
    </main>
  );
}
