# Changes — file by file

> Instructions précises pour Claude Code. Travaille fichier par fichier. Tous les exemples TSX ci-dessous sont des **squelettes** — ajuste aux conventions existantes du repo (imports, exports, etc.).

---

## 1. `web/app/globals.css`

**Ajoute** ces tokens en haut de la section `:root` (garde tous les tokens existants — c'est un AJOUT, pas un remplacement). Tu peux préfixer avec `--socle-` si tu veux éviter les collisions avec d'éventuels tokens `--crm-*` existants.

Voir `DESIGN_TOKENS.md` pour la liste complète. Pour l'implémentation tu peux aussi simplement importer/inliner les classes utilitaires du fichier `refs/shared.css` (qui est auto-suffisant).

**Classes utilitaires à reproduire** (présentes dans `refs/shared.css`) :
- `.pill`, `.pill--ready/review/hot/cold/info/brand/new/pipeline`
- `.btn`, `.btn--primary/gold/ghost/sm/lg/xl/block`
- `.avatar`
- `.mono`, `.tabular`

Ces classes sont DÉJÀ utilisées partout dans les maquettes. Tu peux les copier-coller depuis `refs/shared.css` vers `globals.css` ou créer un fichier séparé `web/app/socle-design.css` importé dans `layout.tsx`.

---

## 2. `web/app/textos/TextosClient.tsx` — réécriture

### Layout cible (desktop)

```
┌────────────────────────────────────────────────────────────┐
│ HEADER (eyebrow + titre + sous-titre + bouton "Nouveau")   │
├─────────────┬────────────────────────┬─────────────────────┤
│ LIST 320px  │  THREAD (1fr)          │ CONTEXT RAIL 300px  │
│             │                        │                     │
│ search      │  Header (avatar, name, │  Deal lié (si       │
│ filters     │   phone, link pills)   │   selected.dealId)  │
│             │                        │                     │
│ thread      │  Day dividers          │  Modèles rapides    │
│ cards       │  Bubbles in/out        │                     │
│             │                        │                     │
│             │  Composer (textarea +  │                     │
│             │   tools + Send)        │                     │
└─────────────┴────────────────────────┴─────────────────────┘
```

### Layout cible (mobile, < 768px)

Mobile shows **soit** la liste **soit** le thread (pas les deux). Utilise un state `view: "list" | "thread"` (déjà similaire à `selectedId`).

- **Liste** : `m-textos.html` — cartes 76px, avatar 52px, FAB pour Nouveau, filtres horizontaux scrollables, regroupement par jour ("Aujourd'hui" / "Cette semaine")
- **Thread** : `m-textos-thread.html` — header `←` avec avatar + name + boutons call/menu, deal strip (gold-tint), bubbles iMessage-style (gold pour outbound), quick replies, composer arrondi

### Squelette TSX

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

// ... types et props identiques

type Filter = "all" | "linked" | "unknown" | "unread";

export default function TextosClient({ conversations, recipients }: Props) {
  // ─── State : GARDE TOUT ───
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

  // ─── NOUVEAU state pour la refonte ───
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  // Computed
  const selected = useMemo(/* ... idem */);
  const filteredRecipients = useMemo(/* ... idem */);
  const selectedRecipient = /* ... idem */;

  // Filtered items pour la liste
  const filteredItems = useMemo(() => {
    let result = items;
    if (filter === "linked") result = result.filter(i => i.dealId);
    if (filter === "unknown") result = result.filter(i => !i.contactId && !i.leadId && !i.dealId);
    // unread = sans état "lu" dans le modèle actuel → traiter comme "items avec dernier message inbound non vu" si tu ajoutes ce champ plus tard, sinon laisser le bouton inactif
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(i =>
        (i.contactName ?? i.dealTitle ?? "").toLowerCase().includes(q)
        || i.number.includes(q)
      );
    }
    return result;
  }, [items, filter, query]);

  const counts = useMemo(() => ({
    all: items.length,
    linked: items.filter(i => i.dealId).length,
    unknown: items.filter(i => !i.contactId && !i.leadId && !i.dealId).length,
  }), [items]);

  async function sendReply() { /* ... GARDE INTACT ... */ }
  async function sendNewConversation() { /* ... GARDE INTACT ... */ }

  return (
    <main className="textos-page">
      <TextosHeader
        countOnSocleNumber={items.length}
        onNewMessage={() => { setNewOpen(o => !o); setStatus("idle"); setError(null); }}
      />

      <div className="textos-shell">
        <ThreadList
          items={filteredItems}
          counts={counts}
          filter={filter} onFilterChange={setFilter}
          query={query} onQueryChange={setQuery}
          selectedId={selected?.id}
          onSelect={(id) => { setSelectedId(id); setMobileView("thread"); setStatus("idle"); setError(null); }}
        />

        <ThreadConversation
          selected={selected}
          newOpen={newOpen}
          // pour le panneau new :
          newMode={newMode} setNewMode={setNewMode}
          recipientQuery={recipientQuery} setRecipientQuery={setRecipientQuery}
          filteredRecipients={filteredRecipients}
          recipientId={recipientId} setRecipientId={setRecipientId}
          selectedRecipient={selectedRecipient}
          randomNumber={randomNumber} setRandomNumber={setRandomNumber}
          newMessage={newMessage} setNewMessage={setNewMessage}
          newStatus={newStatus} newError={newError}
          onSendNew={sendNewConversation}
          // pour le composer normal :
          draft={draft} setDraft={setDraft}
          status={status} error={error}
          onSend={sendReply}
          // mobile back
          onBackToList={() => setMobileView("list")}
        />

        <ContextRail selected={selected} />
      </div>
    </main>
  );
}
```

### Composants sub à créer

Tu peux soit les laisser inline dans `TextosClient.tsx` (le fichier passera de ~400 lignes à ~600), soit les extraire dans `web/app/textos/components/`. **Recommandé d'extraire** pour la lisibilité.

#### `<TextosHeader>`
- Eyebrow `Twilio · SMS`
- Titre `Textos`
- Sous-titre (le texte actuel)
- **À droite** : bouton "Modèles" (secondary), bouton "Nouveau texto" (gold primary)

#### `<ThreadList>`
- Sticky top : search bar + 4 filter chips (Toutes · Liées · Inconnues · Non lus avec counts mono)
- Liste scrollable : chaque carte = avatar (initiales OU `?` ambré pour inconnu) + nom + heure + numéro + preview 2 lignes + chip "deal lié" OU action "Lier à un deal"

#### `<ThreadConversation>`
- Si `newOpen`, render le panneau Nouveau texto (voir `refs/d-textos.html` n'a pas ce panneau — réutilise le HTML du current `TextosClient.tsx`, juste restyle avec les tokens). Le segmented control + recipient search + textarea doivent rester fonctionnels.
- Sinon, header (avatar + nom + numéro + link pills Pipeline/Lead/Contact)
- Day dividers entre groupes de messages (split par jour avec `Intl.DateTimeFormat`)
- Bubbles `bubble--in` / `bubble--out`
- Composer : textarea + ligne d'outils (templates, attach, planifier, char count `0 / 320 · 1 SMS`) + bouton Envoyer
- Hint sous le composer selon `status`

#### `<ContextRail>`
- Si `selected.dealId` → render `<DealCard dealId={selected.dealId} title={selected.dealTitle} stage={selected.dealStage} ...>` qui fetch les détails OU passe par les props server-side
  - **Note** : actuellement `TextoConversation` ne contient que `dealId`, `dealTitle`, `dealStage`. Si tu veux montrer unités/prix dans le rail comme dans `d-textos.html`, **enrichis le RPC server-side** (`web/app/textos/page.tsx`) pour joindre `deals` et envoyer ces champs en plus. Sinon, affiche juste les 3 champs disponibles + bouton "Ouvrir le deal".
- Sinon, si `selected.leadId` → mini card lead avec lien
- Sinon, si `selected.contactId` → mini card contact
- Sinon → empty state "Conversation non liée — l'identifier ?"
- En dessous : section "Modèles rapides" (3-4 templates statiques)

---

## 3. `web/app/pipeline/[id]/DealWorkspaceClient.tsx` — réécriture

### Layout cible (desktop)

```
┌────────────────────────────────────────────────────────────┐
│ TOPBAR (sticky): crumbs · save indicator · pill T°         │
│ STAGE STEPPER (sticky): 6 segments + bouton Abandonné      │
├─────────────────────────────────────────┬──────────────────┤
│ MAIN COLUMN (1fr)                       │ RIGHT RAIL 360px │
│                                         │ (sticky)         │
│ DossierBeforeCall (gold-tint)           │ ContactCard      │
│   3 fact cards + 2 evidence cards       │  Appeler + state │
│                                         │                  │
│ Tabs (Notes / Appels / Textos /         │ OffreCard (dark) │
│       Activité / Checklist / Docs)      │  prices + pills  │
│                                         │                  │
│ Tab content area :                      │ NextAction       │
│   Notes : 3 textareas éditables         │                  │
│   Appels : list (réutilise              │ Meta footer      │
│            CallHistoryPanel)            │  Créé / Modifié  │
│   Textos : thread inline +              │                  │
│            "Ouvrir Textos" link         │                  │
│   Activité : ActivityLog                │                  │
│   Checklist : ChecklistPanel            │                  │
│   Docs : list ou empty                  │                  │
└─────────────────────────────────────────┴──────────────────┘
```

### Layout cible (mobile)

Tout en colonne unique. Bottom sticky CTA bar avec **Appeler** (gold, 2/3) + **SMS** (1/3). Tabs horizontales sticky sous le hero. Voir `m-deal.html`.

### Squelette

```tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import TwilioCallStatePanel, { type CallState } from "@/app/calls/[leadId]/components/TwilioCallStatePanel";
import CallHistoryPanel from "@/app/calls/[leadId]/CallHistoryPanel";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";

// Types, constantes, helpers : INCHANGÉS (voir FUNCTIONS_TO_PRESERVE.md)
const STAGE_ORDER = [...];
// ...

type DealTab = "notes" | "calls" | "sms" | "activity" | "checklist" | "docs";

export default function DealWorkspaceClient({ deal: initialDeal, documents, callHistory, dossier, smsMessages }: Props) {
  // ─── State : GARDE TOUT ───
  const [deal, setDeal] = useState(initialDeal);
  const [saving, setSaving] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const activeCallLogId = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── NOUVEAU state ───
  const [activeTab, setActiveTab] = useState<DealTab>("notes");

  // ─── Toutes les fonctions : INCHANGÉES ───
  // stopPolling, startPolling, startDealCall, patch,
  // handleStageChange, handleChecklistToggle, handleActivityAdd
  // useEffect cleanup polling

  const temp = TEMP_CONFIG[deal.temperature] ?? TEMP_CONFIG.tiede;

  return (
    <div className="deal-page">
      <DealTopbar deal={deal} temp={temp} saving={saving} />
      <StageStepper currentStage={deal.stage} onStageChange={handleStageChange} />

      <div className="deal-body">
        <div className="deal-main">
          <DossierBeforeCall deal={deal} documents={documents} dossier={dossier} />

          <DealTabs activeTab={activeTab} onChange={setActiveTab} counts={{
            calls: callHistory.length,
            sms: smsMessages.length,
            activity: deal.activities?.length ?? 0,
            docs: documents.length,
          }}>
            {activeTab === "notes" && <NotesPane deal={deal} patch={patch} />}
            {activeTab === "calls" && <CallHistoryPanel history={callHistory} />}
            {activeTab === "sms" && <SmsConversationPanel deal={deal} messages={smsMessages} />}
            {activeTab === "activity" && <ActivityLog activities={deal.activities ?? []} onAdd={handleActivityAdd} />}
            {activeTab === "checklist" && <ChecklistPanel stage={deal.stage} checklists={deal.checklists} onToggle={handleChecklistToggle} />}
            {activeTab === "docs" && <DocsPane documents={documents} />}
          </DealTabs>
        </div>

        <aside className="deal-rail">
          <ContactRailCard
            deal={deal}
            callState={callState} durationSec={durationSec} callError={callError}
            onCall={startDealCall}
            onPatchDeal={patch}
          />
          <OffreRailCard deal={deal} onPatch={patch} />
          <NextActionCard value={deal.next_action} onPatch={(v) => patch({ next_action: v }, { next_action: v })} />
          <MetaFooter createdAt={deal.created_at} updatedAt={deal.updated_at} dealId={deal.id} />
        </aside>
      </div>
    </div>
  );
}
```

### `<NotesPane>`
3 sections empilées, chacune avec un `<EditableField type="textarea">` :
1. "Notes deal · générales" → `deal.notes_deal`
2. "Notes vendeur · motivation, délai, contexte" → `deal.notes_vendeur`
3. "Analyse AI · risques & opportunités" → `deal.ai_analysis` (fond gold-tint, italique serif Newsreader)

### `<DealTabs>`
Wrapper sticky-top sous le dossier. Tabs : Notes, Appels (count), Textos (count), Activité (count), Checklist, Documents (count). Underline gold sur l'active.

### `<ContactRailCard>`
- Header : avatar (initiales du nom) + nom + email
- Phone XL en mono
- Boutons : **Appeler** (gold, plein largeur sauf bouton SMS à côté carré)
- Lien "Composer manuellement" en dessous (tel: link)
- **État Twilio** sous les boutons quand `callState !== "idle"` :
  - `TwilioCallStatePanel` (composant existant) avec `callState` + `durationSec`
  - Erreur en rouge si `callError`

### `<OffreRailCard>` (dark)
- Background `var(--ink)` avec glow gold radial top-right
- Label "Offre · <ville>" en gold
- 3 rows : Prix demandé, Notre offre (cliquer pour éditer → utilise EditableField), Écart (computed, vert si offre ≤ ask)
- 3 pills bas : Température, Priorité, Unités

### `<NextActionCard>`
- Carte blanche simple
- Label "Prochaine action"
- EditableField text sur `deal.next_action`

### `<MetaFooter>`
- Texte mono petit gris : Créé, Modifié, deal_id tronqué

---

## 4. Responsive — breakpoints recommandés

| Breakpoint | Layout |
|---|---|
| `< 768px` | Mobile — single column, sticky bottom CTA |
| `768–1180px` | Tablet — main column + right rail mais collapse en mode "tablet" si serré |
| `≥ 1180px` | Desktop full — main 1fr + rail 360px |

Pour textos :

| Breakpoint | Layout |
|---|---|
| `< 768px` | Soit `list` soit `thread` (toggle `mobileView`) |
| `768–1100px` | Liste 280 + Thread 1fr (pas de context rail, contexte sous le header de la conv) |
| `≥ 1100px` | Liste 320 + Thread 1fr + Context 300 |

---

## 5. Choses à NE PAS faire

- ❌ Supprimer un champ éditable, même si la maquette ne le montre pas explicitement (mets-le dans un menu ou un onglet)
- ❌ Changer la signature des fetchs API
- ❌ Renommer les états (`callState`, `status`, etc.) — d'autres composants peuvent les surveiller indirectement
- ❌ Importer une nouvelle lib d'icônes ou de UI (utilise SVG inline comme dans les maquettes)
- ❌ Ajouter une lib de drag & drop ou animation lourde
- ❌ Toucher `web/app/textos/page.tsx` ou `web/app/pipeline/[id]/page.tsx` SAUF si tu veux enrichir le payload pour montrer plus d'infos sur le deal dans le rail textos (optionnel, peut être Phase 2)

---

## 6. Validation finale

Avant de commit, ouvre les deux pages dans un navigateur local et passe la checklist `FUNCTIONS_TO_PRESERVE.md` ligne par ligne. Tout doit marcher comme avant — juste plus joli et moins chargé.
