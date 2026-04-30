# TELEGRAM_COMMANDS.md

Anthony's pocket interface. Status: ⏳ planned · 🚧 building · ✅ live.

The bot accepts free-form French/English. Intent parsing happens server-side (Next.js API route). Ambiguous commands create `command_inbox` rows and ask for disambiguation.

## Commands (Phase 2 minimum)

| Intent | Examples | Status | Action |
|---|---|---|---|
| Create follow-up | "Relance Gestion CML demain 14h", "Follow up with Robert Friday 10am" | ⏳ | Search lead/contact by name → if 1 match, create `follow_ups` row, reply ✅. If 0, offer to create new lead. If >1, list + ask. |
| Add note to lead | "Ajoute note sur Jean: il veut une offre", "Note for Robert: wants $1.2M" | ⏳ | Append to `leads.notes` + `communication_events` row. |
| Quick lead create | "Nouveau lead Pierre Gagnon, 8 logements Laval, motivé" | ⏳ | Parse name + city + units + tone → create contact + property + lead. Confirm with city/unit echo. |
| Search leads by city | "Quels hot leads à Victoriaville?" | ⏳ | Returns top 5 leads in city + status. |
| Daily summary on demand | "Qu'est-ce que je dois faire aujourd'hui?", "What's on today?" | ⏳ | Same payload as W2 but on-demand. |
| Call prep | "Prépare mon appel avec Gestion CML" | ⏳ | Lead summary + recent calls + recommended talking points. |
| Mark follow-up done | "Done", "Terminé" (in reply to a follow-up alert) | ⏳ | `follow_ups.status='done'`. |

## Response style

- Short. 1-3 lines for confirms, 5-10 for summaries.
- Always echo what the bot understood: "Got it: follow-up for **Gestion CML** tomorrow at **14:00**. Created ✅"
- If ambiguous: "Found 2 leads named CML — which one? \n1. Gestion CML inc. (Granby) \n2. CML Investissements (Laval) \n\nReply 1 or 2."
- Inline links: `[Open in CRM](https://app.socle.ca/leads/<id>)` for Anthony's tap-through.

## Hot seller alert template

```
🔥 Hot seller — Gaylord submitted a lead.

Owner: Gestion CML inc. (rep: Robert Tremblay)
Property: 1234 rue Notre-Dame, Granby — 8 units, eval $1.4M
Interest: hot · timeline: 3 months · asking $1.6M

Caller summary: "Owner is open to selling, wants offer this month, mentioned mortgage maturity."

[Review now] [Snooze 1h]
```

## Daily brief template

```
☀️ Bonjour Anthony — vendredi 30 avril

Today:
• 3 follow-ups due (1 urgent: Gestion CML 14:00)
• 2 hot reviews waiting
• 4 calls planned by Gaylord

Action: [Open Review Inbox]
```

## Implementation notes

- Bot framework: grammY (TypeScript). Webhook at `/api/telegram/webhook`.
- Telegram secret token verified via header `X-Telegram-Bot-Api-Secret-Token`.
- All inbound messages logged to `automation_events` immediately, even before parsing — so we have audit even if parse fails.
- Per-message idempotency via `telegram_message_id`.
- Anthony's `telegram_user_id` is set in `users_meta` on first interaction; only known users get full access. Strangers get a polite "Not authorized" + Anthony notification.
