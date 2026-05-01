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

**As of 2026-04-30 ~23:55 UTC — Both alpha loops confirmed on Railway.**

| Item | Status |
|---|---|
| Production URL | ✅ `https://socle-v2-production.up.railway.app` |
| `/api/health` | ✅ `{"ok":true,"schemaApplied":true}` |
| Google OAuth login → Railway CRM | ✅ Fixed (Supabase Site URL + Redirect URLs updated) |
| Alpha Proof A — hot seller → Telegram → audit | ✅ CONFIRMED ON RAILWAY (telegram_message_id: "43" at 23:52:35 UTC) |
| Alpha Proof B — n8n CRM endpoints | ✅ CONFIRMED (`lead_upserted_from_email` at 23:26:34 UTC, W1a → Railway) |
| Alpha Proof B — Gmail trigger end-to-end | ⏳ Pending Gmail + OpenAI credentials attached to W1a |
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

### What remains deferred
- W1a Gmail credentials (manual n8n step — see below)
- W1a-biz for `anthony@socleacquisitions.com` (duplicate W1a in n8n UI)
- Telegram inbound webhook registration
- Phone enrichment pipeline (W7: Brave → 411 → Places → OpenClaw)
- Twilio click-to-call (phase 2)
- SMS outreach (phase 3 — Quebec Law 25 consent)
- GitHub push (HTTPS keychain — `brew install gh && gh auth login`)

### What Anthony should do next (in order)
1. **n8n W1a credentials** (5 min): open `https://anthonysocleacquisitions.app.n8n.cloud/workflow/2gZp3dbXCZPU3NV6`, attach `antho02mb@gmail.com` OAuth2 to `New Email Received` trigger + 2 draft nodes + OpenAI API to `AI Email Classifier`
2. **Live email test** (2 min): send a test email to `antho02mb@gmail.com` from a personal address, verify lead appears in Railway CRM within 1 minute
3. **W1a-biz** (10 min): in n8n UI, duplicate W1a, rename to "Auto-Reply: Socle Acquisitions", swap Gmail credential to `anthony@socleacquisitions.com`
4. **Then**: start phone enrichment pipeline (W7)

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

All 5 migrations applied:
- `0001_init.sql` — base schema (16 tables)
- `0002_followups_sync.sql` — Google Calendar / Tasks sync fields
- `0003_user_roles.sql` — widened role taxonomy + `is_active` + `email`
- `0004_enrichment_extensions.sql` — `enrichment_jobs` + `enrichment_results`
- `0005_properties_source.sql` — `source` + `source_meta` on properties

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
- `POST /api/follow-ups/[id]/sync` — single sync writeback
- `POST /api/follow-ups/sync-batch` — bulk sync (up to 500)

## n8n Workflows

| Workflow | ID | Status | CRM Target | Notes |
|---|---|---|---|---|
| Auto-Reply: Immeubles Quebec | `2gZp3dbXCZPU3NV6` | ✅ Active (activeVersionId `dba063d4`) | Railway | All 3 HTTP nodes → Railway. **Pending**: Gmail OAuth2 on trigger + 2 draft nodes + OpenAI on classifier |
| AI Secretary — Email Triage to Socle Calendar | `eLsh4aPMQfmNAOCx` | ✅ Published | Google Calendar | **Pending**: Gmail credentials for accounts 2+3, real Google Sheet ID |

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
- All enrichment results land `unverified` — never auto-write to phones/contacts/leads
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

**Completed this session:**
- Railway deployment: fixed all 5 build failures, deployed, live
- Auth: fixed Supabase URL config, Google OAuth redirect works
- Telegram: fixed silent failures, fixed Markdown parse errors, plain text format
- n8n W1a: replaced all 3 ngrok URLs with Railway, published
- Alpha Proof A: CONFIRMED ON RAILWAY (Telegram message 43)
- Alpha Proof B: CRM endpoints confirmed, Gmail trigger pending credentials
- /admin/test: added Alpha loops group, Import pipeline group, migration 0004/0005 checks, NEXT_PUBLIC_APP_URL env check
- Import system audited: parsers A+B confirmed working, fixture created (web/fixtures/granby-sample-5rows.xlsx), bulk-assign path confirmed

**Next recommended build step: W1a Gmail credentials + live email test**
This is a 5-minute manual step in n8n UI (not Claude). After that, the first real-world email through the complete pipeline (Gmail → n8n → AI classify → draft → Railway CRM) will be proven, and the platform is ready for W1a-biz and then W7 (phone enrichment).

**Then: real import test** — upload `web/fixtures/granby-sample-5rows.xlsx` at `/import`, confirm, bulk-assign to Gaylord, verify `/calls/queue` shows 5 leads.

**Do not start yet**: OpenClaw, enrichment pipeline, proposal engine, Twilio, advanced scoring, UI polish.

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
