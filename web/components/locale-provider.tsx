"use client";
// Locale context for FR/EN bilingual support.
// Persists selection in localStorage so it survives navigation.
//
// Usage:
//   1. Wrap your app in <LocaleProvider> (done in layout.tsx).
//   2. In any client component: const { locale, t } = useLocale();
//   3. Place <LocaleToggle /> anywhere (e.g. sidebar) for the toggle button.

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  type Locale,
  type Dict,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getDict,
} from "@/lib/i18n";

// ── Context ───────────────────────────────────────────────────────────────────

type LocaleCtx = {
  locale: Locale;
  t: Dict;
  setLocale: (l: Locale) => void;
  toggle: () => void;
};

const LocaleContext = createContext<LocaleCtx | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Hydrate from localStorage on mount (client only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null;
      if (stored === "fr" || stored === "en") {
        setLocaleState(stored);
      }
    } catch {
      // localStorage not available (SSR guard — should not happen since this is "use client")
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, l);
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setLocale(locale === "fr" ? "en" : "fr");
  }, [locale, setLocale]);

  const t = getDict(locale);

  return (
    <LocaleContext.Provider value={{ locale, t, setLocale, toggle }}>
      {children}
    </LocaleContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLocale(): LocaleCtx {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale() must be used inside <LocaleProvider>");
  return ctx;
}

// ── Toggle button ─────────────────────────────────────────────────────────────

export function LocaleToggle({ className }: { className?: string }) {
  const { t, toggle } = useLocale();
  return (
    <button
      onClick={toggle}
      title={`Changer de langue / Switch language`}
      className={className}
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.5px",
        padding: "3px 9px",
        borderRadius: 6,
        border: "1px solid var(--crm-card-border, #E5E7EB)",
        background: "var(--crm-bg, #F9FAFB)",
        color: "var(--crm-text2, #6B7280)",
        cursor: "pointer",
        transition: "background 0.1s",
        lineHeight: 1.4,
      }}
    >
      {t.toggleLang}
    </button>
  );
}
