# Handoff — Refonte UI : Textos & Pipeline Deal

## Pour qui ?

**Claude Code (Sonnet 4.5 ou Haiku 4.5)** travaillant sur le repo `anthomb-cmyk/socle-v2`. Cette refonte touche **2 fichiers principaux** + **1 fichier de tokens CSS**. Aucune nouvelle dépendance, aucune migration de schéma, aucune route API à changer.

> **Économie de crédits** : tout le contexte est dans ce dossier. Pas besoin de relancer la conversation de design. Le diff est concentré dans `web/app/textos/TextosClient.tsx` et `web/app/pipeline/[id]/DealWorkspaceClient.tsx`. Tu peux faire les deux fichiers en une seule passe avec Haiku 4.5.

---

## Fidélité

**Hi-fi.** Les fichiers HTML dans `refs/` sont des maquettes pixel-précises avec couleurs, typo, espacements et états finaux. **Recrée-les dans le codebase Next.js existant** en gardant l'architecture React/TypeScript actuelle — **ne copie pas le HTML directement**. Réutilise les classes CSS existantes (`crm-*`) quand elles correspondent, sinon ajoute de nouvelles classes dans `web/app/globals.css`.

---

## Pourquoi cette refonte

Les utilisateurs (Anthony + 2 callers) ont identifié 2 pages comme problématiques :

1. **`/pipeline/[id]` (DealWorkspaceClient)** — 9 panneaux empilés verticalement créaient un scroll interminable. Le right-rail surchargé dupliquait des infos déjà visibles dans le dossier. Solution : **1 dossier compact en haut + 6 onglets** pour Notes/Appels/Textos/Activité/Checklist/Documents. Right-rail réduit à Contact + Offre + Prochaine action.

2. **`/textos` (TextosClient)** — 3 grosses tuiles de stats (Conversations / Liées pipeline / Inconnues) mangeaient le tiers supérieur de la page sans aider à agir. Quand une conversation est liée à un deal, ce lien EST le point — il faut le voir. Solution : **stats deviennent des chips de filtre**, et un **rail droit montre le deal complet** quand la conversation est liée.

**CRITIQUE — aucune fonction ne doit disparaître.** Voir checklist exhaustive dans `FUNCTIONS_TO_PRESERVE.md`.

---

## Fichiers à modifier

| Fichier | Action | Notes |
|---|---|---|
| `web/app/textos/TextosClient.tsx` | **Réécriture** (garde props, state, fetch, send logic) | Voir `refs/d-textos.html` + `refs/m-textos.html` + `refs/m-textos-thread.html` |
| `web/app/pipeline/[id]/DealWorkspaceClient.tsx` | **Réécriture** (garde props, state, patch fn, Twilio call state) | Voir `refs/d-deal.html` + `refs/m-deal.html` |
| `web/app/globals.css` | **Ajout** de classes/tokens — voir `DESIGN_TOKENS.md` | Garde tous les tokens existants, ajoute en parallèle |
| `web/app/textos/page.tsx` | **Aucun changement** | Les props server-side restent identiques |
| `web/app/pipeline/[id]/page.tsx` | **Aucun changement** | Idem |
| `/api/twilio/messages/send-direct` | **Aucun changement** | API inchangée |
| `/api/deals/[id]` (PATCH), `/api/deals/[id]/call` | **Aucun changement** | API inchangée |

---

## Maquettes de référence (`refs/`)

| Fichier | Vue | Largeur | Notes |
|---|---|---|---|
| `d-deal.html` | Desktop · workspace de deal | 1280px | Sidebar + topbar + dossier + tabs + right rail |
| `d-textos.html` | Desktop · liste + thread + context | 1280px | 3-col : list 320 / thread 1fr / context 300 |
| `m-deal.html` | Mobile · workspace de deal | 402px | Stage strip horizontal + tabs + sticky CTA |
| `m-textos.html` | Mobile · liste conversations | 402px | Cards chat-app + filtres + FAB |
| `m-textos-thread.html` | Mobile · conversation ouverte | 402px | Bubbles iMessage-style + composer + quick replies |
| `shared.css` | Tous les tokens utilisés | — | Source de vérité couleurs/typo |

**Ouvre chaque fichier dans un navigateur** pour le scrutiner — c'est exactement le rendu visé.

---

## Composants à créer (au choix de Claude Code)

Tu peux soit tout mettre inline dans les deux fichiers `Client.tsx`, soit extraire dans `web/app/textos/components/` et `web/app/pipeline/[id]/components/`. Recommandé d'extraire :

### Pour le deal page
- `<StageStepper currentStage onStageChange />` — barre horizontale 6 stages + bouton Abandonné séparé
- `<DossierCard deal dossier documents />` — header gold-tint avec 3 fact cards + 2 evidence cards
- `<DealTabs ...>` — wrapper d'onglets contrôlés (state local, pas de routage)
- `<ContactRailCard deal callState onCall />` — avatar + phone + Appeler + Composer manuellement
- `<OffreRailCard deal onEditOffer />` — fond dark, prix demandé + offre + écart + pills T°/priorité
- `<NextActionCard value onEdit />`
- `<CallsTab history />` — réutilise `CallHistoryPanel` existant, juste re-stylise les boutons
- `<ChecklistPanel ...>` — déjà existant, garde
- `<ActivityLog ...>` — déjà existant, garde

### Pour textos
- `<ThreadList items selected onSelect filter onFilterChange query onQueryChange />`
- `<ThreadConversation conv onSend status />` — header + bubbles + composer
- `<ContextRail conv recipients />` — deal card + templates rapides
- `<NewConversationPanel ...>` — déjà existant dans TextosClient, garde

---

## Documents à lire dans ce dossier

1. **`FUNCTIONS_TO_PRESERVE.md`** — checklist exhaustive de chaque fonction (button, input, state) à garder. À cocher pendant l'implémentation.
2. **`CHANGES.md`** — instructions détaillées par fichier, avec extraits TSX.
3. **`DESIGN_TOKENS.md`** — couleurs, typo, espacements à ajouter dans `globals.css`.
4. **`refs/*.html`** — maquettes exécutables.

---

## Test d'acceptation rapide

Après implémentation, ouvre `/pipeline/<un-id>` et `/textos` et vérifie :

- [ ] Tous les boutons existants sont présents et appellent les mêmes fetchs
- [ ] Le stage stepper change le stage et ajoute une activité
- [ ] L'auto-save fonctionne (champ éditable → blur → spinner → "Sauvegardé")
- [ ] L'appel Twilio bridge se lance et l'état (idle/ringing/answered/completed) s'affiche
- [ ] La checklist toggle persiste
- [ ] Le SMS envoyé apparaît dans le thread instantanément
- [ ] La conversation est correctement liée au deal dans le rail droit (textos)
- [ ] Mobile : les CTA sticky-bottom sont accessibles avec le pouce

---

## Style de prompt recommandé pour Claude Code

> "Ouvre `web/app/textos/TextosClient.tsx` et `web/app/pipeline/[id]/DealWorkspaceClient.tsx`. Lis aussi `design_handoff_socle_redesign/README.md`, `FUNCTIONS_TO_PRESERVE.md`, `CHANGES.md`, et les fichiers HTML dans `refs/`. Réécris les deux composants TSX pour matcher les maquettes en gardant TOUTES les fonctions de `FUNCTIONS_TO_PRESERVE.md` et toutes les props/fetch existants. Ajoute les classes CSS nécessaires à `globals.css` selon `DESIGN_TOKENS.md`. Travaille fichier par fichier, n'invente pas d'API."

Coût estimé : **1 passe de ~30k tokens d'input + ~25k de sortie** avec Haiku 4.5 = très raisonnable.
