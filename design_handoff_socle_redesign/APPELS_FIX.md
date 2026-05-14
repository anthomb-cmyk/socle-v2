# APPELS FIX — Mobile Récents + Clavier · à refondre

> Les screenshots production montrent une page d'appels au design **iOS-clone fade** qui ne respecte pas le langage Socle (warm neutrals, gold accent, mono pour les chiffres). Cette refonte ramène la cohérence visuelle et améliore l'utilité.

**Maquette finale** : `refs/m-appels.html` — ouvre-la dans un navigateur à 402×874 pour le rendu exact.

---

## Problèmes identifiés (screenshots actuels)

### Vue Récents
1. **Toggle "Tous / Manqués" déformé** — la pilule blanche dépasse en haut/bas du container
2. **Icône téléphone or répétée** à chaque ligne — bruit visuel, pas d'usage clair
3. **Lignes verticales décoratives** entre l'icône et la rangée — laides
4. **"Numéro inconnu" répété 5×** sans hiérarchie — toutes les rangées se ressemblent
5. **Pas d'avatar pour les contacts connus** (Isabelle St-Jean n'a pas d'initiales)
6. **Date inconsistante** : "Hier" vs "12 mai" sans groupement
7. **Manqué = nom rouge mais sans icône claire** — le badge directionnel manque
8. **Double segmented control en bas** (Récents/Clavier) qui duplique avec le tab bar — confus

### Vue Clavier
1. **Pad blanc sur cream avec lettres ABC/DEF** — copie iOS sans aucune personnalité
2. **Bouton "Appeler" gris** — devrait être or, plein, prominent
3. **"Entre un numéro" en gris sur cream** — invisible
4. **Pas de recherche** par contact/lead/deal
5. **Pas de suggestion** quand le numéro saisi correspond à un contact
6. **Bouton effacer rond, gris** — devrait être une icône backspace claire
7. **Pas d'option "coller"** depuis presse-papier

---

## Système redessiné

### 1. Header simple

```
Appels                            ← H1 32px weight 700
Numéro Socle · 514 555-0010       ← mono 12.5px, ink-3
```

### 2. Toggle Récents / Clavier (pas de duplication avec tab bar)

Pilule à 2 colonnes 50/50 dans `surface-sunken`, avec un bouton blanc et ombre `sh-1` qui glisse. Icône à gauche du label.

```css
.view-toggle {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 4px;
  background: var(--surface-sunken);
  border-radius: 12px;
  padding: 3px;
}
.vt-btn {
  padding: 9px 14px; border: 0; border-radius: 10px;
  background: transparent;
  font-size: 13px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
.vt-btn--active {
  background: var(--surface);
  box-shadow: var(--sh-1);
}
.vt-btn--active svg { color: var(--gold-deep); opacity: 1; }
```

### 3. Filter chips (4 filtres au lieu de 2)

`Tous` · `Manqués` (compteur rouge) · `Entrants` · `Sortants` — défilables horizontalement, pas de ligne séparatrice.

### 4. Groupes par jour

Format : `Hier · jeudi 13 mai` / `Mardi · 12 mai` — avec ligne fine `border-soft` qui s'étend après le label.

### 5. Call row · 1 design unique pour tous les cas

```
┌─────────────────────────────────────────────────────────────┐
│ [44×44 avatar]  Nom du contact            20 h 06          │
│                 Sortant · 0 m 26 s · Boîte vocale          │
│                 [chip] 585 Boul. Gouin · Offre déposée  📞 │
└─────────────────────────────────────────────────────────────┘
```

- **Avatar 44×44 carré arrondi** : initiales en gold sur gold-soft pour les contacts connus
- **Pour numéro inconnu** : avatar gris avec icône "user-plus"
- **Badge directionnel** en bas-droite de l'avatar (18×18, fond surface, icône ↙ entrant / ↗ sortant / ✕ manqué)
- **Nom** en 15px weight 700, ink (ou rouge si manqué)
- **Numéro de téléphone en mono** quand pas de nom : `(514) 555-0000`
- **Meta line** : direction + durée + statut (Boîte vocale, Transcrit, Enregistré) séparés par bullets `·` mini
- **Deal/Lead chip** dorée si lié, **action chip ambré "Lier à un lead"** si inconnu
- **Bouton rappeler à droite** : 38×38 ghost button avec icône phone or — UN SEUL, pas une rangée
- **Card complète tap target** → ouvre détail de l'appel

### 6. État manqué

```css
.call--missed {
  border-color: oklch(0.85 0.08 25);
  background: oklch(0.99 0.02 25);
}
.call--missed .call-n { color: var(--red); }
```

Badge directionnel rouge sur fond `red-soft` pour le distinguer.

### 7. Dialer redessigné

```
┌────────────────────────────────────────┐
│ 🔍 Chercher contact, lead, deal…       │ ← search bar gold-focusable
├────────────────────────────────────────┤
│                                        │
│         514 803-3                      │ ← mono 36px
│                                        │
│   Benoit Laverriere · 585 Boul. Gouin  │ ← suggestion auto quand match
│                                        │
├────────────────────────────────────────┤
│  [1]    [2 ABC]   [3 DEF]              │ ← keys 1.4:1 aspect, surface bg
│  [4 GHI] [5 JKL]  [6 MNO]              │   active: gold-tint + scale
│  [7 PQRS][8 TUV]  [9 WXYZ]             │
│  [∗]    [0 +]     [#]                  │
├────────────────────────────────────────┤
│  📋     [📞 Appeler Benoit]      ⌫     │ ← gold CTA pleine largeur
└────────────────────────────────────────┘
```

**CTA Appeler** :
- Background `--gold`, color blanc, hauteur 56px, `--r-lg` (18px)
- Box-shadow `--sh-gold`
- Label **dynamique** : "Appeler" si pas de match, "Appeler [Nom]" si le numéro correspond à un contact
- À gauche : bouton 📋 (coller depuis presse-papier)
- À droite : bouton ⌫ backspace

**Suggestion de contact** sous le numéro :
- Quand `tapez >= 4 chiffres`, query la liste des contacts/leads/deals
- Affiche `Nom · contexte` avec un lien vers le dossier
- Tap sur la suggestion → remplit le numéro complet et active le CTA

---

## Composants à créer (TSX)

### `<CallsToggleView>` — wrapper

```tsx
type View = "recents" | "dialer";
const [view, setView] = useState<View>("recents");

return (
  <main>
    <CallsHeader />
    <CallsViewToggle view={view} onChange={setView} />
    {view === "recents" ? <CallsRecentsList ... /> : <CallsDialer ... />}
  </main>
);
```

### `<CallsRecentsList>`

```tsx
type CallRow = {
  id: string;
  direction: "inbound" | "outbound" | "missed";
  contactName: string | null;
  number: string;
  durationSec: number | null;
  at: string;
  status?: "voicemail" | "transcribed" | "recorded";
  dealId: string | null;
  dealTitle: string | null;
  dealStage: string | null;
  leadId: string | null;
};

function CallsRecentsList({ calls, filter, onFilterChange }: Props) {
  const grouped = groupByDay(filteredCalls);
  return (
    <>
      <FilterChips filter={filter} onChange={onFilterChange} counts={counts} />
      {grouped.map(({ day, items }) => (
        <Fragment key={day}>
          <DayLabel day={day} />
          <div className="calls">
            {items.map(c => <CallRow key={c.id} call={c} />)}
          </div>
        </Fragment>
      ))}
    </>
  );
}
```

### `<CallRow call>`

Voir HTML dans `refs/m-appels.html` ligne ~280 pour la structure complète.

### `<CallsDialer>`

```tsx
function CallsDialer({ contacts }: Props) {
  const [buf, setBuf] = useState("");
  const [query, setQuery] = useState("");
  const match = useMemo(() => findContactByPrefix(contacts, buf), [contacts, buf]);

  function append(d: string) { setBuf(b => b + d); }
  function backspace() { setBuf(b => b.slice(0, -1)); }
  function paste() {
    navigator.clipboard.readText().then(t => setBuf(cleanPhone(t)));
  }

  return (
    <div className="dialer dialer--active">
      <DialSearch value={query} onChange={setQuery} />
      <DialDisplay number={buf} match={match} />
      <Keypad onPress={append} />
      <DialActions
        onPaste={paste}
        onCall={() => startCall(buf, match)}
        onBackspace={backspace}
        match={match}
      />
    </div>
  );
}
```

### `<DialDisplay>`

```tsx
function DialDisplay({ number, match }) {
  return (
    <div className="dial-display">
      <div className={`dial-num ${!number && "dial-num--empty"}`}>
        {number || "Entre un numéro"}
      </div>
      {match && (
        <div className="dial-hint">
          <span className="mono">{match.contactName}</span>
          <span className="dial-hint__dot"></span>
          <Link href={`/pipeline/${match.dealId}`}>{match.dealTitle}</Link>
        </div>
      )}
    </div>
  );
}
```

---

## Routes & API

- Page : `web/app/calls/page.tsx` ou `web/app/inbound-calls/page.tsx` selon où elle vit actuellement
- API : `/api/calls/recent` (probablement déjà existant) → retourne `CallRow[]`
- API : `/api/contacts/search?q=<prefix>` → pour la suggestion dans le dialer

**Si l'endpoint de recherche n'existe pas** : pass la liste complète des contacts en props server-side (probablement <500 entrées chez Socle, OK).

---

## Test d'acceptation

- [ ] Toggle Récents/Clavier fluide, pas de glitch visuel
- [ ] Tous les appels groupés par jour avec label clair
- [ ] Manqués distinguables au premier coup d'œil (rouge subtil)
- [ ] Avatar avec initiales pour les contacts connus
- [ ] Action "Lier" sur les numéros inconnus mène à un drawer
- [ ] Dialer : tap les chiffres écrit le numéro
- [ ] Dialer : numéro qui matche un contact → suggestion + CTA personnalisé
- [ ] Dialer : tap "Appeler" déclenche le bridge Twilio (réutilise `startCall` existant)
- [ ] Bouton "Coller" copie le presse-papier dans le numéro

---

## Prompt Claude Code

> Lis `refs/m-appels.html` et `APPELS_FIX.md`. Réécris la page d'appels mobile (`web/app/calls/page.tsx` + son client component) pour matcher la maquette. Garde le bridge Twilio existant pour le bouton Appeler. Ajoute un endpoint de recherche de contacts pour la suggestion du dialer si pas déjà présent. Travaille uniquement sous 768px ; ne touche pas au desktop.
