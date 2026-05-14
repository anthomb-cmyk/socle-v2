# MOBILE FIX — Textos · à appliquer en priorité

> Les screenshots de production montrent que le layout desktop a été appliqué sur mobile sans les optimisations spécifiques. Ce document corrige les **7 problèmes** identifiés, en ordre d'impact.

---

## 1. Mobile = vue liste par défaut (le plus important)

**Symptôme actuel** : sur mobile, on arrive direct dans un thread. La liste n'est jamais visible.

**Fix** : sous 768px, n'afficher que la liste OU le thread, jamais les deux. Toggle avec un state.

```tsx
// Dans TextosClient.tsx
const [mobileView, setMobileView] = useState<"list" | "thread">("list");

// Quand on clique sur une conversation :
onSelect={(id) => {
  setSelectedId(id);
  setMobileView("thread"); // bascule vers le thread sur mobile
}}

// Bouton retour dans le thread header :
<button onClick={() => setMobileView("list")} className="thread-back">
  <ChevronLeft />
</button>
```

```css
/* CSS : split mobile/desktop */
.textos-shell {
  display: grid;
  grid-template-columns: 320px 1fr 300px;
}

@media (max-width: 768px) {
  .textos-shell {
    grid-template-columns: 1fr; /* une seule colonne */
  }
  /* Mobile : on cache la colonne non-active */
  .textos-shell[data-mobile-view="list"] .thread-pane,
  .textos-shell[data-mobile-view="list"] .context-pane { display: none; }
  .textos-shell[data-mobile-view="thread"] .list-pane,
  .textos-shell[data-mobile-view="thread"] .context-pane { display: none; }
}
```

---

## 2. "Nouveau texto" → FAB sur mobile

**Symptôme** : un gros bouton gold "Nouveau texto" prend de la place en haut, et reste visible même dans le thread (confus).

**Fix** : sur mobile, le bouton du header devient un FAB (Floating Action Button), positionné en bas à droite, ne s'affiche QUE sur la vue liste.

```tsx
{/* Dans le header — caché sur mobile */}
<button className="btn-new-texto-desktop hidden-on-mobile">Nouveau texto</button>

{/* Dans la liste, après les cards — visible que sur mobile */}
{mobileView === "list" && (
  <button className="fab-new-texto" aria-label="Nouveau texto">
    <svg>...</svg>
  </button>
)}
```

```css
.fab-new-texto {
  position: fixed;
  right: 20px;
  bottom: calc(64px + env(safe-area-inset-bottom)); /* au-dessus du tab bar */
  width: 56px; height: 56px;
  border-radius: 20px;
  background: var(--socle-gold);
  color: #fff;
  border: 0;
  box-shadow: 0 8px 20px -8px rgba(40,30,10,0.35), 0 6px 24px -8px oklch(0.62 0.10 78 / 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 30;
}
.fab-new-texto svg { width: 24px; height: 24px; }

@media (min-width: 769px) {
  .fab-new-texto { display: none; }
}
@media (max-width: 768px) {
  .hidden-on-mobile { display: none; }
}
```

---

## 3. Composer → 1 ligne pill (style chat-app)

**Symptôme** : la textarea fait 1/3 de l'écran avec un énorme bouton "Envoyer" carré à côté.

**Fix** : composer compact, 1 ligne, bouton circulaire 42px, autosize.

```tsx
<div className="composer">
  <div className="composer-row">
    <button className="composer-tool" aria-label="Pièce jointe">
      <PlusIcon />
    </button>
    <div className="composer-input">
      <textarea
        rows={1}
        placeholder="Texto…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onInput={autoResize}
      />
    </div>
    <button
      className="composer-send"
      onClick={sendReply}
      disabled={!draft.trim() || status === "sending"}
      aria-label="Envoyer"
    >
      <SendIcon />
    </button>
  </div>
  <div className="composer-hint">
    Envoyé depuis 514 555-0010 · ton cell reste privé
  </div>
</div>
```

```css
.composer {
  position: sticky;
  bottom: 0;
  z-index: 5;
  background: oklch(0.98 0.008 85 / 0.96);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--socle-border-soft);
  padding: 8px 12px calc(12px + env(safe-area-inset-bottom));
}

.composer-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.composer-tool {
  width: 38px; height: 38px;
  border-radius: 12px;
  background: var(--socle-surface);
  border: 1px solid var(--socle-border-soft);
  color: var(--socle-ink-3);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.composer-input {
  flex: 1; min-width: 0;
  background: var(--socle-surface);
  border: 1px solid var(--socle-border);
  border-radius: 20px;
  padding: 8px 14px;
  transition: border-color .15s;
}
.composer-input:focus-within { border-color: var(--socle-gold); }
.composer-input textarea {
  width: 100%;
  border: 0; outline: 0; background: transparent;
  resize: none;
  font-family: inherit; font-size: 15px;
  line-height: 1.4;
  max-height: 100px;
}

.composer-send {
  width: 42px; height: 42px;
  border-radius: 14px;
  background: var(--socle-gold);
  color: #fff;
  border: 0;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.composer-send:disabled {
  background: var(--socle-border);
  color: var(--socle-ink-4);
}

.composer-hint {
  font-size: 10.5px;
  color: var(--socle-ink-3);
  text-align: center;
  margin-top: 8px;
}
```

---

## 4. Bulles sortantes → or plein blanc (style iMessage)

**Symptôme actuel** : les bulles sortantes sont en `gold-tint` (très pâle), texte noir. Difficile de distinguer envoi/réception.

**Fix** :

```css
@media (max-width: 768px) {
  .bubble--out {
    background: var(--socle-gold);
    color: #fff;
    border: 0;
    border-bottom-right-radius: 6px;
  }
  .bubble--out + .bubble--out { border-top-right-radius: 6px; }

  .bubble--in {
    background: var(--socle-surface);
    border: 1px solid var(--socle-border-soft);
    color: var(--socle-ink);
    border-bottom-left-radius: 6px;
  }
  .bubble--in + .bubble--in { border-top-left-radius: 6px; }

  .bubble {
    max-width: 78%;
    padding: 10px 14px;
    border-radius: 18px;
    font-size: 15px;
    line-height: 1.4;
    margin-bottom: 2px;
  }

  /* La meta passe SOUS la bulle, pas dedans */
  .bubble__meta { display: none; } /* on déplace ailleurs */
}

.meta-line {
  font-size: 10.5px;
  color: var(--socle-ink-3);
  font-family: var(--socle-mono);
  margin: 4px 4px 8px;
}
.meta-line--out { align-self: flex-end; }
.meta-line--in  { align-self: flex-start; }
```

**Structure de message** :
```tsx
<div className="messages">
  {messages.map((m, i) => (
    <Fragment key={m.id}>
      <div className={`bubble bubble--${m.direction}`}>{m.body}</div>
      {/* Meta seulement après le DERNIER message d'une rafale */}
      {isLastInBurst(m, messages, i) && (
        <div className={`meta-line meta-line--${m.direction}`}>
          {formatTime(m.at)} {m.direction === "outbound" && "· Livré"}
        </div>
      )}
    </Fragment>
  ))}
</div>
```

---

## 5. Deal context strip (quand lié au pipeline)

**Symptôme** : la pill "Pipeline" à droite du nom est trop discrète. L'utilisateur ne voit pas le contexte du deal.

**Fix** : ajouter un strip sous le header avec deal + stage + prix, cliquable pour ouvrir le deal.

```tsx
{selected.dealId && (
  <a className="deal-strip" href={`/pipeline/${selected.dealId}`}>
    <div className="deal-strip__icon">
      <PipelineIcon />
    </div>
    <div className="deal-strip__body">
      <div className="deal-strip__l">Deal lié · pipeline</div>
      <div className="deal-strip__t">{selected.dealTitle}</div>
      <div className="deal-strip__sub">
        {stageLabel(selected.dealStage)} · {formatPrice(deal.asking_price)}
      </div>
    </div>
    <div className="deal-strip__cta">Ouvrir →</div>
  </a>
)}
```

```css
.deal-strip {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  background: var(--socle-gold-tint);
  border-bottom: 1px solid var(--socle-gold-border);
  text-decoration: none;
  color: inherit;
}
.deal-strip__icon {
  width: 32px; height: 32px; border-radius: 10px;
  background: var(--socle-surface);
  border: 1px solid var(--socle-gold-border);
  color: var(--socle-gold-deep);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.deal-strip__icon svg { width: 15px; height: 15px; }
.deal-strip__body { flex: 1; min-width: 0; }
.deal-strip__l {
  font-size: 10px; font-weight: 700; letter-spacing: 0.10em;
  color: var(--socle-gold-deep); text-transform: uppercase;
}
.deal-strip__t {
  font-size: 13.5px; font-weight: 700; color: var(--socle-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  margin-top: 1px;
}
.deal-strip__sub {
  font-size: 11.5px; color: var(--socle-ink-3); margin-top: 1px;
}
.deal-strip__cta {
  font-size: 12px; font-weight: 600; color: var(--socle-gold-deep);
  flex-shrink: 0;
}
```

---

## 6. Header du thread → avatar + actions

**Symptôme** : juste back-arrow + nom + numéro + une pill discrète "Pipeline" à droite.

**Fix** :

```tsx
<header className="thread-head">
  <button className="thread-back" onClick={onBackToList}>
    <ChevronLeft />
  </button>
  <div className="thread-id">
    <div className="thread-av">
      {initials(selected.contactName ?? selected.dealTitle ?? "?")}
    </div>
    <div className="thread-id__body">
      <div className="thread-id__n">
        {selected.contactName ?? selected.dealTitle ?? selected.number}
      </div>
      <div className="thread-id__r">{selected.number}</div>
    </div>
  </div>
  <div className="thread-actions">
    {selected.contactPhone && (
      <a href={`tel:${selected.contactPhone}`} className="thread-iconbtn thread-iconbtn--call">
        <PhoneIcon />
      </a>
    )}
    <button className="thread-iconbtn">
      <MoreIcon />
    </button>
  </div>
</header>
```

```css
.thread-head {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  background: oklch(0.97 0.010 84 / 0.95);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--socle-border-soft);
}
.thread-back {
  width: 36px; height: 36px; border-radius: 11px;
  background: transparent; border: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--socle-ink-2);
}
.thread-back:active { background: var(--socle-bg-alt); }

.thread-id { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.thread-av {
  width: 36px; height: 36px; border-radius: 12px;
  background: var(--socle-gold-soft);
  border: 1px solid var(--socle-gold-border);
  color: var(--socle-gold-deep);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px;
  flex-shrink: 0;
}
.thread-av--unknown {
  background: var(--socle-amber-soft);
  border-color: oklch(0.85 0.07 75);
  color: oklch(0.42 0.13 70);
}
.thread-id__body { min-width: 0; }
.thread-id__n { font-size: 15px; font-weight: 700; line-height: 1.1; }
.thread-id__r {
  font-size: 11px; font-family: var(--socle-mono);
  color: var(--socle-ink-3); margin-top: 1px;
}

.thread-actions { display: flex; gap: 2px; flex-shrink: 0; }
.thread-iconbtn {
  width: 36px; height: 36px; border-radius: 11px;
  background: transparent; border: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--socle-ink-2);
}
.thread-iconbtn--call {
  background: var(--socle-gold);
  color: #fff;
  border-radius: 12px;
}
```

---

## 7. "Non reconnu" → action chip "Lier à un deal"

**Symptôme** : conversation avec un numéro inconnu affiche juste "Non reconnu" en gris (état mort).

**Fix** : ce DOIT être une action. Remplace par un chip ambré cliquable qui ouvre un modal/drawer pour lier au lead/contact/deal.

```tsx
{!selected.dealId && !selected.leadId && !selected.contactId && (
  <button className="link-action" onClick={() => setLinkDrawerOpen(true)}>
    <PlusIcon />
    Lier à un deal
  </button>
)}
```

```css
.link-action {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 600;
  color: oklch(0.42 0.13 70);
  background: var(--socle-surface);
  border: 1px solid oklch(0.85 0.07 75);
  padding: 5px 12px 5px 10px;
  border-radius: 999px;
}
.link-action svg { width: 11px; height: 11px; }
.link-action:active { background: var(--socle-amber-soft); }
```

Le drawer de liaison peut être Phase 2 — pour MVP, le chip peut juste ouvrir une recherche dans les leads/deals.

---

## Bonus · widget "Chat" externe

Le gros bouton flottant doré "Chat" en bas à droite (visible sur tes screenshots) est un widget externe (Intercom / Crisp ?). Il chevauche le bouton Envoyer.

**Fix** : positionne-le ailleurs sur les pages où il gêne, OU décale-le vers le haut quand l'utilisateur est dans `/textos` :

```css
@media (max-width: 768px) {
  body[data-page="textos"] #intercom-launcher, /* ajuste selon ton widget */
  body[data-page="textos"] .crisp-client {
    bottom: 120px !important;
  }
}
```

Ou plus simple : cache-le complètement dans cette section (les actions Twilio remplacent le besoin de support live ici).

---

## Prompt à donner à Claude Code

> Lis `MOBILE_FIX.md` et applique les 7 fixes à `web/app/textos/TextosClient.tsx` et `web/app/globals.css`. Garde toutes les fonctions de `FUNCTIONS_TO_PRESERVE.md`. Travaille uniquement les styles mobile (< 768px), ne touche pas au layout desktop qui marche déjà. Vérifie en simulant 390×844 (iPhone 14) dans le devtools.

Coût estimé : **1 passe ciblée de ~15k input + ~10k output** avec Haiku 4.5.
