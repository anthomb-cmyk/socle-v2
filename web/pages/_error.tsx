// Minimal pages/_error.tsx to prevent Next.js 15 from auto-generating a
// pages/_error.js that prerenders to "useContext null". The App Router
// not-found.tsx and global-error.tsx handle real error UI; this file just
// exists to short-circuit framework auto-generation.

import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode?: number }) {
  return (
    <div style={{ padding: 40, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
      <h1 style={{ fontSize: 36, marginBottom: 8 }}>{statusCode ?? "Error"}</h1>
      <p>{statusCode === 404 ? "Page introuvable." : "Une erreur est survenue."}</p>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

export default ErrorPage;
