// Instant skeleton for /textos while the server fetches the SMS
// conversation list. Matches .tx-page silhouette so nothing jumps.

export default function TextosLoading() {
  return (
    <main className="tx-page" data-view="list" aria-busy="true">
      <header className="tx-head">
        <div>
          <div className="tx-head__eyebrow">Twilio · SMS</div>
          <h1 className="tx-head__title">Textos</h1>
        </div>
      </header>

      <div className="tx-shell">
        <aside className="tx-list" aria-label="Chargement des conversations">
          <div className="tx-list__items">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                style={{
                  display: "grid",
                  gridTemplateColumns: "36px 1fr auto",
                  gap: 10,
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border-soft)",
                  opacity: 0.6,
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 999, background: "var(--gold-soft)" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ height: 12, width: `${55 + (i * 13) % 30}%`, background: "var(--bg-alt)", borderRadius: 4 }} />
                  <div style={{ height: 10, width: `${30 + (i * 11) % 25}%`, background: "var(--bg-alt)", borderRadius: 4 }} />
                  <div style={{ height: 10, width: `${65 + (i * 7) % 20}%`, background: "var(--bg-alt)", borderRadius: 4 }} />
                </div>
                <div />
              </div>
            ))}
          </div>
        </aside>
        <section className="tx-conv" />
        <aside className="tx-rail" />
      </div>
    </main>
  );
}
