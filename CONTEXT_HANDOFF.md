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

## Repo + paths

| Thing | Where |
|---|---|
| Repo root | `/Users/anthonymakeen/Documents/New project/socle-v2` |
| Web app | `web/` (Next.js 15 App Router, TypeScript, Tailwind v4) |
| Supabase migrations | `supabase/migrations/0001_init.sql` … `0005_properties_source.sql` |
| Dev server port | **8985** (`npm run dev`) |
| GitHub repo | `https://github.com/anthomb-cmyk/socle-v2` (created but push currently blocked by HTTPS keychain — `brew install gh && gh auth login` is the unblocker) |
| Docs | `SPEC.md`, `DECISIONS.md`, `RUNBOOK.md`, `API.md`, `N8N_WORKFLOWS.md`, `TELEGRAM_COMMANDS.md`, `ACCEPTANCE_TESTS.md` |

## Stack

| Layer | Tech |
|---|---|
| DB / auth / storage | Supabase (Postgres 15) — project ref `mkgkrfcfhtrlecfuzroz` |
| UI | Next.js 15 + React 19 + TypeScript + Tailwind v4 |
| Orchestration | n8n.cloud — `https://anthonysocleacquisitions.app.n8n.cloud` |
| Mobile | Telegram bot (token in `.env.local`, chat ID still TODO) |
| Voice | Twilio (planned) |

## What's live

### Database (Supabase project `mkgkrfcfhtrlecfuzroz`)
All 5 migrations applied (verified via Supabase MCP):
- `0001_init.sql` — base schema (16 tables: campaigns, properties, contacts, property_contacts, phones, leads, lead_assignments, call_logs, lead_submissions, review_items, follow_ups, automation_events, proposed_actions, command_inbox, users_meta, import_jobs)
- `0002_followups_sync.sql` — Google Calendar / Tasks sync fields
- `0003_user_roles.sql` — widened role taxonomy (admin/manager/cold_caller/caller/research_assistant/viewer) + `is_active` + `email`
- `0004_enrichment_extensions.sql` — created `enrichment_jobs` + `enrichment_results` tables (they were missing from 0001 — caught via Supabase MCP)
- `0005_properties_source.sql` — added `source` + `source_meta` to properties

**Seeded data right now**: 10 leads in Granby, 10 properties, 11 contacts, 10 phones, 1 campaign, 3 follow-ups (overdue/today/+1d), 1 hot-seller submission, 1 open review item, 1 pending proposed action. All assigned to seeded caller "Gaylord (seed)".

### Users
- `anthony@socleacquisitions.com` — **admin** in users_meta + `app_metadata.role='admin'` ✓
- `gaylord+seed@socleacquisitions.com` — caller (no password set; created via service role admin API for testing)

### App surfaces (all live at localhost:8985 once `npm run dev`)
| Route | Role | What |
|---|---|---|
| `/` | admin | Dashboard with 6 count tiles, recent imports, recent failures |
| `/leads` | admin | Filterable list, bulk-assign, bulk-send-to-enrichment, → click to dossier |
| `/leads/[id]` | admin | Full dossier — status/priority/notes editor, follow-up quick-add, enrichment panel with Approve/Reject |
| `/leads/new` | admin | Manual lead create form |
| `/calls/queue` | caller | Caller's assigned-leads-only view |
| `/calls/[id]` | caller | Call workspace — phone selector, outcome buttons, hot-seller submission, "+next" auto-advance |
| `/properties` + `/properties/[id]` | admin | Property browser + detail |
| `/contacts` + `/contacts/[id]` | admin | Contact browser + detail |
| `/follow-ups` | admin/caller | Overdue / today / upcoming buckets, complete/cancel |
| `/calendar` | admin/caller | Read-only 14-day window, overdue at top |
| `/review` | admin | Review items + proposed actions with Approve/Reject |
| `/import` | admin | XLSX upload → parse (formats A & B) → preview → confirm |
| `/data-health` | admin | 12 dirty-data tiles deep-linking to filters |
| `/admin/test` | admin | Self-validating system readiness checklist with `/api/diagnostics` + inline seeders |
| `/admin/seed` | admin | One-click seeders |
| `/admin/users` | admin | Inline role/active/Telegram/Twilio editor + auto-detects orphans |
| `/admin/events` | admin | Audit log filterable by source/status |
| `/admin/enrichment` | admin | All enrichment jobs + pending results, retry/cancel actions, stuck-job warning |

### API endpoints
See `API.md` for the full list. Status: ✅ all listed endpoints shipped + tested.

Critical CRM-side n8n endpoints (auth: `Bearer ${N8N_SHARED_KEY}`):
- `POST /api/n8n/event` — single audit-log sink
- `POST /api/n8n/lead` — create/update lead from email triage
- `POST /api/n8n/enrichment-result` — n8n posts a single phone/email/website finding (always lands `unverified`)
- `POST /api/follow-ups/[id]/sync` — single sync writeback
- `POST /api/follow-ups/sync-batch` — bulk sync writeback (up to 500)

### Parsers
- Format A (Longueuil/Sherbrooke style — one row per (property, owner)): 12/12 smoke tests pass
- Format B (Granby compact-indexed `Propriétaire1_Téléphone`): 16/16 smoke tests pass
- Format C/D: deferred until sample files arrive

## What's NOT live yet

| Thing | Why |
|---|---|
| Phone enrichment workflow itself in n8n | Skeleton ready (CRM accepts results), but not connecting to Brave/Places/PJ until the round-trip is verified |
| Twilio click-to-call | Deferred to phase 2 |
| SMS outreach | Phase 3 (Quebec Law 25 requires consent UI) |
| Real n8n integration to CRM | Workflow `2gZp3dbXCZPU3NV6` ("Auto-Reply: Immeubles Quebec") exists but doesn't yet call /api/n8n/lead or /api/n8n/event |
| Telegram inbound webhook | Code is written; needs public URL (ngrok or Vercel deploy) |
| Vercel deployment | Pending; works locally |

## Credentials + env vars

`web/.env.local` (gitignored, do NOT commit):
```
NEXT_PUBLIC_SUPABASE_URL=https://mkgkrfcfhtrlecfuzroz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (anon)
SUPABASE_SERVICE_ROLE_KEY=eyJ... (service role)
TELEGRAM_BOT_TOKEN=__paste_bot_token__
TELEGRAM_WEBHOOK_SECRET=__will_set_when_we_register_webhook__
TELEGRAM_ANTHONY_CHAT_ID=__not_yet_set__
N8N_SHARED_KEY=__not_yet_set__
N8N_ENRICHMENT_WEBHOOK_URL=__not_yet_set__
```

**Rotate the Telegram bot token before public release** — it's been pasted in chat history.

## MCP tools available in this conversation

The new Claude session will need to load these on demand via ToolSearch.

| MCP | Server ID | Use for |
|---|---|---|
| Supabase | `mcp__b5cf397b-abae-4d06-8d41-3f22bf9c77c3__*` | Apply migrations, run SQL, list tables. **Project ID `mkgkrfcfhtrlecfuzroz`**. Already used to apply 0004 + 0005 + seed 10 leads. |
| n8n | `mcp__b17bca73-2e29-47c8-a386-0b1d6a688db6__*` | Inspect / edit / create workflows. Already inspected workflow `2gZp3dbXCZPU3NV6`. |
| workspace bash | `mcp__workspace__bash` | Sandbox shell — Postgres mounted via `psql`, repo at `/sessions/.../mnt/Documents/New project/socle-v2`. |
| Cowork | `mcp__cowork__*` | File access into the user's repo via Read/Write/Edit/Grep tools. |

**Not yet loaded**: Telegram MCP (none exists), Twilio MCP (none exists), Vercel MCP (not loaded).

**Direct credentials I have**: Supabase service-role key (in env), Telegram bot token (in env). I can hit Supabase REST + run any SQL via the MCP without your browser. I CANNOT hit endpoints that require admin JWT (e.g. `/admin/seed`) without your browser session — I work around this by running the same operation directly via SQL.

## Open n8n workflow

`Auto-Reply: Immeubles Quebec` (ID `2gZp3dbXCZPU3NV6`)
- 11 nodes, fully built. Gmail trigger → AI classifier (GPT-4o-mini) → routes to scenario_a (ask for financials) or scenario_b (acknowledge numbers) → Gmail draft.
- **Waiting on Anthony**: attach Gmail OAuth2 credential to 3 nodes, attach OpenAI API credential to 1 node. Direct link: `https://anthonysocleacquisitions.app.n8n.cloud/workflow/2gZp3dbXCZPU3NV6`
- **Missing CRM integration** (need to add): `POST /api/n8n/lead` after Parse Classification, `POST /api/n8n/event` at the end of each branch, optional Telegram alert for scenario_b.

## Critical decisions logged in DECISIONS.md (50+ entries)

Most-relevant for forward work:
- Auth helpers return-result, never throw (Next.js hangs on thrown Response)
- All enrichment results land `unverified` — never auto-write to phones/contacts/leads
- `/admin/test` is the single source of truth for "is the platform ready"
- Migration 0001 was missing enrichment tables — fixed in 0004 via Supabase MCP
- `properties.source` was missing from 0001 — fixed in 0005
- Stuck-job heuristic: pending > 30 min OR running > 60 min
- Caller-tier roles (manager/cold_caller/research_assistant/viewer) all share caller-style RLS today; specialization is a future migration

## Acceptance tests (in ACCEPTANCE_TESTS.md)

AT-1 through AT-21 cover: import, leads list, dossier, caller workspace, hot seller submission, review inbox, follow-ups, Telegram, n8n event sink, sync, data-health, users, calendar, batch sync, lead detail admin actions, proposed action approve, n8n audit, system readiness, follow-up sync round-trip, enrichment round-trip, enrichment ops dashboard.

## Current footprint

- **95 source files** in `web/app/components/lib`, ~8,610 LoC
- **TypeScript**: 0 errors (`npx tsc --noEmit`)
- **Parser smoke tests**: Format A 12/12 ✓, Format B 16/16 ✓
- **All 5 migrations applied to live DB** ✓
- **Seed data populated** ✓

## Where we left off + what to do next

The user just acknowledged the conversation is getting heavy and asked for context to switch to a new one. The immediate state:

1. ✅ Platform is provably operational. Visit `/admin/test` after sign-out + sign-in to verify (the JWT may need refresh).
2. ⏳ Next priorities (the blueprint says: stabilize → enrich → operate):
   - **Now**: Anthony walks through the surfaces with seeded data; confirms nothing is broken in the UI
   - **Next**: build CRM integration into the existing email-triage n8n workflow (add `/api/n8n/lead` + `/api/n8n/event` calls). Needs `N8N_SHARED_KEY` + a public CRM URL (ngrok or Vercel)
   - **After**: build the actual phone-enrichment n8n workflow (Brave → Places → Pages Jaunes → POST `/api/n8n/enrichment-result`). All CRM-side plumbing already done.
   - **Defer**: OpenClaw, paid enrichment, AI scoring, proposal engine, Format C/D parsers

## Working style (Anthony's stated preferences)

- "Do not stop because git commit failed from a sandbox lock." Code on disk is fine; document the command Anthony must run.
- "Do not stop because Anthony has not manually tested yet." Keep building.
- Real blockers only: app can't compile · DB blocked · migration impossible · auth impossible · missing secret with no stub · data-loss/security risk · business-critical decision needed.
- Anthony likes one-click everything. `/admin/seed` exists so he doesn't need browser console. `/admin/test` exists so he doesn't need to query SQL.
- Use Supabase MCP for any DB op — don't ask Anthony to paste SQL.
- End-of-session report format: Built / Tested / Works / Needs Anthony manual setup / Real blockers / Exact commands Anthony must run / Next recommended step.
