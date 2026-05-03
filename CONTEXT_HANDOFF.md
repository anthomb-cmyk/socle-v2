# Socle CRM V2 — Context Handoff

> Paste this file into a new Claude conversation. Everything you need to pick up.

## Identity

- **Product**: Socle CRM V2 — Québec multifamily acquisition operating system. Anthony Makeen (Socle Acquisitions). Real estate investor, mobile-first, doesn't want to babysit software.
- **NOT**: a generic CRM. Specific to: import Québec rôle XLSX → clean owners/properties/phones → assign to cold callers → callers submit hot sellers → Anthony reviews → n8n + Telegram orchestrate.
- **Working principles**:
  - No silent failures, no fake success messages, no localStorage as truth.
  - Cold callers see only their assigned leads — never admin views, deal strategy, or financials.
  - AI / automation never auto-overwrites important records — proposes via `proposed_actions` or `enrichment_results`, Anthony approves.
  - CRM is the source of truth. n8n orchestrates. Telegram is mobile UI.

## Current Live Alpha Status

**As of 2026-05-01 (overnight build) — Priority 1+2+3 autonomous build complete.**

| Item | Status |
|---|---|
| Production URL | ✅ `https://socle-v2-production.up.railway.app` |
| `/api/health` | ✅ `{"ok":true,"schemaApplied":true}` |
| Google OAuth login → Railway CRM | ✅ Fixed (Supabase Site URL + Redirect URLs updated) |
| Alpha Proof A — hot seller → Telegram → audit | ✅ CONFIRMED ON RAILWAY (telegram_message_id: "43" at 23:52:35 UTC) |
| Alpha Proof B — n8n CRM endpoints | ✅ CONFIRMED (`lead_upserted_from_email` at 23:26:34 UTC, W1a → Railway) |
| Alpha Proof B — Gmail trigger end-to-end | ⏳ Pending Gmail + OpenAI credentials attached to W1a |
| Alpha Proof C — import pipeline end-to-end | ✅ CONFIRMED ON RAILWAY: 5 properties, 6 contacts, 6 phones, 6 leads, 6 assigned to Gaylord. Co-owner row creates 2 leads per property (correct). |
| n8n W1a ngrok dependency | ✅ ELIMINATED — all 3 nodes → Railway |
| Railway env vars | ✅ All 7 confirmed functional |

### What is live
- Railway CRM: all routes load, auth works, Supabase connected
- Hot-seller loop: caller submits → review inbox → Telegram alert (plain text, no parse_mode) → automation_event with `telegram_message_id`
- n8n → Railway: `/api/n8n/lead` and `/api/n8n/event` both return `{"ok":true}` and create DB rows
- W1a active and pointing to Railway — no ngrok

### What has passed
- AT-A: Hot seller loop on Railway ✅ (2026-04-30 23:52 UTC)
- AT-B (partial): n8n CRM endpoints on Railway ✅ (2026-04-30 23:26 UTC)
- AT-C: Import pipeline on Railway ✅ (2026-04-30): 5 props / 6 contacts / 6 phones / 6 leads / 6 assigned

### What remains deferred (manual steps only)
- W1a Gmail credentials (manual n8n step — see below)
- W1a-biz for `anthony@socleacquisitions.com` (4 inactive drafts exist in n8n — pick one, attach Gmail cred + activate)
- Telegram inbound webhook registration
- W7 credentials in n8n (see W7 section below)
- Supabase migration 0006 — must be applied manually (see below)
- Twilio click-to-call (phase 2)
- SMS outreach (phase 3 — Quebec Law 25 consent)
- GitHub push (HTTPS keychain — `brew install gh && gh auth login`)

### What Anthony should do next (in order)

#### W7 phone enrichment — make it live (highest priority)
1. **Apply migration 0007** (2 min): Supabase dashboard → SQL Editor → paste `supabase/migrations/0007_phone_pipeline.sql` → Run
2. **Apply migration 0008** (2 min): Supabase dashboard → SQL Editor → paste `supabase/migrations/0008_pipeline_v2_stages.sql` → Run
3. **Apply migration 0009** (2 min): Supabase dashboard → SQL Editor → paste `supabase/migrations/0009_openclaw_stage3.sql` → Run
4. **Set `BRAVE_SEARCH_API_KEY` in Railway** (2 min): Railway → socle-v2 service → Variables → add `BRAVE_SEARCH_API_KEY = <your key>`. Get key at https://api.search.brave.com. This unlocks Stages 1 + 2.
5. **Test W7 on one lead** (1 min): Go to `/admin/test` → "W7 enrichment — single lead test" → click "Run enrichment test (1 lead)". Inspect result: stage reached, confidence, candidate phone, source URL.
6. **Check migration 0006 if not applied** (2 min): `/admin/test` will show `migration_0006` as fail if not applied. Paste `supabase/migrations/0006_enrichment_status.sql` → Run.

#### Optional — unlock Stage 3 (OpenClaw)
7. **OpenClaw** (Stage 3): Set `OPENCLAW_WEBHOOK_URL` + `N8N_SHARED_KEY` in Railway, activate the n8n OpenClaw workflow. OpenClaw uses public web sources only — no API key required beyond the webhook.

#### Other pending
8. **n8n W1a credentials** (5 min): open `https://anthonysocleacquisitions.app.n8n.cloud/workflow/2gZp3dbXCZPU3NV6`, attach `antho02mb@gmail.com` OAuth2 to `New Email Received` trigger + 2 draft nodes + OpenAI API to `AI Email Classifier`
9. **W1a-biz** (5 min): In n8n, find any "Auto-Reply: Socle Business Email" workflow → attach `anthony@socleacquisitions.com` Gmail OAuth2 → Activate

---

## Repo + paths

| Thing | Where |
|---|---|
| Repo root | `/Users/anthonymakeen/Documents/New project/socle-v2` |
| Web app | `web/` (Next.js 15 App Router, TypeScript, Tailwind v4) |
| Supabase migrations | `supabase/migrations/0001_init.sql` … `0005_properties_source.sql` |
| Dev server port | **8985** (`npm run dev`) |
| **Railway production URL** | **`https://socle-v2-production.up.railway.app`** |
| GitHub repo | `https://github.com/anthomb-cmyk/socle-v2` (push blocked by HTTPS keychain — `brew install gh && gh auth login` is the unblocker) |
| Docs | `SPEC.md`, `DECISIONS.md`, `RUNBOOK.md`, `API.md`, `N8N_WORKFLOWS.md`, `TELEGRAM_COMMANDS.md`, `ACCEPTANCE_TESTS.md`, `DEPLOY.md` |

## Stack

| Layer | Tech |
|---|---|
| DB / auth / storage | Supabase (Postgres 15) — project ref `mkgkrfcfhtrlecfuzroz` |
| UI | Next.js 15 + React 19 + TypeScript + Tailwind v4 |
| Orchestration | n8n.cloud — `https://anthonysocleacquisitions.app.n8n.cloud` |
| Mobile | Telegram bot (token in `.env.local` + Railway env vars) |
| **Deployment** | **Railway — `socle-v2-production.up.railway.app`** (active, nixpacks, Node 22, root: `web/`) |
| Voice | Twilio (planned phase 2) |

## Deployment — Railway

**LIVE as of 2026-04-30.** See `DEPLOY.md` for full details.

Key config facts:
- `web/railway.json`: `buildCommand: "npm run build"` only — NOT `npm ci && npm run build` (EBUSY on nixpacks cache mount)
- `web/.node-version`: `22` — forces nixpacks to Node 22
- `$PORT` env var used in startCommand — never hardcode a port for Railway

### Railway env vars (all confirmed set + functional)

| Var | Confirmed how |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `/api/health` returns `schemaApplied: true` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | same |
| `TELEGRAM_BOT_TOKEN` | `telegram_message_id: "43"` on Railway submission |
| `TELEGRAM_ANTHONY_CHAT_ID` | same |
| `N8N_SHARED_KEY` | `lead_upserted_from_email` events from n8n in automation_events |
| `NEXT_PUBLIC_APP_URL` | set to `https://socle-v2-production.up.railway.app` |

### Supabase Auth URL Configuration (set 2026-04-30)
- Site URL: `https://socle-v2-production.up.railway.app`
- Redirect URLs: Railway callback + Railway login + localhost:8985 callback + localhost:8985 login

## Database (Supabase `mkgkrfcfhtrlecfuzroz`)

5 migrations applied on Railway, 4 pending manual apply:
- `0001_init.sql` — base schema (16 tables)
- `0002_followups_sync.sql` — Google Calendar / Tasks sync fields
- `0003_user_roles.sql` — widened role taxonomy + `is_active` + `email`
- `0004_enrichment_extensions.sql` — `enrichment_jobs` + `enrichment_results`
- `0005_properties_source.sql` — `source` + `source_meta` on properties
- `0006_enrichment_status.sql` — ⚠️ **PENDING MANUAL APPLY** — adds `needs_enrichment`, `brave_queued`, `unresolved_after_brave`, etc. to `lead_status` enum
- `0007_phone_pipeline.sql` — ⚠️ **PENDING MANUAL APPLY** — creates `phone_candidates` table, `enrichment_events` table, `candidate_status`/`pipeline_stage`/`openclaw_verdict` enums
- `0008_pipeline_v2_stages.sql` — ⚠️ **PENDING MANUAL APPLY** — adds `address_search`/`company_search`/`b2bhint` enum values, `auto_attached` to `candidate_status`, `matched_on`/`search_query`/`candidate_name`/`candidate_address`/`related_entity_name`/`related_entity_type` columns on `phone_candidates`
- `0009_openclaw_stage3.sql` — ⚠️ **PENDING MANUAL APPLY** — adds `openclaw_researching`/`unresolved_after_openclaw` to `lead_status`; adds `openclaw_dispatched`/`openclaw_callback_received` to `enrichment_event_type`

Seeded: 10 leads (Granby), 10 properties, 11 contacts, 10 phones, 1 campaign, follow-ups, 1 hot-seller submission, 1 open review item, 1 pending proposed action.

### Users
- `anthony@socleacquisitions.com` — admin (`app_metadata.role='admin'`) ✅
- `gaylord+seed@socleacquisitions.com` — caller (test account, no password)

## App surfaces (all live on Railway)

| Route | Role | What |
|---|---|---|
| `/` | admin | Dashboard — 6 count tiles, recent imports, recent failures |
| `/leads` | admin | Filterable list, bulk-assign, bulk-enrichment |
| `/leads/[id]` | admin | Full dossier — status/priority/notes, follow-up, enrichment Approve/Reject |
| `/leads/new` | admin | Manual lead create |
| `/calls/queue` | caller | Caller's assigned leads only |
| `/calls/[id]` | caller | Call workspace — phones, outcome buttons, hot-seller submission |
| `/properties` + `/properties/[id]` | admin | Property browser + detail |
| `/contacts` + `/contacts/[id]` | admin | Contact browser + detail |
| `/follow-ups` | admin/caller | Overdue / today / upcoming, complete/cancel |
| `/calendar` | admin/caller | Read-only 14-day window |
| `/review` | admin | Review items + proposed actions Approve/Reject |
| `/import` | admin | XLSX upload → parse → preview → confirm |
| `/data-health` | admin | 12 dirty-data tiles |
| `/admin/test` | admin | System readiness checklist + inline seeders |
| `/admin/seed` | admin | One-click seeders |
| `/admin/users` | admin | Role/active/Telegram/Twilio editor |
| `/admin/events` | admin | Audit log |
| `/admin/enrichment` | admin | Enrichment jobs + pending results, retry/cancel |

## API endpoints (all live)

See `API.md` for full list.

n8n endpoints (auth: `Bearer ${N8N_SHARED_KEY}`):
- `POST /api/n8n/event` — audit-log sink
- `POST /api/n8n/lead` — create/update lead from email triage
- `POST /api/n8n/enrichment-result` — enrichment findings (land `unverified`)
- `POST /api/n8n/lead-status` — update lead pipeline status (enrichment stages)
- `POST /api/follow-ups/[id]/sync` — single sync writeback
- `POST /api/follow-ups/sync-batch` — bulk sync (up to 500)

## n8n Workflows

| Workflow | ID | Status | CRM Target | Notes |
|---|---|---|---|---|
| Auto-Reply: Immeubles Quebec (W1a) | `2gZp3dbXCZPU3NV6` | ✅ Active (activeVersionId `764ae196`) | Railway | All 3 HTTP nodes → Railway. `continueOnFail: true` on both Gmail draft nodes. **Pending**: Gmail OAuth2 on trigger + 2 draft nodes + OpenAI on classifier |
| Auto-Reply: Socle Acquisitions (Biz) (W1a-biz) | `frgVOM2HCi1aCvDd` (or any of 4 inactive drafts) | ⏳ Inactive — needs Gmail cred attached | Railway | Open any "Auto-Reply: Socle Business Email" in n8n → attach `anthony@socleacquisitions.com` OAuth2 → Activate |
| AI Secretary — Email Triage to Socle Calendar | `eLsh4aPMQfmNAOCx` | ✅ Published | Google Calendar | **Pending**: Gmail credentials for accounts 2+3, real Google Sheet ID |
| W7 — Phone Enrichment: Brave Stage | `ieE7UpmdRiWejjz7` | ⏳ Inactive — needs credentials | Railway | Webhook path: `enrichment-job`. Needs: `Socle CRM N8N Key` (HTTP Header Auth Bearer) + `Brave Search API` (HTTP Header Auth X-Subscription-Token). Set `N8N_ENRICHMENT_WEBHOOK_URL` in Railway. |

## Telegram

- `sendTelegramAlert()` returns discriminated union `{ ok: true, message_id } | { ok: false, error }` — all callers write `error_message` to automation_events on failure
- No `parse_mode` ever — plain text only — user-entered content is not safe through Markdown parser
- `TELEGRAM_ANTHONY_CHAT_ID=8613064895` confirmed working on Railway

## Parsers

- Format A (Longueuil/Sherbrooke style): 12/12 smoke tests pass
- Format B (Granby compact-indexed): 16/16 smoke tests pass
- Format C/D: deferred until sample files arrive

## Critical decisions (see DECISIONS.md, 50+ entries)

- Auth helpers return-result, never throw (Next.js hangs on thrown Response)
- W7 v3 (as of 0009): 3-stage pipeline — Stage 1 (address search) → Stage 2 (company/person search) → Stage 3 (OpenClaw automated browser research). **B2BHint has been removed entirely** — required a paid API key that was never activated.
- OpenClaw is Stage 3, not Stage 4. It uses public web sources only (no API key). It CAN browse public B2BHint pages, Canada411, Pages Jaunes, REQ, and company websites.
- Stop-early rule: HIGH confidence (≥80) → auto-attach phone, `ready_to_call`. MEDIUM (50–79) → `needs_phone_review` queue. LOW (<50) → continue to next stage.
- Existing phone gate: `leads_view.best_phone` — if any phone exists (imported OR previously enriched), skip enrichment entirely.
- Solved leads never pass to later stages — stop-early is enforced in `pipeline.ts`.
- All enrichment results land `unverified` — never auto-write to phones/contacts/leads (except auto_attach path which requires ≥80 confidence)
- `B2BHINT_API_KEY` is no longer referenced anywhere. Do not add it back.
- `/admin/test` is single source of truth for platform readiness
- Railway `buildCommand` = `npm run build` only (not `npm ci && npm run build`)
- Telegram = plain text only, no `parse_mode`
- `sendTelegramAlert()` never silently fails — always writes error to `automation_events.error_message`

## Acceptance tests (ACCEPTANCE_TESTS.md)

AT-1 through AT-23. Key status:
- AT-A (hot seller loop on Railway): ✅ PASSED 2026-04-30
- AT-B (n8n CRM endpoint): ✅ CRM SIDE PASSED, Gmail trigger pending credentials
- AT-1 through AT-23 (formal): not yet run formally against Railway — AT-1 is the contractual proof for v1-of-v2 ship

## Current footprint

- ~95 source files, ~8,700 LoC
- TypeScript: 0 errors
- Parser smoke tests: A 12/12, B 16/16
- All 5 migrations applied ✅
- Railway deployment live ✅
- Both alpha loops proven ✅

## Blueprint decisions locked (2026-04-30)

See SPEC.md + DECISIONS.md DEC-01 through DEC-11. Key:
- V2 looks like V1 (warm/gold UX, compact rows, French labels)
- Import parser = deterministic code (not AI)
- High-confidence leads auto-create; uncertain records → Import Review
- Enrichment: Brave → 411 → Places → OpenClaw — Supabase status drives eligibility
- OpenClaw findings always land unverified
- Do not build enrichment until alpha is confirmed with real Gmail credentials

## Import system (audited 2026-04-30)

### Parser architecture
- `web/lib/role-parser/` — pure TypeScript, no AI, 100% deterministic
- **Format A** (Longueuil/Sherbrooke): one row per owner×property pair, grouped by matricule. Columns: `Adresse`, `Ville`, `Nom propriétaire`, `Téléphone propriétaire`, `Évaluation totale`, etc.
- **Format B** (Granby compact-indexed): one row per property, owners as `Propriétaire1_Nom` / `Propriétaire1_Téléphone` / `Propriétaire1_Adresse`, etc. Up to N owners per row.
- Format C/D: not yet implemented — falls back to Format B parser (permissive enough for many ad-hoc files)
- Phone normalization: `phone-utils.ts` extracts all phone-like strings, normalizes to E.164 (+1…), deduplicates
- Owner classification: `person` / `company` / `numbered_co` (9999-9999 Québec inc.) / `trust` (Fiducie…)
- Smoke tests: Format A 12/12 ✅, Format B 16/16 ✅

### Upload → preview → confirm pipeline
1. `POST /api/import/upload` — parses XLSX, creates `import_jobs` row (status=`preview`), stores full parse result in `preview_data.parsed_full` (JSONB), returns first 10 rows + counts
2. `POST /api/import/[jobId]/confirm` — reads `parsed_full`, calls `commitImport()`, writes:
   - `properties` (upsert by matricule, fallback address+city)
   - `contacts` (upsert by full_name for persons, company_name for entities)
   - `property_contacts` M2M (relationship=owner)
   - `phones` (E.164, status=unverified, source=role, confidence=80)
   - `leads` (status=new, **assigned_to=null**, campaign_id, property_id, contact_id)
3. All writes idempotent — re-importing same file updates, does not duplicate

### Caller assignment (after import)
Leads land with `assigned_to = null`. To assign:
- **UI**: `/leads` → select checkboxes → choose caller from dropdown → "Assign" button → calls `POST /api/leads/assign` → sets `leads.assigned_to`, inserts `lead_assignments` row, logs `automation_event (leads_assigned)`
- **Seed**: `POST /api/dev/seed-leads` with `{ assignToUserId: "..." }` sets `assigned_to` at create time
- **Caller queue**: once assigned, leads appear at `/calls/queue` for that caller only (RLS enforced)

### Fixture for real-world testing
`web/fixtures/granby-sample-5rows.xlsx` — 5-row Format B file covering all owner types:
- Row 1: person (TREMBLAY, JEAN-PIERRE) · phone (450) 770-1234
- Row 2: numbered_co (9234-1871 Québec inc.) · phone 450-375-5501
- Row 3: 2 co-owners person×2 (GAGNON, MARIE-FRANCE + RICHARD) · same phone
- Row 4: company (Gestion Immobilière Granby inc.) · phone 450-372-0044
- Row 5: trust (Fiducie Brodeur) · phone 450-375-1122

All 5 parse to `role_b`, zero hard errors, all phones normalize to E.164. Upload via `/import`.

### Import readiness in /admin/test
Two new checks under "Import pipeline" section:
- `import_unassigned_leads`: warns when leads have `status=new AND assigned_to=null` (post-import, pre-assignment)
- `import_stuck_preview`: warns when import_jobs stuck in `preview` status >24h (never confirmed)

---

## Where we left off + next build step

**Completed overnight build (2026-05-01):**

Priority 1 — Calling workflow:
- `web/app/import/page.tsx` — post-import Quick Assign inline panel; phone-ready count; campaign warning
- `web/app/api/leads/route.ts` — `campaign_id`, `has_phone`, enhanced `assigned_to` filters; campaigns list in response
- `web/components/leads-table.tsx` — campaign filter, assigned-to filter, has-phone filter, load-more pagination, assigned-to column, "Select callable only" button
- `web/app/calls/queue/page.tsx` — campaign name, last-contacted date, call count, phone formatting, priority badge, sorted by priority + oldest contact first, phone-ready count in header

Priority 2 — Usability:
- `web/components/app-nav.tsx` — Admin nav collapsed into primary links + "Admin ▾" CSS-hover dropdown; clean 10px height bar
- `next.config.ts` — moved `typedRoutes` out of `experimental` (fixes build warning)

Priority 3 — Enrichment pipeline:
- `supabase/migrations/0006_enrichment_status.sql` — adds 10 pipeline statuses to `lead_status` enum (⚠️ needs manual apply in Supabase dashboard)
- `web/app/api/n8n/lead-status/route.ts` — new n8n-authenticated endpoint for pipeline status updates
- `web/app/api/enrichment-jobs/batch/route.ts` — webhook payload now includes `lead_info` (name, address, city) so W7 has everything it needs without round-trip
- `web/app/api/leads/[id]/route.ts` — PATCH now accepts all enrichment pipeline statuses
- **W7 created in n8n** (`ieE7UpmdRiWejjz7`): webhook trigger → skip-if-phone → build Brave query → Brave Search API → phone regex extraction → save `enrichment_result (unverified)` → update lead status → log event. Needs credentials attached (see "What Anthony should do next").

**TypeScript: 0 errors** across all changes.

**Real blockers remaining (all manual steps, no code changes needed):**
1. `rm .git/index.lock` then git commit + push — can't do from sandbox (Mac process owns lock)
2. Supabase 0006 migration — `ALTER TYPE` in SQL Editor
3. W1a Gmail credentials in n8n
4. W7 credentials in n8n + `N8N_ENRICHMENT_WEBHOOK_URL` in Railway

**Next build priorities (when Anthony is back):**
- Test W7 end-to-end: trigger enrichment batch from /admin/enrichment on a no-phone lead → verify Brave result appears → approve → lead moves to ready_to_call
- Build W7b (411/Pages Jaunes stage) — same pattern as W7, different search API
- Telegram inbound command registration (`/register` to capture chat ID)
- Twilio click-to-call scaffolding (Phase 2)

## MCP tools for next session

| MCP | Server ID | Use for |
|---|---|---|
| Supabase | `mcp__b5cf397b-abae-4d06-8d41-3f22bf9c77c3__*` | SQL, migrations. Project `mkgkrfcfhtrlecfuzroz`. |
| n8n | `mcp__b17bca73-2e29-47c8-a386-0b1d6a688db6__*` | Workflows. Use `get_sdk_reference` before writing SDK code. |
| workspace bash | `mcp__workspace__bash` | Shell. Repo at `/sessions/.../mnt/Documents/New project/socle-v2`. |
| web_fetch | `mcp__workspace__web_fetch` | Hit Railway endpoints, check health. |

## Working style (Anthony's stated preferences)

- "Do not stop because git commit failed from a sandbox lock." Code on disk is fine.
- "Do not stop because Anthony has not manually tested yet." Keep building.
- Real blockers only: app can't compile · DB blocked · migration impossible · missing secret with no stub · data-loss risk · business-critical decision.
- Use Supabase MCP for DB ops — don't ask Anthony to paste SQL.
- End-of-session format: Built / Tested / Works / Needs Anthony manual setup / Real blockers / Exact commands / Next step.
