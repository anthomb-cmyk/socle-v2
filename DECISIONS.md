# DECISIONS.md

Append-only log. Newest at top. One entry per decision.

---

## 2026-04-30 — OpenClaw integration surface verified; POST /research/owner does not exist

- **Finding**: OpenClaw is a self-hosted CLI gateway (`npm install -g openclaw`), not an HTTP research API. It runs a local process on port **18789** (default, loopback-only). Its HTTP API is for controlling the agent session, not for issuing targeted research commands.
- **Verified real endpoints** (from official docs at openclaws.io + openclaw-ai.com):
  - `POST /api/sessions/main/messages` — send a text prompt to the AI agent
  - `POST /set/headers`, `POST /set/credentials`, etc. — browser control (loopback only)
  - There is **no** `POST /research/owner` endpoint. This was hypothetical and is now removed from all patch docs.
- **n8n.cloud cannot call it directly**: the gateway is on localhost; n8n.cloud is hosted. A tunnel (ngrok, cloudflared) or a local bridge is required.
- **Primary integration pattern**: n8n triggers a research task by POSTing a message to `POST /api/sessions/main/messages`. OpenClaw's agent processes it and can push results via webhook/tool use back to the CRM. Alternatively, n8n polls or OpenClaw posts back to `POST /api/n8n/enrichment-result`.
- **Status**: integration deferred until tunnel is set up and round-trip is tested. OpenClaw remains listed as "deferred" in CONTEXT_HANDOFF.md.
- **Previous patch docs**: OPENCLAW_SETUP.md, N8N_WORKFLOWS_OPENCLAW_PATCH.md, RUNBOOK_OPENCLAW_PATCH.md on Google Drive have been superseded by this entry + the repo versions below.

---

## 2026-04-30 — Enrichment ops layer: `/admin/enrichment` + retry/cancel + batch
- **Why**: Before connecting actual web research, Anthony must be able to *operate* enrichment — see jobs by status, find stuck ones, retry/cancel, approve pending findings — without SQL.
- **Stuck heuristic**: pending > 30 min OR running > 60 min. Surfaced on `/admin/enrichment`, `/data-health`, and `/admin/test`. Not auto-killed; just flagged so Anthony decides.
- **Skip-if-existing**: `/api/enrichment-jobs/batch` skips leads that already have a non-terminal job of the same `job_type` unless `force=true`. Prevents accidental duplicate spend.
- **Retry**: increments `attempts`, resets timestamps + error, re-fires webhook. Doesn't enforce `max_attempts` automatically — Anthony's call.
- **Cancel**: marks status='cancelled' but keeps any results that already arrived (they remain `unverified` for review).

## 2026-04-30 — Enrichment hooks are CRM-owned plumbing, not the worker
- **Why**: Build the round-trip skeleton (job created → webhook fires → n8n researches → result posted back → human approves) before any actual scraping or paid API calls. CRM stays the source of truth. n8n is just a renderer.
- **Migration 0004**: adds `enrichment_jobs.job_type` (find_phone / verify_phone / find_email / find_website / owner_identity / property_context / general_research) + widens `enrichment_kind` enum + extends `enrichment_results` with `lead_id`, `source_url`, `raw_payload`, `reviewed_by`, `reviewed_at`. Idempotent.
- **Webhook env var**: `N8N_ENRICHMENT_WEBHOOK_URL`. If unset, jobs are created in `pending` status — n8n must poll. The job creation never fails for missing webhook config; it returns a `webhookCalled=false` flag.
- **All results land unverified**: never auto-write to `phones` / `contacts.primary_email` / `contacts.primary_website`. Approval happens at `/leads/[id]` via the inline panel that mirrors the proposed-actions UX.
- **Auth**: PATCH `/api/enrichment-jobs/[id]` accepts EITHER an admin session OR an `N8N_SHARED_KEY` bearer. Lets n8n update job state without an OAuth dance.

## 2026-04-30 — `/admin/test` is the single source of truth for "is the platform ready"
- **Why**: Anthony shouldn't have to run `select count(*)` against five tables to know the system works. `/admin/test` now combines a server-rendered `/api/diagnostics` summary (migrations + env + JWT + admin user + seed data) with one-click seeders inline. No navigation to /admin/seed required.
- **Overall status banner**: 5 states — `ready` / `needs_setup` / `needs_seed` / `missing_env` / `missing_migration` — computed server-side, color-coded.
- **Per-check expandable fix**: every failed/warning check has a `fix` string with the exact command, SQL file, or env var name needed.

## 2026-04-30 — `/api/diagnostics` probes Supabase by attempting selects on migration-specific columns
- **Why**: Supabase's REST layer returns Postgres error code 42703 when a column doesn't exist. Probing `follow_ups.sync_status` (added by 0002) and `users_meta.is_active` (added by 0003) is more reliable than parsing `information_schema.columns` and avoids needing a custom RPC.
- **Verified**: against the live project where 0002 and 0003 are not yet applied, the endpoint correctly reports both migrations as `fail` with the exact SQL file to paste.

## 2026-04-30 — `seed-everything` is the canonical "make it work" seeder
- **Why**: AT-1 has 9 manual steps. `seed-everything` runs the whole chain server-side: caller user (cold_caller role), campaign + 10 leads, 3 follow-ups (overdue/today/+1d), call_log + hot-seller submission + review_item + Telegram alert, plus a proposed_action. After running it once, every dashboard tile populates and `/admin/test` flips to mostly green.
- **Idempotency**: campaigns get a `${stamp}` suffix so re-runs always create a fresh campaign. Properties/contacts dedupe via matricule/full_name as before. Re-running adds incremental data, doesn't overwrite.

## 2026-04-30 — Migration 0003: widen role taxonomy + is_active + email mirror
- **Why**: `/admin/users` needs to manage roles beyond admin/caller without SQL surgery. Roles now: `admin`, `manager`, `cold_caller`, `caller` (legacy alias), `research_assistant`, `viewer`. `is_active` for soft-deactivate; `email` denormalized so the users table renders without round-tripping through auth.users.
- **Permission semantics**: only `admin` is currently elevated. All other roles are caller-tier (RLS unchanged). Manager/viewer specialization is a future migration — when we do it, we'll add policies that key off `current_role_name() = 'manager'` etc.
- **JWT mirror**: PATCH `/api/users/[id]` writes role to `auth.app_metadata.role` so the user picks it up on their next sign-in. The change isn't visible until JWT refresh — UI calls this out.
- **Orphans**: auth.users with no users_meta row are surfaced in `/admin/users` as orphans (amber background) so admin can complete their setup with one click.

## 2026-04-30 — Acceptance test = self-validating checklist
- **Why**: AT-1 has 9 manual rows. Easier to ship a `/admin/test` page that auto-checks each row from live DB and shows ✓/n with deep-links. No more "did I miss a step?".
- **Implementation**: server component fans out 11 `count: head` queries, each row computes its own `done` boolean. Progress bar at top.

## 2026-04-30 — Read-only `/calendar` view (no editing)
- **Why**: Visibility doesn't need a full calendar widget. Pending follow-ups grouped by day for the next 14 days, plus an "Overdue" group at the top, is enough for Anthony to see what's coming. Editing happens on `/follow-ups` or `/leads/[id]`.
- **Layout**: chronological day buckets. Overdue rows highlighted red. Sync status shown when not 'unsynced'.

## 2026-04-30 — `sync-batch` endpoint for n8n efficiency
- **Why**: Cron runs that touch 200 follow-ups would otherwise need 200 POSTs. Batch endpoint accepts up to 500 items per call, processes per-row, returns per-row results, never aborts on a single failure (partial-success surfaced via `automation_events.status='partial'`).

## 2026-04-30 — Migration 0002: follow-ups sync fields
- **Why**: n8n needs durable state to round-trip a Google Calendar / Google Tasks sync. Adding `gtask_list_id`, `gcal_calendar_id`, `sync_status`, `sync_error`, and `sync_target` keeps the CRM as the source of truth (n8n calls `/api/follow-ups/[id]/sync` to write IDs back; the workflow has no internal memory).
- **Status enum**: unsynced → syncing → synced; error if any sync attempt fails. `sync_target='disabled'` lets admin opt a follow-up out of external sync.
- **No data backfill**: existing rows default to `sync_status='unsynced'` and `sync_target='none'`.

## 2026-04-30 — Data health page = read-only dashboard, not a fix-it tool
- **Why**: Surface signals; let admin click into the relevant list to remediate. Building bulk-fix UIs (merge contacts, mass-reassign properties) here would balloon scope. Each section is a clickable tile that deep-links to the right list filter.
- **Computation**: Most metrics are `count: head` queries. "Leads without phone" requires a contact-side check; we read `phones.contact_id` + `leads.contact_id` lists and compute the diff client-side. At our scale this is fine; if it becomes slow we'll install a `count_leads_without_phones()` SQL function.

## 2026-04-30 — Lead detail = `/leads/[id]` (admin) vs `/calls/[id]` (caller-friendly)
- **Why**: Admin needs a full dossier (notes, status/priority/assignment editor, all events, all submissions) — too much chrome for a caller mid-call. Caller view stays focused: phone, outcome buttons, save+next.
- **Implementation**: same data backend (`leads_view` + parallel queries for phones/calls/follow-ups/submissions/events). Different page shells.
- **Discoverability**: leads-table rows now link the owner name to the appropriate view based on `canAssign` (admin → dossier, caller → call workspace).

## 2026-04-30 — `/api/n8n/event` is the one audit sink for n8n
- **Why**: We don't want n8n authoring 12 different endpoints just to log status. One endpoint, every workflow ends with a POST to it.
- **Auth**: bearer `Authorization: Bearer ${N8N_SHARED_KEY}`. If env not set in dev, allowed with a warning string in the response. Refused in production (NODE_ENV check).
- **Schema-aligned body**: validated via zod, then 1:1 mapped to `automation_events` columns (no transformation surprises).

## 2026-04-30 — Proposed actions: only `append_note` for `leads` is auto-applicable
- **Why**: The set of actions Telegram can propose is small and predictable. We hand-code the apply path per `(action_type, target_table)` pair so we never run an unbounded migration generator. Rejecting any unknown shape with `applyError` ("Unknown action_type") keeps the surface tight.
- **Append behavior**: prepends a stamped header (`[via Telegram, YYYY-MM-DD]`) so Anthony can see provenance in the lead notes.

## 2026-04-30 — Format A parser: row-group by matricule (or address+city) before owner fan-out
- **Why**: Longueuil/Sherbrooke files emit one row per (property, owner) pair. A property with 3 owners produces 3 rows. We group by `matricule` first (the canonical Quebec property ID), falling back to `address|city` when matricule is missing.
- **Trade-off**: A multi-row property with inconsistent property fields across rows uses the first-seen values for property metadata. The raw rows are preserved in `raw_role_row` for debugging.
- **Tested**: 12-assertion smoke test in `_format-a-smoke.ts` covers row grouping, person vs company vs numbered_co classification, +1 phone prefix.

## 2026-04-30 — Caller "+next" auto-advance
- **Why**: Cold callers want maximum speed. After logging an outcome, instead of bouncing back to `/calls/queue`, we GET `/api/calls/next?afterLeadId=current` and route directly to the next eligible lead. Falls back to the queue page only when the queue is empty.
- **Implementation**: client-side `goNext()` in `CallWorkspace.tsx`. Server-side `/api/calls/next` respects role (caller sees only their assigned).

## 2026-04-30 — Dashboard: server component with parallel `count: head` queries
- **Why**: Six counters fan out as `Promise.all` of `head: true` queries. No row data fetched, just counts. Keeps the dashboard load <100ms even with thousands of leads.
- **Tile component**: each count is a clickable Link (e.g., overdue follow-ups → `/follow-ups?bucket=overdue`). Highlight in amber when value > 0 for "needs attention" tiles.

## 2026-04-30 — Follow-ups bucketed by `due_at`
- **Buckets**: `overdue` (due before today), `today` (due in today's date range), `upcoming` (due > today). Done items hidden by default; query `?bucket=done` to surface.
- **Lead hydration**: API joins lead info via a second query (`leads_view`) keyed on `lead_id` and merges client-side rather than relying on FK names that vary between Postgres versions.
- **Sources**: `web_app`, `telegram`, `caller_submission`, `email`, `auto`. We always log an `automation_events` row on create/update/complete/cancel.

## 2026-04-30 — Seed helpers as admin API endpoints (not scripts)
- **Why**: A `tsx` script needs the right env loaded; an admin API endpoint runs through the same auth/RLS pipeline as production. Easier to call from browser (`fetch("/api/dev/seed-leads", { method: "POST" })`).
- **Endpoints**: `seed-caller` (creates a fake `caller`-role auth user), `seed-leads` (creates campaign + N leads + optional follow-ups + optional review item), `seed-submission` (full hot-seller path).
- **Safety**: all require `admin` role. They modify production data when run against live Supabase — fine for dev/staging; gate or remove before public-facing prod.

## 2026-04-30 — Auth helpers: return-result, never throw
- **Why**: Earlier `requireAdmin` threw a `Response` object on 401/403. Next.js's app-router runtime didn't unwind that cleanly — the client `fetch` hung instead of seeing a 4xx. Now `requireUser`/`requireAdmin` return `{ ok, response }` discriminated unions, and route handlers `return auth.response` on the error path.
- **Side effect**: All API routes had to be touched. Done in one pass.

## 2026-04-30 — Telegram client: bare `fetch`, not grammY
- **Why**: For Phase 2 the only outbound action is `sendMessage` and the only inbound is a tiny webhook handler with regex-based intent parsing. grammY's session/middleware machinery is overkill until we add LLM-routed routing or session-based conversations.
- **Reversible**: Adding grammY later is a drop-in replacement; the webhook contract (`Update` JSON) is identical.

## 2026-04-30 — Telegram intent confidence model
- **High-confidence intents act immediately**: `/start`, `today`, `hot leads in CITY`, `relance NAME [day] HH` (when exactly one CRM lead matches the name).
- **Sensitive intents go through `proposed_actions`**: `note sur NAME: TEXT` — even on a single match, we don't append directly. Anthony approves in /review.
- **Ambiguous matches go to `command_inbox`**: 0 or >1 lead matches → row created, bot replies asking to clarify in the CRM.
- **Unknown text**: logged to `command_inbox` with `parsed_intent='unknown'` plus a friendly "what I can do" reply.
- **Never auto-act on**: send email, change deal stage, mark dead, overwrite existing data, anything legal/financial. Those go through `proposed_actions` regardless of confidence.

## 2026-04-30 — App shell: nav rendered conditionally in root layout
- **Why**: Avoids a `(authed)/` route group that would force moving every page. Layout fetches the user; if present, render `<AppNav>`; otherwise render `null` (so /login + / stay clean).
- **Trade-off**: Layout always runs an `auth.getUser()` call — cheap (cookie read + JWT verify), but technically every request pays for it.

## 2026-04-30 — Status propagation rules (call outcome → lead.status)
| outcome | lead.status |
|---|---|
| do_not_contact | do_not_contact |
| not_interested, already_sold | rejected |
| no_answer, voicemail_left | no_answer |
| hot_seller, wants_offer, open_to_selling | in_outreach |
| (other) | (unchanged) |

Phone-level: `bad_number` / `wrong_number` / `do_not_contact` outcomes also flip `phones.status` to a corresponding value. This protects callers from re-dialing burned numbers.

## 2026-04-30 — Submission urgency mapping
- `wants_offer` or `hot_seller` (outcome OR seller_interest_level) → `urgent` → Telegram fires
- `open_to_selling` or `follow_up_booked` → `high` → Telegram fires
- everything else → `normal` → no Telegram

## 2026-04-29 — Frontend stack: Next.js 15 + TypeScript + Tailwind v4 + shadcn/ui
- **Why**: Next.js 15 deploys instantly to Vercel. App Router + Server Actions = type-safe DB writes without separate API plumbing for the common case. Tailwind v4 + shadcn/ui = fast UI without a heavy component library. TS catches the schema-drift bugs that plagued v1.
- **Trade-off**: Steeper learning curve than vanilla React. Acceptable: I write the code, Anthony approves the product.
- **Reversible**: Yes — could pivot to Remix or vanilla CRA without losing data.

## 2026-04-29 — Auth: Supabase Google SSO, role via `app_metadata.role`
- **Why**: Anthony already authorizes Google for Calendar. Same identity = same login. `app_metadata` is server-only-mutable, so role can't be self-elevated by a malicious client.
- **Roles**: `admin` (Anthony), `caller` (Gaylord and future cold callers). RLS policies discriminate via `(auth.jwt() -> 'app_metadata' ->> 'role')`.
- **Reversible**: Yes — magic link is a one-line config flip.

## 2026-04-29 — Owners modeled as a relationship, not a table
- **Why**: A property can have many owners; a contact (person or company) can own many properties; the relationship has metadata (share %, owner vs co-owner vs broker). One M2M (`property_contacts`) with a `relationship` enum is cleaner than a separate `owners` table that would just be a renamed view of contacts.
- **Trade-off**: Querying "owners of property X" requires a join with `where relationship in ('owner','co_owner')`. Acceptable.

## 2026-04-29 — Phones are a first-class table, not a JSON column
- **Why**: Blueprint requires phone-level status (DNC, bad number, wrong person), source (file vs role vs Brave vs caller-verified), confidence. JSON columns can't be indexed or constrained well. Separate table = uniqueness, RLS on the phone, audit trail per phone.
- **E.164 normalization**: NANP-only for now (`+1XXXXXXXXXX`). Non-NANP rejected. `phones.e164` is the canonical key.

## 2026-04-29 — XLSX parsing: SheetJS server-side in Next.js API route
- **Why**: Parser must run server-side so the user can't tamper with the parsed result. n8n is for orchestration of recurring/scheduled work, not interactive request/response. SheetJS handles all four Quebec rôle formats (A/B/C/D) in <100ms for typical files.
- **Trade-off**: Larger Vercel function payload. Acceptable up to ~10 MB files; bigger files use Supabase Storage upload + Edge Function fan-out (Phase 2).

## 2026-04-29 — City normalization in DB function + TS lib (mirror)
- **Why**: Two callers (import API + Telegram search) need the same normalization. A Postgres function (`normalize_city(text)`) called from migrations + a TS module re-exporting the same map keeps both in sync. Tests assert parity.

## 2026-04-29 — Phone enrichment chain: Brave → Google Places → Pages Jaunes (drop B2BHint)
- **Why**: B2BHint is paid and weak for Quebec residential owners. Pages Jaunes is free and Quebec-native. Brave is free tier (1qps) for first-pass; Places handles entities with locations; PJ handles personal listings.
- **Reversible**: Add B2BHint back as a fallback if PJ misses cases.

## 2026-04-29 — Outreach channel for v1-of-v2: voice only, no SMS
- **Why**: Quebec Law 25 makes SMS outreach require explicit consent tracking. Voice is the existing flow. Add SMS in Phase 3 with proper consent UI.

## 2026-04-29 — n8n hosting: n8n.cloud, not self-hosted
- **Why**: One less infra component to babysit. Free tier covers our volume (~hundreds of executions/month). Switch to self-hosted on Railway only if cost becomes an issue or we need custom node code.

## 2026-04-29 — Migration strategy: v2 in new repo, v1 stays live until parity
- **Why**: Two real users have real deals. Zero-downtime migration. v2 ships at its own pace.

## 2026-04-29 — No ORM. Use `supabase-js` + zod for validation
- **Why**: ORMs (Prisma, Drizzle) duplicate Supabase's auto-generated types. `supabase-js` plus `supabase gen types` produces typed clients for free. Zod handles input validation at API boundaries.

## 2026-04-29 — Background work: Supabase Edge Functions for now
- **Why**: For phone enrichment fan-out and bulk import processing, Edge Functions run close to the DB and are free at our scale. n8n handles user-triggered orchestration; Edge Functions handle CPU-bound batch work.
- **Reversible**: Pull into a dedicated worker (e.g. Trigger.dev) if Edge Function timeouts bite.
