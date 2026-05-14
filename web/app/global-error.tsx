"use client";

// Global error boundary for the App Router. Without this, Next.js generates a
// legacy pages/_error.js that fails to prerender (useContext null).

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body style={{ background: "#0f1115", color: "#fff", margin: 0, padding: 0 }}>
        <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 36, margin: 0, fontWeight: 700 }}>Une erreur est survenue</h1>
          <p style={{ fontSize: 14, color: "#9CA3AF", marginTop: 8, maxWidth: 520 }}>
            {error.message || "Quelque chose s'est mal passé."}
            {error.digest ? ` (id: ${error.digest})` : null}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "10px 18px",
              borderRadius: 10,
              background: "#B8860B",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
