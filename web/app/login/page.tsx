"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useState } from "react";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          new URLSearchParams(window.location.search).get("next") || "/leads",
        )}`,
        scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
        <h1 className="text-2xl font-semibold mb-2">Socle CRM</h1>
        <p className="text-sm text-zinc-500 mb-6">Sign in with the Google account that owns your CRM data.</p>
        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-lg px-4 py-3 text-sm font-medium transition"
        >
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
