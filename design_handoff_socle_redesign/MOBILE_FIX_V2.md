# MOBILE FIX V2 — Textos · polish chirurgical

> La structure est correcte (list / thread / new convo panel tous fonctionnels). Ces 6 fixes corrigent uniquement les défauts de présentation visibles sur les screenshots de production du 14 mai.

---

## 1. Numéros téléphone — formater partout

**Symptôme** : on voit `+14508031880` brut dans le titre du thread (en plus dupliqué), dans la placeholder `Répondre à +14508031880`, dans les cartes de la liste qui se font tronquer en `+14508…`.

**Fix** : ajoute un helper `formatPhone` et utilise-le partout où un numéro est rendu.

```ts
// dans web/app/textos/utils.ts (ou dans TextosClient.tsx top-level)
export function formatPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  // North American format: +1 XXX XXX-XXXX
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}
```

Endroits à patcher (cherche les usages bruts de `selected.number`, `item.number`, etc.) :
- Carte de la liste : `<span className="conv-num">{formatPhone(item.number)}</span>`
- Header du thread : `<div className="thread-id__r">{formatPhone(selected.number)}</div>`
- Placeholder du composer : `placeholder={`Répondre à ${selected.contactName ?? formatPhone(selected.number)}`}`
- Bubbles meta : `from`/`to` brut → ne pas afficher dans le meta du tout (voir fix #4)

---

## 2. Header du thread — supprimer la duplication

**Symptôme** : titre = `+14508031880`, sous-titre = `+14508031880`. Même valeur deux fois.

**Fix** : si pas de nom de contact, montre `Numéro inconnu` en titre + numéro formaté en sous-titre. Si c'est un contact, nom en titre + numéro formaté en sous-titre.

```tsx
<div className="thread-id__body">
  <div className="thread-id__n">
    {selected.contactName ?? selected.dealTitle ?? "Numéro inconnu"}
  </div>
  <div className="thread-id__r">{formatPhone(selected.number)}</div>
</div>
```

**En plus** : pour un numéro inconnu, ajoute un chip d'action **dans le header** ou juste sous, pour lier au CRM. Évite le mort "?" tout seul à côté.

```tsx
{!selected.dealId && !selected.leadId && !selected.contactId && (
  <button className="link-action" onClick={() => openLinkDrawer(selected)}>
    + Lier à un lead
  </button>
)}
```

```css
.link-action {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 600;
  color: oklch(0.42 0.13 70);
  background: var(--surface);
  border: 1px solid oklch(0.85 0.07 75);
  padding: 6px 12px; border-radius: 999px;
  margin: 0 12px;
  align-self: center;
}
.link-action:active { background: var(--amber-soft); }
```

---

## 3. Carte de la liste — disposition

**Symptôme** :
- Le nom se fait tronquer beaucoup trop tôt (`+14508…` au lieu de `+1 450 803-1880`)
- Le status pill (`À identifier`, `Offre déposée`) déborde à droite du nom et le tronque encore plus
- Le timestamp `13 mai à 22:32` est trop verbeux

**Fix** : passer à un layout 2 colonnes (avatar + body) sans 3e colonne d'action. Pill SOUS le preview, pas à côté du nom.

```tsx
<a className="conv-card" href={...}>
  <div className="conv-av">{initials || "?"}</div>
  <div className="conv-body">
    <div className="conv-top">
      <span className="conv-n">{contactName ?? formatPhone(number)}</span>
      <span className="conv-time">{formatRelativeTime(at)}</span>
    </div>
    <div className="conv-num">{contactName ? formatPhone(number) : ""}</div>
    <p className="conv-p">{preview}</p>
    {dealId ? <DealChip ... /> : !leadId && !contactId ? <UnknownChip /> : null}
  </div>
</a>
```

```css
.conv-card {
  display: grid;
  grid-template-columns: 52px 1fr;  /* NO 3rd col */
  gap: 14px;
  padding: 14px;
  align-items: flex-start;
  /* ... rest as before */
}

.conv-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.conv-n {
  font-size: 15.5px; font-weight: 700; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  /* PAS de max-width contraignant */
}

.conv-time {
  font-size: 11.5px; color: var(--ink-3);
  flex-shrink: 0;
  white-space: nowrap;
}

.conv-num {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 1px;
}

.conv-p {
  font-size: 13.5px;
  color: var(--ink-2);
  margin-top: 4px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Chip pipeline / inconnu : sur sa propre ligne sous le preview */
.conv-foot { margin-top: 8px; }
```

### Format de timestamp relatif (helper)

```ts
function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const sameWeek = (now.getTime() - d.getTime()) < 7 * 86400_000;

  if (sameDay) return d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
  if (isYest)   return "Hier";
  if (sameWeek) return d.toLocaleDateString("fr-CA", { weekday: "short" }); // "lun", "mar"...
  return d.toLocaleDateString("fr-CA", { day: "numeric", month: "short" }); // "13 mai"
}
```

→ Le timestamp `13 mai à 22:32` devient `22:32` (aujourd'hui) ou `Hier` ou `mer` ou `13 mai`.

---

## 4. Bubbles — meta DEHORS et seulement à la fin d'une rafale

**Symptôme** : chaque bulle a son timestamp DEDANS, et chaque message d'une rafale (3× "hey" envoyés) affiche son propre timestamp. Bruit visuel énorme.

**Fix** : extraire le meta hors de la bulle, ne le rendre QUE pour le dernier message d'une rafale.

```tsx
{messages.map((m, i) => {
  const next = messages[i + 1];
  const isBurstEnd =
    !next ||
    next.direction !== m.direction ||
    new Date(next.at).getTime() - new Date(m.at).getTime() > 5 * 60 * 1000; // 5min gap

  return (
    <Fragment key={m.id}>
      <div className={`bubble bubble--${m.direction}`}>
        {m.body || "Message vide"}
      </div>
      {isBurstEnd && (
        <div className={`meta-line meta-line--${m.direction}`}>
          {m.direction === "outbound" ? "Envoyé" : "Reçu"} · {formatTime(m.at)}
        </div>
      )}
    </Fragment>
  );
})}
```

```css
.bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.4;
  margin-bottom: 2px;
}
.bubble--out {
  align-self: flex-end;
  background: var(--gold);
  color: #fff;
  border-bottom-right-radius: 6px;
}
.bubble--in {
  align-self: flex-start;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--border-soft);
  border-bottom-left-radius: 6px;
}
.bubble--out + .bubble--out { border-top-right-radius: 6px; }
.bubble--in  + .bubble--in  { border-top-left-radius: 6px; }

.meta-line {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink-3);
  margin: 3px 6px 10px;
}
.meta-line--out { align-self: flex-end; }
.meta-line--in  { align-self: flex-start; }

/* Day separator compact */
.day-pill {
  align-self: center;
  font-size: 11.5px; font-weight: 600;
  color: var(--ink-3);
  background: var(--surface);
  border: 1px solid var(--border-soft);
  padding: 4px 12px;
  border-radius: 999px;
  margin: 10px 0;
}
```

**Day separator** : utilise `Aujourd'hui` / `Hier` / `Mer 13 mai` au lieu du verbeux `mercredi 13 mai 2026`.

```ts
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-CA", { weekday: "short", day: "numeric", month: "short" }).replace(".", "");
}
```

---

## 5. Composer — bouton Envoyer rond plein gold

**Symptôme** : le bouton Envoyer est une icône paper-plane outline gris dans un carré arrondi avec une bordure or pâle — ressemble à un bouton désactivé. C'est visible sur les screenshots 1 (Nouveau texto) et 3 (thread).

**Fix** : bouton 42×42 plein gold avec icône blanche.

```tsx
<button
  className="tx-send"
  onClick={sendReply}
  disabled={!draft.trim() || status === "sending"}
  aria-label="Envoyer"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
  </svg>
</button>
```

```css
.tx-send {
  width: 42px; height: 42px;
  border-radius: 14px;
  background: var(--gold);
  color: #fff;
  border: 0;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: var(--sh-1);
}
.tx-send:active { background: var(--gold-deep); }
.tx-send:disabled {
  background: var(--border);
  color: var(--ink-4);
  box-shadow: none;
  cursor: not-allowed;
}
```

---

## 6. Composer wrapper — moins de padding, hint plus discret

**Symptôme** :
- L'ensemble du composer prend ~1/3 de l'écran
- Le hint "Le client voit seulement le numéro Twilio…" se retrouve sur 3 lignes centré, énorme

**Fix** :

```css
.tx-composer {
  position: sticky;
  bottom: 0;
  padding: 8px 12px calc(10px + env(safe-area-inset-bottom));
  background: oklch(0.98 0.008 85 / 0.96);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--border-soft);
}

.tx-composer-row {
  display: flex; align-items: flex-end; gap: 8px;
}

.tx-input-wrap {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 8px 14px;
  transition: border-color .15s;
}
.tx-input-wrap:focus-within { border-color: var(--gold); }
.tx-input-wrap textarea {
  width: 100%; min-height: 22px; max-height: 100px;
  border: 0; outline: 0; background: transparent; resize: none;
  font-family: inherit; font-size: 15px; line-height: 1.4;
  color: var(--ink);
}

.tx-hint {
  font-size: 11px;
  color: var(--ink-3);
  text-align: left;          /* pas centré */
  margin: 6px 4px 0;
  /* Truncate à 1 ligne pour pas dominer */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

**Raccourcir le texte** : `Le client voit seulement le numéro Twilio, pas ton cell personnel.` → `Envoyé depuis 514 555-0010 · ton cell reste privé`

---

## 7. (Bonus) — Panneau "Nouveau texto" sur mobile

**Symptôme** sur le screenshot 1 :
- Le segmented control "Contact CRM / Numéro libre" est énorme avec trop de padding
- La carte de destinataire montre le nom dupliqué (`9079-3787 Quebec Inc. - 9079-3787 Quebec Inc.`) avec wrapping moche
- La textarea du premier texto est immense
- Le hint en bas wrappe sur 3 lignes centrées

**Fixes** :

```css
/* Segmented compact */
.tx-seg {
  display: grid; grid-template-columns: 1fr 1fr;
  background: var(--surface-sunken);
  border-radius: 12px;
  padding: 3px;
  margin: 12px 0;
}
.tx-seg button {
  padding: 9px 12px;
  border: 0; border-radius: 10px;
  background: transparent;
  font-size: 13px; font-weight: 600;
  color: var(--ink-3);
}
.tx-seg button.is-active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--sh-1);
}

/* Recipient card : 1 ligne max pour le nom */
.tx-recipient {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  align-items: center;
}
.tx-recipient strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}
.tx-recipient small {
  font-size: 11.5px;
  color: var(--ink-3);
  display: block;
  margin-top: 2px;
}
.tx-recipient em {
  font-family: var(--mono);
  font-size: 12px;
  font-style: normal;
  color: var(--ink-2);
  white-space: nowrap;
}
```

**Et arrête de préfixer le nom avec ` - ` répété** : si le label backend retourne `9079-3787 Quebec Inc.` ET un sublabel `- 9079-3787 Quebec Inc.`, c'est un bug dans le `recipients` payload — vérifier `web/app/textos/page.tsx` (ou `/api/textos/recipients`) pour pas concaténer la même valeur deux fois.

```tsx
<button className={`tx-recipient${isActive ? " is-active" : ""}`}>
  <div style={{ minWidth: 0 }}>
    <strong>{recipient.label}</strong>
    {recipient.sublabel && recipient.sublabel !== recipient.label && (
      <small>{recipient.sublabel}</small>
    )}
  </div>
  <em>{formatPhone(recipient.number)}</em>
</button>
```

---

## Prompt à donner à Claude Code

> Lis `MOBILE_FIX_V2.md`. Applique les 7 fixes à `web/app/textos/TextosClient.tsx` et `web/app/globals.css` (sections `.tx-*` et `.bubble*`). Tous les changements sont visuels ou de formatting — ne touche à aucun `useState`, ni aux fonctions `sendReply` / `sendNewConversation` / `fetch`. Ne touche pas non plus au desktop (>= 768px). Vérifie en simulant 390×844 dans devtools.

Coût estimé : **~12k input + ~8k output** avec Haiku 4.5.
