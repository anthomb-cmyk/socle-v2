"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type TextoMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  at: string;
  from: string;
  to: string;
};

export type TextoConversation = {
  id: string;
  number: string;
  socleNumber: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  leadLabel: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dealStage: string | null;
  messages: TextoMessage[];
};

export type TextoRecipient = {
  id: string;
  label: string;
  sublabel: string | null;
  number: string;
  contactId: string | null;
  leadId: string | null;
  dealId: string | null;
  dealTitle: string | null;
};

export default function TextosClient({
  conversations,
  recipients,
}: {
  conversations: TextoConversation[];
  recipients: TextoRecipient[];
}) {
  const [items, setItems] = useState(conversations);
  const [selectedId, setSelectedId] = useState(conversations[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(conversations.length === 0);
  const [newMode, setNewMode] = useState<"known" | "random">("known");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "");
  const [randomNumber, setRandomNumber] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newStatus, setNewStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [newError, setNewError] = useState<string | null>(null);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );
  const filteredRecipients = useMemo(() => {
    const q = recipientQuery.trim().toLowerCase();
    if (!q) return recipients.slice(0, 60);
    return recipients.filter((recipient) => (
      `${recipient.label} ${recipient.sublabel ?? ""} ${recipient.number}`.toLowerCase().includes(q)
    )).slice(0, 60);
  }, [recipientQuery, recipients]);
  const selectedRecipient = recipients.find((recipient) => recipient.id === recipientId) ?? filteredRecipients[0] ?? null;

  async function sendReply() {
    const message = draft.trim();
    if (!selected || !message || status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/twilio/messages/send-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selected.number,
          message,
          leadId: selected.leadId,
          contactId: selected.contactId,
          dealId: selected.dealId,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setStatus("failed");
        setError(json.error ?? "Impossible d'envoyer le texto.");
        return;
      }
      const now = new Date().toISOString();
      const from = String(json.data?.from ?? selected.socleNumber ?? "");
      const msg: TextoMessage = {
        id: String(json.data?.sid ?? crypto.randomUUID()),
        direction: "outbound",
        body: message,
        at: now,
        from,
        to: selected.number,
      };
      setItems((prev) => prev.map((item) => (
        item.id === selected.id
          ? { ...item, socleNumber: from || item.socleNumber, messages: [...item.messages, msg] }
          : item
      )));
      setDraft("");
      setStatus("sent");
    } catch {
      setStatus("failed");
      setError("Erreur réseau pendant l'envoi.");
    }
  }

  async function sendNewConversation() {
    const message = newMessage.trim();
    const recipient = newMode === "known" ? selectedRecipient : null;
    const to = newMode === "known" ? recipient?.number ?? "" : randomNumber.trim();
    if (!to || !message || newStatus === "sending") return;
    setNewStatus("sending");
    setNewError(null);
    try {
      const res = await fetch("/api/twilio/messages/send-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          message,
          leadId: recipient?.leadId ?? null,
          contactId: recipient?.contactId ?? null,
          dealId: recipient?.dealId ?? null,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setNewStatus("failed");
        setNewError(json.error ?? "Impossible d'envoyer le texto.");
        return;
      }

      const now = new Date().toISOString();
      const normalizedTo = String(json.data?.to ?? to);
      const from = String(json.data?.from ?? "");
      const conv: TextoConversation = {
        id: normalizedTo,
        number: normalizedTo,
        socleNumber: from || null,
        contactId: recipient?.contactId ?? null,
        contactName: recipient?.label ?? null,
        leadId: recipient?.leadId ?? null,
        leadLabel: recipient?.sublabel ?? null,
        dealId: recipient?.dealId ?? null,
        dealTitle: recipient?.dealTitle ?? null,
        dealStage: null,
        messages: [{
          id: String(json.data?.sid ?? crypto.randomUUID()),
          direction: "outbound",
          body: message,
          at: now,
          from,
          to: normalizedTo,
        }],
      };

      setItems((prev) => {
        const existing = prev.find((item) => item.number === normalizedTo);
        if (!existing) return [conv, ...prev];
        return prev.map((item) => item.number === normalizedTo ? {
          ...item,
          contactId: item.contactId ?? conv.contactId,
          contactName: item.contactName ?? conv.contactName,
          leadId: item.leadId ?? conv.leadId,
          leadLabel: item.leadLabel ?? conv.leadLabel,
          dealId: item.dealId ?? conv.dealId,
          dealTitle: item.dealTitle ?? conv.dealTitle,
          socleNumber: item.socleNumber ?? conv.socleNumber,
          messages: [...item.messages, conv.messages[0]],
        } : item);
      });
      setSelectedId(normalizedTo);
      setNewMessage("");
      setRandomNumber("");
      setNewOpen(false);
      setNewStatus("sent");
      setStatus("sent");
    } catch {
      setNewStatus("failed");
      setNewError("Erreur réseau pendant l'envoi.");
    }
  }

  return (
    <main className="sms-page">
      <header className="sms-head">
        <div>
          <div className="sms-head__eyebrow">Twilio · SMS</div>
          <h1 className="sms-head__title">Textos</h1>
          <p className="sms-head__sub">
            Conversations SMS reçues et envoyées depuis les numéros Socle. Les numéros connus sont liés au lead, contact et deal quand possible.
          </p>
        </div>
        <button
          type="button"
          className="sms-new-button"
          onClick={() => {
            setNewOpen((open) => !open);
            setStatus("idle");
            setError(null);
          }}
        >
          Nouveau texto
        </button>
        <div className="sms-metrics">
          <Metric label="Conversations" value={items.length} />
          <Metric label="Liées pipeline" value={items.filter((item) => item.dealId).length} tone="green" />
          <Metric label="Inconnues" value={items.filter((item) => !item.contactId && !item.leadId && !item.dealId).length} tone="amber" />
        </div>
      </header>

      <section className="sms-shell">
        <aside className="sms-thread-list" aria-label="Conversations SMS">
          {items.length === 0 ? (
            <div className="sms-empty">Aucun texto reçu pour l&apos;instant.</div>
          ) : null}
          {items.map((item) => {
            const last = item.messages[item.messages.length - 1];
            const title = item.contactName ?? item.dealTitle ?? item.number;
            return (
              <button
                key={item.id}
                type="button"
                className={`sms-thread${selected?.id === item.id ? " sms-thread--active" : ""}`}
                onClick={() => {
                  setSelectedId(item.id);
                  setStatus("idle");
                  setError(null);
                }}
              >
                <span className="sms-thread__top">
                  <span className="sms-thread__name">{title}</span>
                  <span className="sms-thread__time">{formatShortDate(last?.at)}</span>
                </span>
                <span className="sms-thread__number">{item.number}</span>
                <span className="sms-thread__preview">{last?.body || "Conversation vide"}</span>
              </button>
            );
          })}
        </aside>

        <section className="sms-conversation">
          {newOpen ? (
            <section className="sms-new-panel">
              <header className="sms-new-panel__head">
                <div>
                  <h2>Commencer une conversation</h2>
                  <p>Choisis quelqu&apos;un dans le CRM ou entre un numéro libre.</p>
                </div>
                <div className="sms-segmented">
                  <button type="button" className={newMode === "known" ? "is-active" : ""} onClick={() => setNewMode("known")}>
                    Contact CRM
                  </button>
                  <button type="button" className={newMode === "random" ? "is-active" : ""} onClick={() => setNewMode("random")}>
                    Numéro libre
                  </button>
                </div>
              </header>

              {newMode === "known" ? (
                <div className="sms-recipient-picker">
                  <input
                    value={recipientQuery}
                    onChange={(event) => setRecipientQuery(event.target.value)}
                    placeholder="Chercher par nom, adresse, deal ou téléphone"
                  />
                  <div className="sms-recipient-list">
                    {filteredRecipients.length === 0 ? (
                      <div className="sms-empty">Aucun contact avec numéro trouvé.</div>
                    ) : null}
                    {filteredRecipients.map((recipient) => (
                      <button
                        key={recipient.id}
                        type="button"
                        className={`sms-recipient${selectedRecipient?.id === recipient.id ? " sms-recipient--active" : ""}`}
                        onClick={() => setRecipientId(recipient.id)}
                      >
                        <span>
                          <strong>{recipient.label}</strong>
                          <small>{recipient.sublabel ?? recipient.dealTitle ?? "Contact CRM"}</small>
                        </span>
                        <em>{recipient.number}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="sms-random-number">
                  <label htmlFor="sms-random-number">Numéro de téléphone</label>
                  <input
                    id="sms-random-number"
                    value={randomNumber}
                    onChange={(event) => setRandomNumber(event.target.value)}
                    placeholder="+1 514 555 0000"
                  />
                </div>
              )}

              <footer className="sms-composer sms-composer--new">
                <textarea
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="Écrire le premier texto..."
                />
                <button
                  type="button"
                  onClick={sendNewConversation}
                  disabled={
                    !newMessage.trim() ||
                    newStatus === "sending" ||
                    (newMode === "known" ? !selectedRecipient : !randomNumber.trim())
                  }
                >
                  {newStatus === "sending" ? "Envoi..." : "Envoyer"}
                </button>
                <div className="sms-composer__hint">
                  {newStatus === "failed"
                    ? newError
                    : "Le message part du numéro Twilio. Pour un numéro random, il restera non lié jusqu'a ce qu'on l'associe à un contact."}
                </div>
              </footer>
            </section>
          ) : !selected ? (
            <div className="sms-empty sms-empty--panel">Sélectionne une conversation.</div>
          ) : (
            <>
              <header className="sms-conversation__head">
                <div>
                  <h2>{selected.contactName ?? selected.dealTitle ?? selected.number}</h2>
                  <p>{selected.number}</p>
                </div>
                <div className="sms-links">
                  {selected.dealId ? <Link href={`/pipeline/${selected.dealId}` as never}>Pipeline</Link> : null}
                  {selected.leadId ? <Link href={`/leads/${selected.leadId}` as never}>Lead</Link> : null}
                  {selected.contactId ? <Link href={`/contacts/${selected.contactId}` as never}>Contact</Link> : null}
                  {!selected.dealId && !selected.leadId && !selected.contactId ? <span>Non reconnu</span> : null}
                </div>
              </header>

              <div className="sms-messages">
                {selected.messages.map((message) => (
                  <div key={message.id} className={`sms-bubble sms-bubble--${message.direction}`}>
                    <div className="sms-bubble__body">{message.body || "Message vide"}</div>
                    <div className="sms-bubble__meta">
                      {message.direction === "inbound" ? "Reçu" : "Envoyé"} · {formatFullDate(message.at)}
                    </div>
                  </div>
                ))}
              </div>

              <footer className="sms-composer">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={`Répondre à ${selected.contactName ?? selected.number}`}
                />
                <button type="button" onClick={sendReply} disabled={!draft.trim() || status === "sending"}>
                  {status === "sending" ? "Envoi..." : "Envoyer"}
                </button>
                <div className="sms-composer__hint">
                  {status === "sent"
                    ? "Texto envoyé depuis le numéro Twilio."
                    : status === "failed"
                    ? error
                    : "Le client voit seulement le numéro Twilio, pas ton cell personnel."}
                </div>
              </footer>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" }) {
  return (
    <div className={`sms-metric${tone ? ` sms-metric--${tone}` : ""}`}>
      <div className="sms-metric__label">{label}</div>
      <div className="sms-metric__value">{value}</div>
    </div>
  );
}

function formatShortDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}
