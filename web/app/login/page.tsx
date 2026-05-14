"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useState } from "react";
export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email/password state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          new URLSearchParams(window.location.search).get("next") || "/",
        )}`,
        scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
    } else {
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next;
    }
  }

  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", background: "var(--crm-bg, #F3F4F6)" }}>
      <div style={{ width: "100%", maxWidth: 360, background: "#fff", borderRadius: 16, boxShadow: "0 1px 8px rgba(0,0,0,0.08)", border: "1px solid #E5E7EB", padding: "32px 28px" }}>
        {/* Logo / Title */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--crm-gold, #C9A84C)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="1" width="6" height="16" rx="2" fill="#fff" fillOpacity="0.9" />
                <rect x="11" y="5" width="6" height="12" rx="2" fill="#fff" fillOpacity="0.9" />
              </svg>
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.3px" }}>Socle CRM</span>
          </div>
          <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>Connectez-vous pour accéder à votre espace.</p>
        </div>

        {/* Google button */}
        <button
          onClick={signInWithGoogle}
          disabled={busy}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            background: "#18181B", color: "#fff", border: "none", borderRadius: 10,
            padding: "11px 16px", fontSize: 14, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.5 : 1, transition: "background 0.15s",
          }}
        >
          {/* Google G icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908C16.658 14.248 17.64 11.93 17.64 9.2z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          {busy && !showEmailForm ? "Redirection…" : "Continuer avec Google"}
        </button>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
          <span style={{ fontSize: 12, color: "#9CA3AF" }}>ou</span>
          <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
        </div>

        {/* Email/password form */}
        {!showEmailForm ? (
          <button
            onClick={() => setShowEmailForm(true)}
            style={{
              width: "100%", background: "transparent", border: "1.5px solid #E5E7EB",
              borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 500,
              color: "#374151", cursor: "pointer", transition: "border-color 0.15s",
            }}
          >
            Connexion par e-mail
          </button>
        ) : (
          <form onSubmit={signInWithEmail} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                Adresse e-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="vous@example.com"
                style={{
                  width: "100%", boxSizing: "border-box",
                  border: "1.5px solid #E5E7EB", borderRadius: 8,
                  padding: "9px 12px", fontSize: 14, color: "#111827",
                  outline: "none", background: "#fff",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: "100%", boxSizing: "border-box",
                  border: "1.5px solid #E5E7EB", borderRadius: 8,
                  padding: "9px 12px", fontSize: 14, color: "#111827",
                  outline: "none", background: "#fff",
                }}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%", background: "var(--crm-gold, #C9A84C)", color: "#fff",
                border: "none", borderRadius: 10, padding: "11px 16px",
                fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1, marginTop: 2,
              }}
            >
              {busy ? "Connexion…" : "Se connecter"}
            </button>
            <button
              type="button"
              onClick={() => { setShowEmailForm(false); setError(null); }}
              style={{ background: "none", border: "none", fontSize: 12, color: "#9CA3AF", cursor: "pointer", padding: 0 }}
            >
              ← Retour
            </button>
          </form>
        )}

        {error && (
          <p style={{ marginTop: 14, fontSize: 13, color: "#DC2626", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px" }}>
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
