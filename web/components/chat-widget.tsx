"use client";
// Floating Socle Copilot — CRM-aware assistant in the bottom-right corner.

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";

// Routes where the floating button would overlap an in-page primary
// action (Send button on /textos, big green call button on
// /quick-call, in-call workspace on /calls/) — hide it there.
const HIDDEN_PREFIXES = ["/textos", "/calls/", "/quick-call"];

type Message = {
  role: "user" | "assistant";
  content: string;
};

const SUGGESTED_QUESTIONS = [
  "Résume cette page et donne-moi la prochaine action.",
  "Quels deals demandent mon attention aujourd'hui ?",
  "Trouve les appels entrants non rattachés.",
  "Qui devrait être rappelé en priorité ?",
];

export default function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hidden = pathname ? HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) : false;

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          context: {
            pathname: pathname ?? "",
            href: typeof window !== "undefined" ? window.location.href : "",
          },
        }),
      });

      const data = await res.json();

      if (data.ok && data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      } else {
        setError(data.error ?? "Erreur lors de la réponse.");
      }
    } catch {
      setError("Impossible de contacter l'assistant.");
    } finally {
      setLoading(false);
    }
  }, [messages, loading, pathname]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  if (hidden) return null;

  return (
    <>
      {/* Floating button — pushed above mobile bottom nav + iOS safe-area */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Assistant CRM"
        style={{
          position: "fixed",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
          right: 16,
          zIndex: 1000,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: open ? "#374151" : "var(--crm-gold, #B8860B)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontSize: 20,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          transition: "background 0.15s, transform 0.15s",
          transform: open ? "scale(0.92)" : "scale(1)",
        }}
      >
        {open ? "×" : "AI"}
      </button>

      {/* Chat panel — full-screen on mobile, anchored bubble on desktop */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 144px)",
            right: 16,
            zIndex: 999,
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            height: 500,
            maxHeight: "calc(100dvh - 200px)",
            background: "var(--crm-surface, #fff)",
            border: "1px solid var(--crm-border, #E5E7EB)",
            borderRadius: 16,
            boxShadow: "0 8px 40px rgba(0,0,0,0.14)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 18px 12px",
              borderBottom: "1px solid var(--crm-border, #E5E7EB)",
              background: "var(--crm-surface, #fff)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-text)" }}>
                Copilot Socle
              </div>
              <div style={{ fontSize: 11, color: "var(--crm-text2)", marginTop: 1 }}>
                Comprend et agit sur le CRM
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
              {messages.length > 0 && (
                <button
                  onClick={() => { setMessages([]); setError(null); }}
                  title="Effacer la conversation / Clear conversation"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--crm-text2)",
                    fontSize: 12,
                    padding: "4px 8px",
                    borderRadius: 6,
                    transition: "background 0.1s",
                  }}
                >
                  Effacer
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer / Close"
                title="Fermer / Close"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--crm-text)",
                  fontSize: 22,
                  lineHeight: 1,
                  padding: "4px 10px",
                  borderRadius: 6,
                  transition: "background 0.1s",
                  fontWeight: 400,
                  minWidth: 36,
                  minHeight: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--crm-bg, #F3F4F6)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                ×
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {messages.length === 0 && !loading && (
              <div style={{ paddingTop: 4 }}>
                <p style={{ fontSize: 13, color: "var(--crm-text2)", marginBottom: 12 }}>
                  Je peux lire cette page, chercher dans le CRM, résumer les appels, ajouter des notes et planifier des suivis.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      style={{
                        textAlign: "left",
                        background: "var(--crm-bg, #F9FAFB)",
                        border: "1px solid var(--crm-border, #E5E7EB)",
                        borderRadius: 8,
                        padding: "8px 12px",
                        fontSize: 12,
                        color: "var(--crm-text)",
                        cursor: "pointer",
                        lineHeight: 1.4,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--crm-border, #E5E7EB)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--crm-bg, #F9FAFB)")}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    padding: "9px 13px",
                    borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.role === "user"
                      ? "var(--crm-gold, #B8860B)"
                      : "var(--crm-bg, #F3F4F6)",
                    color: msg.role === "user" ? "#fff" : "var(--crm-text)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div
                  style={{
                    padding: "9px 14px",
                    borderRadius: "14px 14px 14px 4px",
                    background: "var(--crm-bg, #F3F4F6)",
                    fontSize: 13,
                    color: "var(--crm-text2)",
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
                  <LoadingDots />
                </div>
              </div>
            )}

            {error && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#991B1B",
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--crm-border, #E5E7EB)",
              background: "var(--crm-surface, #fff)",
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              flexShrink: 0,
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Demande une action ou une analyse…"
              rows={1}
              disabled={loading}
              style={{
                flex: 1,
                resize: "none",
                border: "1px solid var(--crm-border, #E5E7EB)",
                borderRadius: 10,
                padding: "8px 11px",
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: "inherit",
                outline: "none",
                background: "var(--crm-bg, #F9FAFB)",
                color: "var(--crm-text)",
                maxHeight: 96,
                overflowY: "auto",
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 96) + "px";
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                background: input.trim() && !loading ? "var(--crm-gold, #B8860B)" : "var(--crm-border, #E5E7EB)",
                color: input.trim() && !loading ? "#fff" : "var(--crm-text2)",
                fontSize: 13,
                fontWeight: 600,
                cursor: input.trim() && !loading ? "pointer" : "default",
                transition: "background 0.15s",
                whiteSpace: "nowrap",
                height: 36,
              }}
            >
              Envoyer
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function LoadingDots() {
  return (
    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#9CA3AF",
            animation: "chatdot 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes chatdot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </span>
  );
}
