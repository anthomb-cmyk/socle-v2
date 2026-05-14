"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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

type Filter = "all" | "linked" | "unknown";

const STAGE_LABELS_FR: Record<string, string> = {
  prospection:   "Prospection",
  analyse:       "Analyse",
  offre:         "Offre déposée",
  due_diligence: "Due Diligence",
  financement:   "Financement",
  cloture:       "Clôturé",
  abandonne:     "Abandonné",
};

function stageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return STAGE_LABELS_FR[stage] ?? stage;
}

function firstNameOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}

const QUICK_TEMPLATES: Array<{ label: string; preview: string; body: string }> = [
  {
    label: "Confirmation visite",
    preview: "Salut {prénom}, je confirme la visite…",
    body: "Salut {prénom}, je confirme la visite demain. Réponds OK si ça tient toujours.",
  },
  {
    label: "Suivi offre",
    preview: "As-tu eu la chance de regarder l'offre…",
    body: "Salut {prénom}, as-tu eu la chance de regarder l'offre que je t'ai envoyée par courriel ? Disponible pour en jaser.",
  },
  {
    label: "Premier contact",
    preview: "Bonjour, Anthony de Socle Acquisitions…",
    body: "Bonjour {prénom}, Anthony de Socle Acquisitions ici. J'aimerais discuter de ton immeuble — tu as 2 minutes ?",
  },
];

export default function TextosClient({
  conversations,
}: {
  conversations: TextoConversation[];
}) {
  // ── State (unchanged) ────────────────────────────────────────────────────
  const pageRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState(conversations);
  const [selectedId, setSelectedId] = useState(conversations[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(conversations.length === 0);
  const [newMode, setNewMode] = useState<"known" | "random">("known");
  const [recipients, setRecipients] = useState<TextoRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [randomNumber, setRandomNumber] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newStatus, setNewStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [newError, setNewError] = useState<string | null>(null);

  // ── Redesign-only state ──────────────────────────────────────────────────
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "thread">(
    conversations.length === 0 ? "list" : "list",
  );

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );
  const selectedRecipient = recipients.find((recipient) => recipient.id === recipientId) ?? recipients[0] ?? null;

  // ── Recipient lazy-load (unchanged) ──────────────────────────────────────
  useEffect(() => {
    if (!newOpen || newMode !== "known") return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setRecipientsLoading(true);
      setRecipientsError(null);
      try {
        const params = new URLSearchParams();
        const trimmed = recipientQuery.trim();
        if (trimmed) params.set("q", trimmed);
        const res = await fetch(`/api/textos/recipients?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json();
        if (!json.ok) {
          setRecipientsError(json.error ?? "Impossible de charger les contacts.");
          return;
        }
        const data = (json.data ?? []) as TextoRecipient[];
        setRecipients(data);
        setRecipientId((current) => (
          data.some((recipient) => recipient.id === current)
            ? current
            : data[0]?.id ?? ""
        ));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setRecipientsError("Erreur réseau pendant le chargement des contacts.");
        }
      } finally {
        if (!controller.signal.aborted) setRecipientsLoading(false);
      }
    }, recipientQuery.trim() ? 220 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [newMode, newOpen, recipientQuery]);

  // ── iOS keyboard tracking ────────────────────────────────────────────────
  // Keep this scoped to the Textos thread panel. Resizing the global shell
  // with visualViewport.height also includes the fixed top-bar offset, which
  // is what caused the large white gap on iOS Safari.
  useEffect(() => {
    if (mobileView !== "thread") return;
    const page = pageRef.current;
    if (!page) return;
    const pageEl: HTMLElement = page;

    const vv = window.visualViewport;
    let frame = 0;

    function update() {
      const active = document.activeElement;
      const composerFocused = active instanceof HTMLElement && Boolean(active.closest(".tx-composer"));
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const rawInset = vv ? layoutHeight - vv.height - vv.offsetTop : 0;
      const keyboardInset = composerFocused && rawInset > 80 ? Math.max(0, rawInset) : 0;

      pageEl.style.setProperty("--tx-keyboard-inset", `${keyboardInset}px`);
      pageEl.dataset.keyboard = keyboardInset > 0 ? "open" : "closed";
    }

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }

    schedule();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);

    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      pageEl.style.removeProperty("--tx-keyboard-inset");
      delete pageEl.dataset.keyboard;
    };
  }, [mobileView]);

  // ── Counts and filtered list ─────────────────────────────────────────────
  const counts = useMemo(() => ({
    all: items.length,
    linked: items.filter((i) => i.dealId).length,
    unknown: items.filter((i) => !i.contactId && !i.leadId && !i.dealId).length,
  }), [items]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (filter === "linked") result = result.filter((i) => i.dealId);
    if (filter === "unknown") result = result.filter((i) => !i.contactId && !i.leadId && !i.dealId);
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((i) =>
        (i.contactName ?? i.dealTitle ?? "").toLowerCase().includes(q)
        || i.number.toLowerCase().includes(q)
        || (i.dealTitle ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [items, filter, query]);

  // ── Send actions (unchanged) ─────────────────────────────────────────────
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
      setMobileView("thread");
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

  function initialsFor(name: string) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  }

  return (
    <main ref={pageRef} className="tx-page" data-view={mobileView}>
      <header className="tx-head">
        <div>
          <div className="tx-head__eyebrow">Twilio · SMS</div>
          <h1 className="tx-head__title">Textos</h1>
          <p className="tx-head__sub">
            Conversations SMS reçues et envoyées depuis les numéros Socle. Les numéros connus sont liés au lead, contact et deal quand possible.
          </p>
        </div>
        <div className="tx-head__actions">
          <button
            type="button"
            className="btn btn--gold"
            onClick={() => {
              setNewOpen((open) => !open);
              setStatus("idle");
              setError(null);
            }}
          >
            {newOpen ? "Fermer" : "Nouveau texto"}
          </button>
        </div>
      </header>

      <div className="tx-shell">
        {/* ── List column ── */}
        <aside className="tx-list" aria-label="Conversations SMS">
          <div className="tx-list__top">
            <div className="tx-search">
              <SearchIcon />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher nom, deal, numéro…"
                aria-label="Rechercher dans les conversations"
              />
            </div>
            <div className="tx-filters" role="tablist">
              {([
                ["all", "Toutes", counts.all],
                ["linked", "Liées", counts.linked],
                ["unknown", "Inconnues", counts.unknown],
              ] as const).map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  className={`tx-filter${filter === key ? " tx-filter--active" : ""}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                  <span className="tx-filter__n">{n}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="tx-list__items">
            {filteredItems.length === 0 ? (
              <div className="tx-empty">
                {items.length === 0
                  ? "Aucun texto pour l'instant. Lance « Nouveau texto » pour commencer."
                  : "Aucun résultat pour ce filtre."}
              </div>
            ) : null}
            {filteredItems.map((item) => {
              const last = item.messages[item.messages.length - 1];
              const title = item.contactName ?? item.dealTitle ?? item.number;
              const isUnknown = !item.contactId && !item.leadId && !item.dealId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`tx-thread${selected?.id === item.id ? " tx-thread--active" : ""}`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setNewOpen(false);
                    setMobileView("thread");
                    setStatus("idle");
                    setError(null);
                  }}
                >
                  <span className={`tx-thread__avatar${isUnknown ? " tx-thread__avatar--unknown" : ""}`}>
                    {isUnknown ? "?" : initialsFor(title)}
                  </span>
                  <span className="tx-thread__main">
                    <span className="tx-thread__top">
                      <span className="tx-thread__name">{title}</span>
                      <span className="tx-thread__time">{formatShortDate(last?.at)}</span>
                    </span>
                    <span className="tx-thread__number">{item.number}</span>
                    <span className="tx-thread__preview">{last?.body || "Conversation vide"}</span>
                  </span>
                  {item.dealId
                    ? <span className="tx-thread__chip">{stageLabel(item.dealStage) ?? "Pipeline"}</span>
                    : isUnknown
                    ? <span className="tx-thread__chip tx-thread__chip--unknown">À identifier</span>
                    : null}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Conversation column ── */}
        <section className="tx-conv">
          {newOpen ? (
            <div className="tx-newpanel">
              <div className="tx-newpanel__head">
                <h2>Commencer une conversation</h2>
                <p>Choisis quelqu&apos;un dans le CRM ou entre un numéro libre.</p>
              </div>

              <div className="tx-seg" role="tablist">
                <button type="button" className={newMode === "known" ? "is-active" : ""} onClick={() => setNewMode("known")}>
                  Contact CRM
                </button>
                <button type="button" className={newMode === "random" ? "is-active" : ""} onClick={() => setNewMode("random")}>
                  Numéro libre
                </button>
              </div>

              {newMode === "known" ? (
                <div className="tx-recipient-picker">
                  <input
                    value={recipientQuery}
                    onChange={(event) => setRecipientQuery(event.target.value)}
                    placeholder="Chercher par nom, adresse, deal ou téléphone"
                  />
                  <div className="tx-recipient-list">
                    {recipientsLoading ? (
                      <div className="tx-empty">Chargement des contacts…</div>
                    ) : recipientsError ? (
                      <div className="tx-empty">{recipientsError}</div>
                    ) : recipients.length === 0 ? (
                      <div className="tx-empty">Aucun contact avec numéro trouvé.</div>
                    ) : null}
                    {recipients.map((recipient) => (
                      <button
                        key={recipient.id}
                        type="button"
                        className={`tx-recipient${selectedRecipient?.id === recipient.id ? " tx-recipient--active" : ""}`}
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
                <div className="tx-random-number">
                  <label htmlFor="tx-random-number">Numéro de téléphone</label>
                  <input
                    id="tx-random-number"
                    value={randomNumber}
                    onChange={(event) => setRandomNumber(event.target.value)}
                    placeholder="+1 514 555 0000"
                  />
                </div>
              )}

              <div className="tx-composer">
                <div className="tx-composer__row">
                  <textarea
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder="Écrire le premier texto…"
                  />
                  <button
                    type="button"
                    className="tx-composer__send"
                    onClick={sendNewConversation}
                    disabled={
                      !newMessage.trim() ||
                      newStatus === "sending" ||
                      (newMode === "known" ? !selectedRecipient : !randomNumber.trim())
                    }
                  >
                    {newStatus === "sending" ? "Envoi…" : "Envoyer"}
                  </button>
                </div>
                <div className={`tx-composer__hint${newStatus === "failed" ? " tx-composer__hint--error" : ""}`}>
                  {newStatus === "failed"
                    ? newError
                    : "Le message part du numéro Twilio. Pour un numéro libre, il restera non lié jusqu'à ce qu'on l'associe à un contact."}
                </div>
              </div>
            </div>
          ) : !selected ? (
            <div className="tx-empty">Sélectionne une conversation.</div>
          ) : (
            <>
              <header className="tx-conv__head">
                <button
                  type="button"
                  className="tx-conv__back"
                  onClick={() => setMobileView("list")}
                  aria-label="Retour à la liste"
                >
                  <BackIcon />
                </button>
                {(() => {
                  const headerName = selected.contactName ?? selected.dealTitle ?? selected.number;
                  const isUnknown = !selected.contactId && !selected.leadId && !selected.dealId;
                  return (
                    <span className={`tx-thread__avatar tx-conv__avatar${isUnknown ? " tx-thread__avatar--unknown" : ""}`}>
                      {isUnknown ? "?" : initialsFor(headerName)}
                    </span>
                  );
                })()}
                <div className="tx-conv__id">
                  <span className="tx-conv__name">{selected.contactName ?? selected.dealTitle ?? selected.number}</span>
                  <span className="tx-conv__number">{selected.number}</span>
                </div>
                <div className="tx-conv__links">
                  {selected.dealId
                    ? <Link href={`/pipeline/${selected.dealId}` as never} className="tx-conv__link">Pipeline</Link>
                    : null}
                  {selected.leadId
                    ? <Link href={`/leads/${selected.leadId}` as never} className="tx-conv__link">Lead</Link>
                    : null}
                  {selected.contactId
                    ? <Link href={`/contacts/${selected.contactId}` as never} className="tx-conv__link">Contact</Link>
                    : null}
                  {!selected.dealId && !selected.leadId && !selected.contactId
                    ? (
                      <Link href={"/leads" as never} className="tx-link-action">
                        <PlusIcon />
                        Lier à un deal
                      </Link>
                    )
                    : null}
                </div>
                <a
                  href={`tel:${selected.number}`}
                  className="tx-conv__iconbtn tx-conv__iconbtn--call"
                  aria-label="Appeler"
                >
                  <PhoneIcon />
                </a>
              </header>

              {selected.dealId && (
                <Link href={`/pipeline/${selected.dealId}` as never} className="tx-dealstrip">
                  <span className="tx-dealstrip__icon"><PipelineIcon /></span>
                  <div className="tx-dealstrip__body">
                    <div className="tx-dealstrip__l">Deal lié · pipeline</div>
                    <div className="tx-dealstrip__t">{selected.dealTitle ?? selected.contactName ?? selected.number}</div>
                    {selected.dealStage && (
                      <div className="tx-dealstrip__sub">Stade · {selected.dealStage}</div>
                    )}
                  </div>
                  <span className="tx-dealstrip__cta">Ouvrir →</span>
                </Link>
              )}

              <div className="tx-messages">
                {groupByDay(selected.messages).map((group) => (
                  <DayGroup key={group.day} day={group.day} messages={group.messages} />
                ))}
              </div>

              <div className="tx-composer">
                <div className="tx-composer__row">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onInput={autoResize}
                    maxLength={1000}
                    rows={1}
                    placeholder={`Répondre à ${selected.contactName ?? selected.number}`}
                  />
                  <button
                    type="button"
                    className="tx-composer__send"
                    onClick={sendReply}
                    disabled={!draft.trim() || status === "sending"}
                  >
                    {status === "sending" ? "Envoi…" : "Envoyer"}
                  </button>
                </div>
                {(status === "sent" || status === "failed") && (
                  <div className={`tx-composer__hint${status === "failed" ? " tx-composer__hint--error" : ""}`}>
                    {status === "sent" ? "Texto envoyé depuis le numéro Twilio." : error}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* ── Context rail ── */}
        <aside className="tx-rail" aria-label="Contexte conversation">
          {selected && selected.dealId ? (
            <div className="tx-rail__card">
              <div className="tx-rail__kicker">Deal lié · pipeline</div>
              <h3 className="tx-rail__title">{selected.dealTitle ?? selected.contactName ?? selected.number}</h3>
              {selected.dealStage && (
                <div className="tx-rail__pills">
                  <span className="pill pill--pipeline"><span className="pill__dot" />{stageLabel(selected.dealStage) ?? selected.dealStage}</span>
                </div>
              )}
              <div className="tx-rail__row">
                <span>Numéro</span>
                <span className="mono">{selected.number}</span>
              </div>
              {selected.leadLabel && (
                <div className="tx-rail__row">
                  <span>Adresse</span>
                  <span>{selected.leadLabel}</span>
                </div>
              )}
              <div className="tx-rail__actions">
                <Link href={`/pipeline/${selected.dealId}` as never} className="btn btn--sm">
                  Ouvrir le deal →
                </Link>
                <a href={`tel:${selected.number}`} className="btn btn--gold btn--sm">
                  Appeler{selected.contactName ? ` ${selected.contactName.split(" ")[0]}` : ""}
                </a>
              </div>
            </div>
          ) : selected && selected.leadId ? (
            <div className="tx-rail__card">
              <div className="tx-rail__kicker">Lead lié</div>
              <h3 className="tx-rail__title">{selected.contactName ?? selected.leadLabel ?? selected.number}</h3>
              {selected.leadLabel && <p className="tx-rail__sub">{selected.leadLabel}</p>}
              <Link href={`/leads/${selected.leadId}` as never} className="tx-rail__link">
                Ouvrir le lead →
              </Link>
            </div>
          ) : selected && selected.contactId ? (
            <div className="tx-rail__card">
              <div className="tx-rail__kicker">Contact lié</div>
              <h3 className="tx-rail__title">{selected.contactName ?? selected.number}</h3>
              <Link href={`/contacts/${selected.contactId}` as never} className="tx-rail__link">
                Ouvrir le contact →
              </Link>
            </div>
          ) : selected ? (
            <div className="tx-rail__card">
              <div className="tx-rail__kicker">Conversation non liée</div>
              <p className="tx-rail__sub">
                Ce numéro n&apos;est pas encore associé à un contact, lead ou deal du CRM.
              </p>
              <div className="tx-rail__row">
                <span>Numéro</span>
                <span className="mono">{selected.number}</span>
              </div>
              {selected.socleNumber && (
                <div className="tx-rail__row">
                  <span>Vers Socle</span>
                  <span className="mono">{selected.socleNumber}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="tx-rail__empty">Sélectionne une conversation pour voir le contexte.</div>
          )}

          {selected && !newOpen && (
            <div className="tx-rail__card">
              <div className="tx-rail__kicker">Modèles rapides</div>
              <div className="tx-templates">
                {QUICK_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    className="tx-template"
                    onClick={() => {
                      const filled = tpl.body.replace(
                        "{prénom}",
                        firstNameOf(selected.contactName) ?? selected.contactName ?? "",
                      );
                      setDraft(filled);
                    }}
                  >
                    <span className="tx-template__l">{tpl.label}</span>
                    <span className="tx-template__b">{tpl.preview}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Mobile FAB — visible only on mobile list view (display controlled via CSS data-view) */}
      <button
        type="button"
        className="tx-fab"
        aria-label="Nouveau texto"
        onClick={() => {
          setNewOpen(true);
          setMobileView("thread");
          setStatus("idle");
          setError(null);
        }}
      >
        <PlusIcon />
      </button>
    </main>
  );
}

// ── Day grouping ─────────────────────────────────────────────────────────

type DayBucket = { day: string; messages: TextoMessage[] };

function groupByDay(messages: TextoMessage[]): DayBucket[] {
  const fmt = new Intl.DateTimeFormat("fr-CA", { dateStyle: "full", timeZone: "America/Toronto" });
  const out: DayBucket[] = [];
  let current: DayBucket | null = null;
  for (const m of messages) {
    const day = m.at ? fmt.format(new Date(m.at)) : "—";
    if (!current || current.day !== day) {
      current = { day, messages: [] };
      out.push(current);
    }
    current.messages.push(m);
  }
  return out;
}

function DayGroup({ day, messages }: { day: string; messages: TextoMessage[] }) {
  return (
    <>
      <div className="tx-day">{day}</div>
      {messages.map((message, i) => {
        const next = messages[i + 1];
        // End of a burst: last message overall, OR next has different
        // direction, OR next is more than 10 minutes later.
        const TEN_MIN = 10 * 60 * 1000;
        const isBurstEnd = !next
          || next.direction !== message.direction
          || (Date.parse(next.at) - Date.parse(message.at)) > TEN_MIN;
        return (
          <div key={message.id} className={`tx-bubble tx-bubble--${message.direction === "outbound" ? "out" : "in"}`}>
            <div className="tx-bubble__body">{message.body || "Message vide"}</div>
            {isBurstEnd && (
              <div className="tx-bubble__meta">
                {message.direction === "inbound" ? "Reçu" : "Envoyé"} · {formatFullDate(message.at)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />
    </svg>
  );
}
function PipelineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M9 17V7m6 10V7M5 7h14M5 17h14" />
    </svg>
  );
}

// ── Composer auto-resize ─────────────────────────────────────────────────

function autoResize(event: React.FormEvent<HTMLTextAreaElement>) {
  const el = event.currentTarget;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

// ── Date helpers (unchanged) ─────────────────────────────────────────────

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
