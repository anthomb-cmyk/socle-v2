# Design Tokens — à ajouter à `globals.css`

> Source de vérité complète : **`refs/shared.css`**. Tu peux soit copier-coller le `:root` complet, soit prendre seulement ce qui suit.

---

## Stratégie d'intégration

Le repo a déjà des tokens `--crm-*` dans `globals.css` (vu dans le current `DealWorkspaceClient.tsx` qui référence `var(--crm-gold, #C9A84C)`, `var(--crm-bg-alt, #F9FAFB)`, etc.).

**Option A — Étendre l'existant** (recommandé) : ajoute les nouveaux tokens à côté des `--crm-*` en gardant les fallbacks. Les composants existants continuent de marcher.

**Option B — Migration progressive** : ajoute un fichier `web/app/socle-design.css` importé après `globals.css` dans `layout.tsx`, qui contient les nouveaux tokens. Plus propre mais demande de basculer tous les composants.

---

## Tokens — fond, surface, bordures (warm neutral)

```css
:root {
  /* Surface */
  --socle-bg:            oklch(0.965 0.012 85);   /* page bg, warm off-white */
  --socle-bg-alt:        oklch(0.945 0.014 82);
  --socle-surface:       #ffffff;
  --socle-surface-alt:   oklch(0.985 0.008 85);
  --socle-surface-sunken: oklch(0.93 0.014 80);

  /* Bordures */
  --socle-border:        oklch(0.88 0.012 80);
  --socle-border-soft:   oklch(0.92 0.010 80);
  --socle-border-strong: oklch(0.78 0.014 80);

  /* Texte */
  --socle-ink:    oklch(0.20 0.012 75);
  --socle-ink-2:  oklch(0.36 0.010 75);
  --socle-ink-3:  oklch(0.52 0.008 75);
  --socle-ink-4:  oklch(0.68 0.008 75);
  --socle-ink-inv: #fbf8f2;
}
```

---

## Marque — or raffiné

```css
:root {
  --socle-gold:        oklch(0.62 0.10 78);    /* CTA primary */
  --socle-gold-deep:   oklch(0.48 0.10 70);    /* hover/pressed */
  --socle-gold-soft:   oklch(0.93 0.05 85);    /* selected bg */
  --socle-gold-tint:   oklch(0.96 0.025 85);   /* highlight subtil */
  --socle-gold-border: oklch(0.82 0.07 82);
}
```

L'or est **réservé** à :
- Le CTA primary (Appeler, Nouveau texto, Envoyer)
- Les bulles SMS sortantes (mobile)
- L'accent du dossier (badge "N appels liés", cards evidence)
- Les liens "deal lié" dans les cards de conversation

Tout le reste est en **ink** (texte) ou **surface** (cartes).

---

## Couleurs sémantiques

```css
:root {
  --socle-green:        oklch(0.55 0.10 150);   /* succès, "Confirmé" */
  --socle-green-soft:   oklch(0.93 0.04 150);
  --socle-green-border: oklch(0.80 0.07 150);

  --socle-amber:        oklch(0.62 0.13 70);    /* "Tiède", warnings */
  --socle-amber-soft:   oklch(0.93 0.07 75);

  --socle-red:          oklch(0.53 0.17 25);    /* "Chaud", DNC, erreurs */
  --socle-red-soft:     oklch(0.94 0.05 25);

  --socle-blue:         oklch(0.50 0.10 245);
  --socle-blue-soft:    oklch(0.94 0.03 245);

  --socle-purple:       oklch(0.48 0.13 295);
  --socle-purple-soft:  oklch(0.94 0.04 295);
}
```

**Règle** : ne jamais saturer plus que ces valeurs. Pas de couleurs « néon » ni de gradients colorés.

---

## Mapping température / priorité (déjà dans le code)

Le `TEMP_CONFIG` actuel utilise des hex inline :
- froid : `#EFF6FF` / `#1D4ED8` → remplace par `var(--socle-blue-soft)` / `var(--socle-blue)`
- tiede : `#FFFBEB` / `#92400E` → `var(--socle-amber-soft)` / `var(--socle-amber)`
- chaud : `#FEF2F2` / `#B91C1C` → `var(--socle-red-soft)` / `var(--socle-red)`

Idem pour `STAGE_COLORS` : remplace les hex bleu/violet/orange/vert par les tokens sémantiques.

---

## Typographie

```css
:root {
  --socle-font:   "Geist", system-ui, -apple-system, "Segoe UI", sans-serif;
  --socle-mono:   "Geist Mono", ui-monospace, "SF Mono", monospace;
  --socle-serif:  "Newsreader", "Iowan Old Style", Georgia, serif;
}
```

**Import Google Fonts** (à mettre dans `layout.tsx` ou `globals.css`) :

```
@import url("https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600&family=Newsreader:ital,wght@1,500&display=swap");
```

Si le repo utilise déjà `next/font` pour Geist, garde cette approche et ajoute juste Newsreader.

### Échelle typographique (utilisée dans les maquettes)

| Usage | Taille | Weight | Letter-spacing | Famille |
|---|---|---|---|---|
| H1 page (desktop) | 30–32px | 600 | -0.025em | Geist |
| H1 mobile | 28px | 700 | -0.03em | Geist |
| H2 (titre carte) | 18–22px | 600 | -0.02em | Geist |
| Body | 13.5px | 400 | normal | Geist |
| Body large (bubbles) | 14–15px | 400 | normal | Geist |
| Label / kicker | 10–11px | 700 | 0.10em | Geist UPPERCASE |
| Mono (numéros, timestamps) | 12–14px | 500–600 | -0.02em | Geist Mono |
| AI briefing | 14–16px italique | 500 | normal | Newsreader |

**Règle mono** : tous les nombres (téléphones, prix, comptes, timestamps) en Geist Mono pour faciliter le scan.

**Règle serif italique** : réservée aux copies générées par l'AI (briefing, analyse, "Stade changé → X" dans le journal).

---

## Échelle d'espacement & rayons

```css
:root {
  --socle-r-xs: 6px;
  --socle-r-sm: 8px;
  --socle-r-md: 12px;
  --socle-r-lg: 16px;
  --socle-r-xl: 22px;
  --socle-r-pill: 999px;
}
```

| Élément | Radius |
|---|---|
| Pills, chips | 999px |
| Boutons | 12px |
| Cards | 14–16px |
| Carte hero (dossier) | 16px |
| Inputs | 10–12px |
| Bubbles SMS desktop | 12–14px |
| Bubbles SMS mobile | 18px (iMessage-style) |

Espacement vertical entre cards : **14–16px**. Padding interne de card : **18px 20px** (desktop), **14px 16px** (mobile).

---

## Ombres

```css
:root {
  --socle-sh-1: 0 1px 2px rgba(40, 30, 10, 0.04), 0 1px 0 rgba(40,30,10,0.02);
  --socle-sh-2: 0 1px 3px rgba(40, 30, 10, 0.06), 0 8px 24px -12px rgba(40,30,10,0.10);
  --socle-sh-3: 0 2px 6px rgba(40, 30, 10, 0.08), 0 18px 40px -16px rgba(40,30,10,0.18);
  --socle-sh-gold: 0 6px 24px -8px oklch(0.62 0.10 78 / 0.45);
}
```

Usage :
- `sh-1` : link actif dans sidebar, cartes calmes
- `sh-2` : panneaux qui flottent (right rail collé en sticky)
- `sh-3` : popovers, modals
- `sh-gold` : sous les CTA primary gold (Appeler, Envoyer)

---

## Pills d'état (à recréer en CSS si pas déjà fait)

Voir `refs/shared.css` lignes ~95–110 pour les définitions complètes. Variantes utilisées :

| Classe | Couleur | Usage |
|---|---|---|
| `.pill--ready` | green | Confirmé, OK |
| `.pill--review` | amber | Tiède, à valider |
| `.pill--hot` | red | Chaud, urgent |
| `.pill--cold` | gris | DNC, archivé |
| `.pill--info` | blue | Info neutre |
| `.pill--brand` | gold | "Priorité X" |
| `.pill--new` | blanc | Nouveau, par défaut |
| `.pill--pipeline` | purple | Stage en cours |

Toutes en `font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px;` avec un petit dot `5×5px` à gauche.

---

## Composants spécifiques

### Stage stepper (deal page)
- Container : `--socle-surface-sunken` avec 3px de padding, border-radius 10px
- Stage button : padding 7×10, font 12px, weight 600
- Active : `background: var(--socle-ink); color: var(--socle-ink-inv);` + dot gold à gauche
- Done : `background: var(--socle-green-soft); color: oklch(0.40 0.10 150);` + icône check
- Bouton Abandonné séparé, border rouge

### Tab bar
- Underline 2px en `--socle-gold` sous l'onglet actif
- Texte 13px / weight 600
- Compteur en pill mono à droite du label (gold-soft si actif, bg-alt sinon)

### SMS bubbles
- **Desktop** : bubble--out fond `--socle-gold-tint` + border `--socle-gold-border`. bubble--in fond `--socle-surface-alt`.
- **Mobile** : bubble--out fond plein `--socle-gold` couleur blanc (style iMessage). bubble--in fond `--socle-surface` border `--socle-border-soft`.

### Offre card (right rail, dark)
- `background: var(--socle-ink); color: var(--socle-ink-inv);`
- `::after` : radial gradient gold en haut à droite, opacity 0.28
- 3 rows avec border-top entre chacune
- 3 pills en bas (Température / Priorité / Unités)

### Avatar
- 32–52px selon contexte
- Initiales bold avec `letter-spacing: 0.04em`
- Background : `--socle-gold-soft`, border `--socle-gold-border`, color `--socle-gold-deep`
- Variant unknown : background `--socle-amber-soft`, color `--socle-amber`

---

## Focus ring

```css
:focus-visible { outline: 2px solid var(--socle-gold); outline-offset: 2px; }
```

---

## Dark mode

Pas demandé dans cette phase. Si tu veux le préparer, garde les couleurs en `oklch` (déjà fait) — c'est facile à inverser plus tard avec un `@media (prefers-color-scheme: dark)`.

---

## Vérification rapide

Une fois `globals.css` mis à jour, ouvre n'importe quel fichier `refs/*.html` localement (juste double-clic) — il importe `shared.css` qui est le golden master. Si la version Next.js rend différemment, c'est probablement :

1. Un token manquant (chercher `var(--socle-...)` non défini)
2. Une classe utilitaire non portée (chercher `.pill--`, `.btn--`, `.mono`, etc.)
3. Une police pas chargée (vérifier l'import `@font-face`)
