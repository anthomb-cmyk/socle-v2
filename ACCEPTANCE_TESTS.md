# ACCEPTANCE_TESTS.md

End-to-end tests. Each one represents the "definition of done" for a phase.

A test is **passed** only when it runs against the live Supabase + UI and produces the expected DB rows + UI evidence.

---

## Live Alpha Status (2026-04-30)

| Test | Status | Evidence |
|---|---|---|
| **AT-A: Hot seller → Telegram → audit (Railway)** | ✅ PASSED | `automation_events`: `lead_submission_created`, `telegram_message_id: "43"`, `error_message: null` at 2026-04-30 23:52:35 UTC |
| **AT-B: n8n → /api/n8n/lead (Railway)** | ✅ PASSED | `automation_events`: `lead_upserted_from_email` at 2026-04-30 23:26:34 UTC |
| **AT-B: n8n → /api/n8n/event (Railway)** | ✅ PASSED | `automation_events`: `railway_smoke_test` at 2026-04-30 23:26:35 UTC |
| **AT-B: Gmail trigger → full pipeline** | ⏳ PENDING | Blocked on Gmail OAuth2 + OpenAI credentials attached to W1a in n8n UI |
| **AT-C: Import proof (one-click fixture)** | ✅ PASSED | Railway `/admin/test` → "Run import proof": 5 properties, 6 contacts, 6 phones, 6 leads, 6 assigned to Gaylord. Co-owner row (GAGNON×2) correctly creates 2 separate leads — expected behaviour. |
| **AT-1 (formal): Import → Assign → Hot seller → Telegram → Inbox** | ⏳ NOT YET RUN | Prerequisite for v1-of-v2 ship |

---

---

## AT-C — Import proof (one-click, no manual steps)

Proves the real business input path without needing a real Excel file or manual steps.

### How to run
1. Sign in as admin at `https://socle-v2-production.up.railway.app`
2. Go to `/admin/test`
3. Click **"Run import proof"** (blue button at top)
4. Wait ~5 seconds

### What it does internally
- Generates the 5-row Granby fixture XLSX in memory (Format B, real parser)
- Runs `parseRoleFile()` → `commitImport()` (same code path as the real `/import` UI)
- Creates or finds the `gaylord+seed@socleacquisitions.com` caller
- Assigns all 5 leads to that caller
- Logs `automation_event` with `event_type='import_completed'`

### Pass criteria

| # | Check | Expected | Actual (Railway 2026-04-30) |
|---|---|---|---|
| 1 | Button returns success | `counts.leads_created >= 1` (or `leads_updated` if re-run) | ✅ `leads_created=6` |
| 2 | Leads assigned | `assignedCount >= 1` | ✅ `assignedCount=6` |
| 3 | DB: `import_jobs` | New row with `status='completed'`, `format_detected='role_b'` | ✅ |
| 4 | DB: `leads` | 5–6 leads with `assigned_to = callerId` | ✅ 6 leads (row 3 has 2 co-owners → 2 leads per property — expected) |
| 5 | DB: `phones` | Contacts each have 1 E.164 phone with `status='unverified'` | ✅ 6 phones |
| 6 | Caller queue | `/calls/queue` → 5+ leads visible for Gaylord | ✅ visible under campaign "Granby Sample — fixture" |

### Co-owner note
The co-owner row (GAGNON, MARIE-FRANCE + GAGNON, RICHARD) creates 2 separate contacts and 2 separate leads for the same property. This is correct — each owner is a distinct calling target. If we ever want to collapse co-owners into one lead, that's a future policy decision (DEC-TBD), not a bug.

### Fixture data coverage
- Row 1: person owner (TREMBLAY, JEAN-PIERRE) — tests `kind=person`, name split
- Row 2: numbered_co (9234-1871 Québec inc.) — tests numbered company detection
- Row 3: 2 co-owners (GAGNON×2) — tests multiple owners → 2 leads per property
- Row 4: company (Gestion Immobilière Granby inc.) — tests company detection
- Row 5: trust (Fiducie Brodeur) — tests trust detection

### Re-run behaviour
Idempotent: running twice upserts on matricule (property) and full_name (contact). `leads_created=0`, `leads_updated=5` on second run. No duplicates. Both runs are safe.

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

---

## AT-7 — Follow-up roundtrip

### Steps
| # | Action | Expected DB | Expected UI |
|---|---|---|---|
| 1 | Admin creates follow-up via Telegram: `relance Gestion CML demain 14h` | `automation_events.event_type='telegram_update_received'` AND `follow_ups` row inserted with `source='telegram'`, `due_at=tomorrow 14:00 local` | Bot replies with confirmation message including the lead name + due time |
| 2 | Visit `/follow-ups` | (read-only) | Follow-up appears under "Upcoming". |
| 3 | Click ✓ Done | `follow_ups.status='done'`. `automation_events.event_type='follow_up_completed'`. | Item disappears from the list. |

### Variant 7B — Ambiguous name
Send `relance Tremblay demain 10h` when there are 2 owners named Tremblay.
- Expected: 0 new `follow_ups`. 1 new `command_inbox` row with `parsed_intent='follow_up'` and `candidates` array. Bot replies with the disambiguation list.

---

## AT-8 — Caller "+next" auto-advance

### Setup
- Caller has 3 leads in their queue.

### Steps
1. Caller opens `/calls/queue` → clicks lead #1.
2. On the lead workspace, clicks "No answer".
3. Expected: redirected directly to `/calls/<lead_2_id>` (NOT to `/calls/queue`).
4. Repeat with lead #2 → lead #3.
5. After lead #3, expected: redirected to `/calls/queue` (queue empty after `no_answer` flips status).

---

## AT-9 — Seed helpers smoke

Admin runs in browser console:
```js
fetch("/api/dev/seed-leads", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ count: 5, city: "Granby" })}).then(r => r.json()).then(console.log)
```

Expected: response contains `created.properties=5`, `created.contacts=5`, `created.phones=5`, `created.leads=5`. `/leads?city=Granby` shows the 5 new rows. `/admin/events` shows a `seed_leads` event.

---

---

## AT-10 — Lead dossier admin actions

### Setup
- One lead in DB (use `/api/dev/seed-leads` if needed).

### Steps
1. Admin visits `/leads`, clicks the owner name in row 1.
2. Lands on `/leads/[id]` showing: property block, contact block, phones table, call history, follow-ups, submissions, events.
3. Changes status dropdown → `qualified`. Toast "saved ✓". `automation_events.event_type='lead_updated'` created.
4. Drags priority slider to 90 + releases. PATCH fires; saved tick shown.
5. Selects a different caller in "Assigned to". `lead_assignments` row appended with `assigned_at=now`.
6. Edits "Lead notes" → tabs out of textarea. Notes saved, event logged.
7. Clicks "+ Follow-up", picks tomorrow 14:00, types a note, clicks "Create follow-up". `follow_ups` row added with `source='web_app'`.

---

## AT-11 — Proposed action approve flow

### Setup
- Run `/api/dev/seed-proposed-action` (or send a note via Telegram).

### Steps
1. Admin visits `/review`. Sees the proposed-action card under "Proposed actions" with Approve/Reject buttons.
2. Click Approve.
3. Expected: card disappears. `proposed_actions.status='accepted'`. `proposed_actions.applied_result.appended=true`. `leads.notes` now contains the appended text with a `[via Telegram, …]` header. `automation_events.event_type='proposed_action_accepted'`.
4. Visit `/leads/[id]` for the target lead — confirm the note appears in the Lead notes textarea.

---

## AT-12 — n8n audit sink

### Setup
- `N8N_SHARED_KEY` set in `.env.local`.

### Steps
1. Run the curl in RUNBOOK § "n8n audit sink test".
2. Expected: 200 with `{ ok: true, data: { eventId: "..." }}`.
3. Visit `/admin/events?source=n8n`. The new row appears with `event_type='smoke_test'`, `payload.from='manual curl test'`.
4. Re-run with bad bearer → 401.

---

---

## AT-13 — Data health visibility

### Setup
- Run `/api/dev/seed-leads` to plant data, then `/api/dev/seed-submission` and `/api/dev/seed-proposed-action`.

### Steps
1. Visit `/data-health`.
2. Expected: tile counts > 0 for "Open review items" and "Pending proposed actions" at minimum. Recent failures section may be empty (good).
3. Click "Pending proposed actions" tile → land on `/review` with the proposed action visible.
4. Click "Overdue follow-ups" tile (if seeded) → `/follow-ups?bucket=overdue` with the overdue row visible.

---

## AT-14 — Follow-up sync round-trip from n8n

### Setup
- A follow-up exists (use `/follow-ups` quick-add or seed).
- `N8N_SHARED_KEY` set in `.env.local`.

### Steps
1. Simulate n8n posting "syncing" then "synced":
   ```bash
   curl -X POST http://localhost:8985/api/follow-ups/<FOLLOW_UP_ID>/sync \
     -H "Authorization: Bearer $N8N_SHARED_KEY" \
     -H "Content-Type: application/json" \
     -d '{ "sync_status": "syncing", "sync_target": "gcal", "n8n_execution_id": "abc-123" }'

   curl -X POST http://localhost:8985/api/follow-ups/<FOLLOW_UP_ID>/sync \
     -H "Authorization: Bearer $N8N_SHARED_KEY" \
     -H "Content-Type: application/json" \
     -d '{ "sync_status": "synced", "gcal_event_id": "evt_xyz", "gcal_calendar_id": "primary" }'
   ```
2. Expected: `follow_ups.sync_status='synced'`, `gcal_event_id='evt_xyz'`, `last_synced_at=now`. Two `automation_events` rows with `source='n8n'`, `event_type='follow_up_synced'`.
3. /data-health → "Calendar/Task sync errors" tile shows 0.

---

---

## AT-15 — `/admin/users` end-to-end

### Setup
- Migration 0003 applied. Two users in auth (admin + at least one other).

### Steps
1. Visit `/admin/users` as admin.
2. Expected: table lists both users; admin row shows `last_sign_in_at`; orphan rows (auth users with no users_meta) appear with amber background.
3. Change a user's role from the inline dropdown → `manager`. Toast/refresh.
4. Verify: `users_meta.role='manager'` AND `auth.users.raw_app_meta_data.role='manager'`. (Run a SQL spot-check or just inspect the next request's JWT after sign-out/in.)
5. Click Edit, fill in `Display name`, `Telegram chat ID`, `Twilio forward to`, save.
6. Verify: `users_meta` updated. `automation_events` row `event_type='user_updated'`.
7. Toggle Active off → row stays in list with "Inactive" badge.

---

## AT-16 — Test checklist auto-update

### Steps
1. Visit `/admin/test` on a fresh DB — expect 0 / 11 steps complete.
2. Click "Do →" on step 2 (leads exist). Run any seeder.
3. Refresh `/admin/test` — step 2 flips to ✓; progress bar advances.
4. Continue running through each step's "Do →" link until 10 / 11 complete (sync step requires real n8n).

---

## AT-17 — Calendar view shape

### Steps
1. Seed several follow-ups across overdue / today / +7d.
2. Visit `/calendar`.
3. Expected: "Overdue" group at top in red; subsequent groups labeled by date in fr-CA. Times in HH:MM, leads link to `/calls/[id]`.

---

## AT-18 — Batch sync endpoint

### Steps
```bash
curl -X POST http://localhost:8985/api/follow-ups/sync-batch \
  -H "Authorization: Bearer $N8N_SHARED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "id": "<FU_1>", "sync_status": "synced", "gcal_event_id": "evt_1" },
      { "id": "<FU_2>", "sync_status": "error",  "sync_error": "scope denied" },
      { "id": "<FU_3>", "sync_status": "synced", "gcal_event_id": "evt_3" }
    ],
    "n8n_execution_id": "exec_42"
  }'
```
Expected: 200 with `data.results=[{ok:true},{ok:true},{ok:true}]` (or `{ok:false,error:...}` if an ID was bogus). One `automation_events` row with `event_type='follow_up_sync_batch'` and `result.results[]`.

---

---

## AT-19 — `/admin/test` reports system readiness honestly

### Steps
1. Visit `/admin/test` against a fresh DB (no migrations 0002/0003 applied, no seed data).
2. Expected: banner says "Missing migrations". Migrations section shows 0002 and 0003 as ✗ with expandable fixes pointing to the exact SQL file paths.
3. Apply 0002 and 0003 via SQL editor. Click "Re-check".
4. Expected: banner switches to "Needs seed data". Migrations all green.
5. Click the green "Seed everything" button at the bottom of the page.
6. Expected: banner advances to "Platform ready" (or stays at "Needs seed data" if a few optional tiles like Telegram remain).

### Variant
- Set `TELEGRAM_BOT_TOKEN` but not `TELEGRAM_ANTHONY_CHAT_ID` → `env_telegram_bot_token` is ✓, `env_telegram_anthony_chat_id` is ⚠ with a fix line pointing at `/api/telegram/identify`.

---

---

## AT-20 — Enrichment round-trip skeleton

### Setup
- Migration 0004 applied.
- At least one lead exists (use seed-everything).
- `N8N_SHARED_KEY` set in `.env.local`.
- `N8N_ENRICHMENT_WEBHOOK_URL` may or may not be set (test both).

### Steps

**A. Create a job:**
1. Visit `/leads/<id>` → Enrichment section → click "Send to enrichment" → pick `find_phone`.
2. Expected:
   - `enrichment_jobs` row inserted with `job_type='find_phone'`, `status='pending'` (or `running` if webhook fired).
   - `automation_events` row `event_type='enrichment_job_created'`.
   - Toast says either "Job created and webhook fired" or "queued, webhook not configured".

**B. Receive a result (simulate n8n):**
3. Run the curl in RUNBOOK § "Test the enrichment round-trip end-to-end" with the new `JOB_ID`.
4. Expected:
   - `enrichment_results` row, `status='unverified'`, `kind='phone'`, `value='+15145550199'`, `source='brave'`, `lead_id` set.
   - The job advances to `status='success'`.
   - `automation_events` row `event_type='enrichment_result_received'` (`source='n8n'`).
   - Refresh `/leads/<id>` → result appears in "Pending review" with Approve / Reject buttons.

**C. Approve:**
5. Click Approve.
6. Expected:
   - `enrichment_results.status='verified'`, `reviewed_by` and `reviewed_at` set.
   - New `phones` row for the contact with `e164='+15145550199'`, `status='verified'`, `source='brave'`.
   - `automation_events` row `event_type='enrichment_result_accepted'`.
   - Phones panel on the lead detail now shows the new number.

**D. Reject path** (variant): create a second result, click Reject. Expected: `enrichment_results.status='invalid'`, no phones row created, event logged.

---

---

## AT-21 — Enrichment ops dashboard

### Setup
- Migration 0004 applied.
- A few enrichment_jobs rows exist (use `/leads` batch send-to-enrichment with 3-5 leads).

### Steps
1. Visit `/admin/enrichment`.
2. Expected: status tiles populated, no "Stuck jobs" panel (yet).
3. Visit `/leads`, select 3 leads, click "Send to enrichment ▾", pick `find_phone`, leave Force unchecked, click Queue.
4. Expected toast: `✓ 3 created · 0 skipped · 0 failed`.
5. Click the same selection again with same job_type, Force unchecked, Queue.
6. Expected toast: `✓ 0 created · 3 skipped · 0 failed`.
7. Re-click with Force checked → all 3 created again.
8. From `/admin/enrichment`, click Cancel on one of the pending jobs.
9. Expected: row status flips to `cancelled`. `automation_events` row `event_type='enrichment_job_cancelled'`.
10. Click Retry on a failed/cancelled job.
11. Expected: status → pending (or running if webhook is set), `attempts` incremented, `automation_events` row `event_type='enrichment_job_retried'`.

### Stuck-job test
12. Manually update a row to simulate stuck:
    ```sql
    update enrichment_jobs
    set created_at = now() - interval '40 minutes'
    where id = '<some pending job>';
    ```
13. Refresh `/admin/enrichment`.
14. Expected: yellow "Stuck jobs" panel surfaces it. `/data-health` "Stuck enrichment jobs" tile turns amber. `/admin/test` Enrichment group shows `enrich_stuck` as warn.

---

## AT-22 — High-confidence auto-import (no approval required)

> Tests DEC-03: parser-resolved leads with valid phone, clear owner/address, and no conflicts auto-create as `ready_to_call` without any human review step.

### Setup
- A Format A or B XLSX file that contains at least one row with: a clear owner name, a valid Quebec property address, a parseable phone number, no duplicate conflict, high parser confidence score.

### Steps

| # | Action | Expected DB state | Expected UI |
|---|---|---|---|
| 1 | Anthony: `/import` → upload the XLSX | `import_jobs` row with `status='preview'`, `format_detected`, `preview_data` populated | Preview shows: N phone-ready leads auto-created, M needing enrichment, K needing review |
| 2 | Anthony: click "Confirm import" | `import_jobs.status='completed'`. For each high-confidence phone-ready row: `leads.status='ready_to_call'`. `phones` row with `status='verified'`, `source='import'`. `automation_events.event_type='import_completed'` with `payload.auto_created_count > 0`. | Toast shows exact counts — auto-created / needs enrichment / needs review / errors |
| 3 | Anthony: filter `/leads` for newly imported leads | `leads.status='ready_to_call'` for all phone-ready rows | Leads appear immediately in the list, callable, no "Pending review" badge |
| 4 | Verify no enrichment jobs created for auto-created leads | `enrichment_jobs` has 0 rows for the phone-ready `lead_id`s | `/admin/enrichment` shows no new jobs for these leads |
| 5 | Verify no review items created for auto-created leads | `review_items` has 0 rows for the phone-ready `lead_id`s | `/review` does not show these leads |

**Pass criteria**: phone-ready leads are in `/leads` as `ready_to_call` with no `enrichment_jobs` or `review_items` rows. Parser counts match exactly what the file contained.

**Boundary check — what should NOT auto-create:**
- Rows where owner name is ambiguous (two owners on one property, initials-only name)
- Rows where the phone number appears on more than 3 unrelated properties
- Rows where the city cannot be normalized to a canonical city name
- Rows where a duplicate property conflict exists in the DB

---

## AT-23 — Staged enrichment pipeline (deferred — after alpha)

> Tests DEC-05 and DEC-08: Supabase status controls pipeline filtering; each stage queries eligible records by status, not from n8n memory; leads exit as soon as one stage resolves their phone.

**Prerequisite**: Email → CRM round-trip (alpha) is proven, W7 is built. Do not run this test before that.

### Setup
- At least 5 leads with `status='needs_enrichment'` (no phone; use import or seed).
- `N8N_SHARED_KEY`, `N8N_ENRICHMENT_WEBHOOK_URL` configured.
- n8n W7 (staged phone enrichment) workflow is published.
- Test stubs available for Brave, 411, Google Places, and OpenClaw (to control which leads each stage resolves).

### Steps

| # | Action | Expected DB state | Expected UI / Events |
|---|---|---|---|
| 1 | Trigger W7 for 5 leads with `status='needs_enrichment'` | All 5 flip to `brave_queued` | `/admin/enrichment` shows 5 running jobs |
| 2 | Brave stub resolves 2 leads, returns nothing for 3 | 2 leads → `ready_to_call`, `enrichment_results` with `source='brave'`, `status='unverified'`; 3 leads → `unresolved_after_brave` | `automation_events` row `event_type='enrichment_stage_complete'`, `stage='brave'`, counts: `input_count=5, found_count=2, passed_to_next_count=3` |
| 3 | 411 stub resolves 1 of the remaining 3 | 1 lead → `ready_to_call`, `source='411'`; 2 leads → `unresolved_after_411` | `automation_events` stage=`directory_411`, `input_count=3, found_count=1, passed_to_next_count=2` |
| 4 | Google Places stub resolves 1 of the remaining 2 | 1 lead → `ready_to_call`, `source='google_places'`; 1 lead → `unresolved_after_places` | `automation_events` stage=`places`, `input_count=2, found_count=1, passed_to_next_count=1` |
| 5 | OpenClaw is called for the remaining 1 lead; returns low-confidence result | 1 lead → `needs_human_review`, `enrichment_results` row `status='unverified'`, `confidence < 70`, `source='openclaw'` | `automation_events` stage=`openclaw`, `input_count=1, found_count=1, pending_review_count=1` |
| 6 | Anthony visits `/leads/<id>` for the needs_human_review lead | (read-only) | OpenClaw result appears in "Pending review" with Approve / Reject buttons |
| 7 | Anthony approves the OpenClaw result | `enrichment_results.status='verified'`. New `phones` row `status='verified'`, `source='openclaw'`. `leads.status='ready_to_call'`. | Lead is now callable. `automation_events.event_type='enrichment_result_accepted'`. |

**Isolation check — already-solved leads are excluded:**
After step 2, trigger a second pass of Stage 1 (Brave) for all 5 leads. Expected: the 2 that became `ready_to_call` in step 2 are excluded from the query — `skipped_already_solved_count=2`, `input_count=3`. No duplicate enrichment_results created for them.

**No-result path:**
Repeat with a lead where all four stages return nothing. Expected: `leads.status='no_contact_found'`. No `enrichment_results` rows created. `automation_events` all show `found_count=0` for this lead. Lead is visible on `/data-health` "No contact found" tile.

**Pass criteria**: stage counts in `automation_events` are accurate at every step. Leads exit the pipeline exactly when a stage resolves them. No lead is passed to a later stage after being resolved. No CRM record is overwritten without Anthony's approval.

---

## How to run these manually until E2E test infra exists

1. Have one terminal tail Supabase logs (`supabase logs --project-ref ...`).
2. Have another terminal connected to the SQL editor for ad-hoc verification.
3. Walk through the steps in two browser profiles.
4. Tick the rows of the table above as they pass.

Automation comes after the slice ships.
