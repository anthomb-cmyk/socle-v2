# ACCEPTANCE_TESTS.md

End-to-end tests. Each one represents the "definition of done" for a phase.

A test is **passed** only when it runs against the live Supabase + UI and produces the expected DB rows + UI evidence.

---

## AT-1 (PRIMARY) — Import → Assign → Hot Seller → Telegram → Inbox

This is the contractual proof that v1-of-v2 ships.

### Setup
- Admin user (Anthony) logged in.
- Caller user (Gaylord) logged in in a separate browser/profile.
- Telegram bot configured with Anthony's chat ID.
- One real Granby Format B XLSX file ready (from the existing v1 imports).

### Steps

| # | Action | Expected DB state | Expected UI |
|---|---|---|---|
| 1 | Anthony: `/import` → upload Granby XLSX | `import_jobs` row with `status='preview'`, `total_rows`, `format_detected='role_b'`, `preview_data` populated | Preview screen shows: N properties new, N owners new, K duplicates, errors if any |
| 2 | Anthony: click "Confirm import" | Same row → `status='completed'`. New rows in `properties`, `contacts`, `property_contacts`, `phones`, `leads`. `automation_events` row with `event_type='import_completed'`. | Toast: "X created, Y updated, Z skipped, W errors". Redirects to `/leads?import=<id>`. |
| 3 | Anthony: filter `/leads?city=Granby` | (read-only) | Lead list shows only Granby leads. |
| 4 | Anthony: select 5 leads, "Assign to Gaylord" | 5 `leads.assigned_to` set; 5 rows in `lead_assignments`. `automation_events` row `event_type='leads_assigned'`. | Toast: "5 leads assigned to Gaylord". |
| 5 | Gaylord: `/calls/queue` | (read-only) | Sees exactly 5 leads. Cannot navigate to `/admin/*`, `/leads?all=true`, or any deal view. |
| 6 | Gaylord: opens lead, clicks outcome `Hot Seller`, fills submission form, submits | New `call_logs` row (`outcome='hot_seller'`). New `lead_submissions` row (`status='pending', seller_interest_level='hot'`). New `review_items` row (`source_kind='lead_submission', urgency='urgent'`). `automation_events` row `event_type='hot_seller_submitted'`. | Toast: "Sent to Anthony". UI advances to next lead. |
| 7 | (system) Telegram alert fires | (no DB change beyond #6) | Anthony's Telegram receives a message: property + city + caller + "Review now?" link. `automation_events.result.telegram_message_id` populated. |
| 8 | Anthony: opens `/review` | (read-only) | The submission appears at the top of the inbox, urgency=urgent. |
| 9 | Anthony: opens `/automation-events` | (read-only) | All four events from steps 2, 4, 6, 7 visible with payload + status=success. |

**Pass criteria**: every row in the table holds, AND the UI evidence is verifiable by Anthony manually.

---

## AT-2 — Re-import the same file is idempotent

Run AT-1 step 1+2 again with the exact same Granby file.

Expected:
- `import_jobs.properties_created = 0` (all matched on existing rows by address+city or matricule)
- `import_jobs.properties_updated > 0` (only if data fields changed; otherwise 0)
- `import_jobs.duplicates_seen = total_rows`
- No new `leads` rows.
- `automation_events.event_type='import_completed'` with `payload.duplicate_count` matching.

---

## AT-3 — Caller cannot escape their lane (RLS)

As Gaylord:
- `GET /leads/<lead-id-not-assigned-to-him>` → 404 or RLS-denied.
- `GET /admin/imports` → 403 / redirect.
- Direct Supabase query (e.g. via curl with his JWT): cannot read other callers' `call_logs`, cannot read `proposed_actions`, cannot read `automation_events`.

---

## AT-4 — Phone DNC propagation

Gaylord marks a phone as "do not contact" via outcome on a call.

Expected:
- `phones.status='do_not_contact'` for that row.
- All other `leads` sharing that contact_id flip `status='do_not_contact'`.
- Any future call attempt to that phone is blocked at the API layer.

---

## AT-5 — Telegram quick command (Phase 2)

Anthony texts the bot: "Relance Gestion CML demain 14h"

Expected:
- One `automation_events` row, source='telegram', event_type='telegram_command'.
- Bot replies confirming the lead match (or asks to disambiguate via `command_inbox` if multiple).
- New `follow_ups` row for the matched lead, due_at = tomorrow 14:00, source='telegram'.
- Telegram replies: "✅ Follow-up created for Gestion CML demain 14h."

---

## AT-6 — n8n daily brief (Phase 2)

At 9:00 AM, n8n fires the daily brief workflow.

Expected:
- `automation_events` row source='n8n', event_type='daily_brief_sent'.
- Telegram message arrives with: count of overdue follow-ups, count of open hot reviews, today's calendar highlights.
- No Google Tasks created automatically (only on-demand).

---

## How to run these manually until E2E test infra exists

1. Have one terminal tail Supabase logs (`supabase logs --project-ref ...`).
2. Have another terminal connected to the SQL editor for ad-hoc verification.
3. Walk through the steps in two browser profiles.
4. Tick the rows of the table above as they pass.

Automation comes after the slice ships.
