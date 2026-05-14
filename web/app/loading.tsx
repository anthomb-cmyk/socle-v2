// Shown instantly while the dashboard's heavy server queries run.
// Matches the rough silhouette of page.tsx so the swap doesn't shift
// the layout.

export default function DashboardLoading() {
  return (
    <main style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, background: "var(--bg)", minHeight: "100dvh" }}>
      {/* Hero "Décisions à prendre" placeholder */}
      <div
        aria-hidden="true"
        style={{
          height: 140,
          borderRadius: 16,
          background: "linear-gradient(135deg, var(--ink) 0%, oklch(0.32 0.012 75) 100%)",
          opacity: 0.55,
        }}
      />

      {/* KPI tiles row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skel key={i} h={80} />
        ))}
      </div>

      {/* Sections */}
      {[0, 1, 2].map((i) => (
        <Skel key={i} h={180} />
      ))}
    </main>
  );
}

function Skel({ h }: { h: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        height: h,
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--border-soft)",
        opacity: 0.6,
      }}
    />
  );
}
