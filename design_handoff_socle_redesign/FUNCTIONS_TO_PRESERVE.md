# Fonctions à préserver — checklist

> Tout ce qui suit existe dans la version actuelle de `TextosClient.tsx` et `DealWorkspaceClient.tsx`. **Aucune ligne ne doit disparaître** lors de la refonte.

---

## `TextosClient.tsx` — toutes les fonctions

### Props (signature inchangée)
```ts
export default function TextosClient({
  conversations: TextoConversation[],
  recipients: TextoRecipient[],
})
```

### State (garde tous les useState)
- [ ] `items` — liste mutable des conversations (mises à jour locales après envoi)
- [ ] `selectedId` — conversation active
- [ ] `draft` — brouillon de réponse
- [ ] `status` — `"idle" | "sending" | "sent" | "failed"` pour `sendReply`
- [ ] `error` — message d'erreur d'envoi
- [ ] `newOpen` — panneau "Nouveau texto" ouvert
- [ ] `newMode` — `"known" | "random"` (Contact CRM vs Numéro libre)
- [ ] `recipientQuery` — recherche dans le panneau new
- [ ] `recipientId` — destinataire sélectionné
- [ ] `randomNumber` — numéro libre
- [ ] `newMessage` — brouillon du premier message
- [ ] `newStatus`, `newError` — pareil mais pour `sendNewConversation`

### Fonctions async
- [ ] `sendReply()` — POST `/api/twilio/messages/send-direct`, met à jour le thread local avec le SMS envoyé
- [ ] `sendNewConversation()` — POST même endpoint, crée OU merge une conversation, sélectionne, ferme le panneau new

### UI — chaque élément doit exister
- [ ] Header : eyebrow `Twilio · SMS`, titre `Textos`, sous-titre explicatif
- [ ] Bouton **Nouveau texto** (toggle le panneau)
- [ ] 3 métriques : Conversations / Liées pipeline / Inconnues
  - **Refonte** : transformer en chips de filtre dans la colonne liste (voir maquette `d-textos.html`)
- [ ] **Liste de conversations** (gauche)
  - Affiche `contactName ?? dealTitle ?? number`
  - Numéro en sous-titre
  - Dernier message en preview
  - Timestamp court (`formatShortDate`)
  - État actif visuel
- [ ] **Empty state** si `items.length === 0`
- [ ] **Conversation détaillée** (header + messages + composer)
  - Titre = nom ou deal ou numéro
  - Numéro affiché
  - **Liens contextuels** : `Pipeline` (si dealId), `Lead` (si leadId), `Contact` (si contactId), ou `Non reconnu`
    - Chacun pointe vers `/pipeline/<dealId>` etc.
- [ ] **Bubbles** in/out avec `body` + meta (`Reçu/Envoyé · formatFullDate`)
- [ ] Si `body` vide → `"Message vide"`
- [ ] **Composer** (textarea)
  - `maxLength={1000}`, `rows={3}`
  - Placeholder `Répondre à <nom>`
  - Bouton Envoyer disabled si `!draft.trim() || status === "sending"`
  - Label dynamique : "Envoi..." / "Envoyer"
  - Hint texte selon status :
    - `sent` → "Texto envoyé depuis le numéro Twilio."
    - `failed` → `error`
    - sinon → "Le client voit seulement le numéro Twilio, pas ton cell personnel."
- [ ] **Panneau Nouveau texto** (quand `newOpen`)
  - Header titre + sous-titre
  - **Segmented control** : `Contact CRM` / `Numéro libre`
  - **Mode known** : input recherche (`recipientQuery`) + liste filtrée (60 max) avec label + sublabel + numéro
  - **Mode random** : input téléphone libre
  - Textarea premier message (`maxLength={1000}`, `rows={4}`)
  - Bouton Envoyer disabled selon `newMode` et état
  - Hint texte selon `newStatus`

### Helpers (garde tels quels)
- [ ] `formatShortDate(value)` — `Intl.DateTimeFormat fr-CA` month+day+hour+minute
- [ ] `formatFullDate(value)` — `dateStyle: medium, timeStyle: short, timeZone: America/Toronto`
- [ ] Composant interne `<Metric label value tone />` — utilisé pour les 3 métriques (reste dans le code, sert pour les chips de filtre)

---

## `DealWorkspaceClient.tsx` — toutes les fonctions

### Props (signature inchangée)
```ts
export default function DealWorkspaceClient({
  deal: Deal,
  documents: DealDocument[],
  callHistory: HistoryRow[],
  dossier: DealDossier,
  smsMessages: DealSmsMessage[],
})
```

### Types (garde)
- [ ] `CheckItem`, `DealDocument`, `Activity`, `DealSmsMessage`, `Deal`, `DealDossier`

### Constantes (garde)
- [ ] `STAGE_ORDER` (7 stages incluant `abandonne`)
- [ ] `STAGE_LABELS` (mapping français)
- [ ] `STAGE_COLORS` (mapping hex pour chaque stage)
- [ ] `TEMP_CONFIG` (froid/tiede/chaud avec bg/text)
- [ ] `formatCAD`, `formatDate`, `formatMaybeDate`, `timelineLabel`, `excerpt`

### State (garde tous)
- [ ] `deal` — état local mutable
- [ ] `saving` — spinner auto-save
- [ ] `callState` — `"idle" | "initiating" | "ringing" | "answered" | "completed" | "failed"`
- [ ] `callError` — string ou null
- [ ] `durationSec` — durée de l'appel en cours
- [ ] `activeCallLogId` — useRef pour le callLogId actif
- [ ] `pollRef` — useRef pour le setInterval de polling

### Fonctions
- [ ] `stopPolling()` — clear interval
- [ ] `startPolling(callLogId)` — poll `/api/calls/status?callLogId=...` toutes les 3s, met à jour state selon statusEvents
- [ ] `startDealCall()` — POST `/api/deals/<id>/call`, gère états + démarre polling
- [ ] `patch(fields, optimistic)` — PATCH `/api/deals/<id>`, optimistic update + rollback sur erreur
- [ ] `handleStageChange(stage)` — patch + ajoute activité `Stade changé → <label>`
- [ ] `handleChecklistToggle(stage, itemId, done)` — patch checklists pour ce stage
- [ ] `handleActivityAdd(text)` — ajoute entrée en tête + patch

### Composants internes (garde, restyle visuellement)
- [ ] `StageProgressBar` → devient `<StageStepper>` (voir maquette)
- [ ] `ChecklistPanel` — garde la logique (toggle, progress, % done, "Toutes les étapes complètes !")
- [ ] `EditableField` — garde TOUS les types (`text | number | textarea | select-temp | select-priority`)
  - Mode édition avec input/textarea/select
  - Boutons Sauvegarder/Annuler
  - Enter pour valider, Escape pour annuler
  - Affichage `— (cliquer pour modifier)` si vide
- [ ] `ActivityLog` — input + bouton + liste avec dots et timestamps
- [ ] `SmsConversationPanel` — header avec lien "Ouvrir Textos" → `/textos`, bubbles inbound/outbound
- [ ] `DossierBeforeCall` — kicker + title + tag `N appels liés` + 3 fact cards + 2 evidence cards
- [ ] `DossierFactCard` (Bâtiment / Vendeur / Données ajoutées)
- [ ] `EvidenceCard` — title + body + optional footer

### UI — sections présentes dans la page actuelle (toutes à garder)
- [ ] Top bar : `← Pipeline` link, titre du deal, pill température, label "Sauvegarde…" si `saving`
- [ ] Stage progress bar : 6 stages cliquables (`handleStageChange`) + bouton Abandonné séparé
- [ ] **Dossier avant appel** (DossierBeforeCall complet)
- [ ] **Notes deal** — EditableField textarea sur `deal.notes_deal`
- [ ] **Notes vendeur** — EditableField textarea sur `deal.notes_vendeur`
- [ ] **Analyse AI** — EditableField textarea sur `deal.ai_analysis`
- [ ] **Checklist** — ChecklistPanel + fallback "Aucune checklist pour ce stade." si vide
- [ ] **SMS conversation** (si `smsMessages.length > 0`) — SmsConversationPanel
- [ ] **Activity log** — ActivityLog (toujours visible, garde l'ordre desc)
- [ ] **Historique d'appels** (si `callHistory.length > 0`) — `<CallHistoryPanel history={callHistory} />` importé depuis `@/app/calls/[leadId]/CallHistoryPanel`
- [ ] **Documents** — liste avec nom, taille KB, date formatée, OU "Aucun document attaché."

### Right rail — tout présent
- [ ] **Détails du deal** : 7 EditableField (titre, adresse, unités number, asking_price number, offer_price number, température select, priorité select)
- [ ] **Prices summary** (uniquement si `asking_price || offer_price`) — bloc green-soft avec prix demandé / notre offre / écart (vert si offre ≤ ask, rouge sinon)
- [ ] **Contact vendeur** : 3 EditableField (nom, téléphone, courriel) + bouton **Appeler** (gold) qui :
  - Affiche état selon `callState` (Connexion… / Sonnerie… / En cours…)
  - Disabled pendant un appel actif
  - Erreur affichée si `callError`
  - **Twilio Call State Panel** (`<TwilioCallStatePanel callState durationSec />`) sous le bouton pendant un appel
  - Lien fallback `Composer manuellement` avec `tel:`
- [ ] **Prochaine action** — EditableField sur `deal.next_action`
- [ ] **Meta footer** : `Créé:` + `Modifié:` formatées

### Imports critiques à garder
```ts
import TwilioCallStatePanel, { type CallState } from "@/app/calls/[leadId]/components/TwilioCallStatePanel";
import CallHistoryPanel from "@/app/calls/[leadId]/CallHistoryPanel";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";
import Link from "next/link";
```

### Cleanup
- [ ] `useEffect(() => () => stopPolling(), [])` — cleanup du polling au unmount

---

## API endpoints (aucun changement)

| Endpoint | Méthode | Utilisé par |
|---|---|---|
| `/api/twilio/messages/send-direct` | POST | Textos · sendReply, sendNewConversation |
| `/api/deals/[id]` | PATCH | Deal · patch (toutes les modifs auto-save) |
| `/api/deals/[id]/call` | POST | Deal · startDealCall (bridge Twilio) |
| `/api/calls/status?callLogId=...` | GET | Deal · startPolling |

---

## Si tu hésites

**Règle** : si tu vois une fonction dans le code actuel et qu'elle n'est pas dans une maquette, **garde-la et trouve-lui une place** (un onglet, un menu kebab, un sticky bottom). Ne supprime jamais en silence.
