"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/login" as never);
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="text-xs text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
