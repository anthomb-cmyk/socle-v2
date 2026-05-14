// Instant skeleton for /follow-ups while the server resolves user
// auth + role. The list itself loads its own data client-side.

export default function FollowUpsLoading() {
  return (
    <main className="crm-page-narrow" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div aria-hidden="true" style={{ height: 22, width: 110, background: "var(--bg-alt)", borderRadius: 6 }} />
        <div aria-hidden="true" style={{ height: 13, width: 220, background: "var(--bg-alt)", borderRadius: 4, opacity: 0.7 }} />
      </header>

      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid var(--border-soft)",
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            opacity: 0.6,
          }}
        >
          <div style={{ height: 14, width: `${55 + (i * 11) % 30}%`, background: "var(--bg-alt)", borderRadius: 4 }} />
          <div style={{ height: 11, width: `${40 + (i * 9) % 25}%`, background: "var(--bg-alt)", borderRadius: 4 }} />
        </div>
      ))}
    </main>
  );
}
