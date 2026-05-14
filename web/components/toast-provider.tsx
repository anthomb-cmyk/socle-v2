"use client";
// Lightweight global toast system. Mount <ToastProvider> once near the root
// (done in layout.tsx). From any client component:
//   const { showToast } = useToast();
//   showToast({ message: "Saved.", tone: "success" });
//
// Toasts auto-dismiss after 3.5s. An optional action button is supported
// (e.g. for "Undo" — caller passes its own handler).

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type Tone = "info" | "success" | "error";

type ToastInput = {
  message: string;
  tone?: Tone;
  durationMs?: number;
  action?: { label: string; onClick: () => void };
};

type Toast = ToastInput & { id: number };

type ToastCtx = {
  showToast: (t: ToastInput) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...input, id }]);
    const ms = input.durationMs ?? 3500;
    setTimeout(() => dismiss(id), ms);
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <div className="crm-toast-stack" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const tone = t.tone ?? "info";
  return (
    <div className={`crm-toast crm-toast--${tone}`} role="status">
      <span className="crm-toast__msg">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="crm-toast__action"
          onClick={() => { t.action!.onClick(); onDismiss(); }}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        className="crm-toast__close"
        aria-label="Fermer"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Soft-fail: components that render outside the provider (e.g. login)
    // get a no-op. Avoids crashing pre-auth pages.
    return { showToast: () => {} };
  }
  return ctx;
}

// Convenience hook: subscribe to Escape key for closeable surfaces (modals,
// overlays). Not strictly toast-related but lives here to avoid a separate
// util file just for one tiny hook.
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}
