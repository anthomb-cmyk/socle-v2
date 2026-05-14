// App Router 404. Without an explicit file here, Next.js falls back to the
// legacy pages router _error.js which fails to prerender because it tries to
// use React context at build time. Providing this file overrides that path.

import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "var(--crm-bg)", color: "var(--crm-text)" }}>
      <h1 style={{ fontSize: 48, margin: 0, fontWeight: 700 }}>404</h1>
      <p style={{ fontSize: 16, color: "var(--crm-text2)", marginTop: 8 }}>
        Cette page n&apos;existe pas.
      </p>
      <Link
        href="/"
        style={{
          marginTop: 24,
          padding: "10px 18px",
          borderRadius: 10,
          background: "var(--crm-gold, #B8860B)",
          color: "#fff",
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Retour au tableau de bord
      </Link>
    </main>
  );
}
