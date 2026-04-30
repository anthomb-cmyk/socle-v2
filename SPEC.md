# Socle CRM V2 — Spec

Québec multifamily acquisition operating system. Not a generic CRM.

Clean data in → system organizes it → callers work assigned leads → hot sellers reach Anthony → Anthony decides → n8n + Telegram execute.

## Stack

| Layer | Tech |
|---|---|
| Truth | Supabase (Postgres 15 + Auth + Storage) |
| UI | Next.js 15 App Router + React 19 + TypeScript + Tailwind v4 + shadcn/ui |
| Orchestration | n8n (n8n.cloud) |
| Mobile command | Telegram bot (grammY, Next.js webhook) |
| Voice | Twilio |
| Schedule | Google Calendar |
| Checkboxes | Google Tasks (selectively) |
| Research (later) | OpenClaw / background worker |

Single-tenant for Anthony + Gaylord + future cold callers. RLS uses `app_metadata.role` (`admin` vs `caller`).

## Product surfaces

| Surface | Who | What |
|---|---|---|
| Admin dashboard | Anthony | Imports, campaigns, leads, review inbox, data health, automation events |
| Cold caller workspace | Caller | Assigned leads only, call queue, outcome buttons, save+next |
| Anthony Review Inbox | Anthony | Hot sellers, caller submissions, command clarifications, urgent items |
| Telegram | Anthony | Hot alerts, daily brief, follow-up commands, search, call prep |
| n8n | system | Email triage, daily brief, overdue escalation, call prep, research jobs |

## Data model — high level

```
campaigns ─┬─< import_jobs ─< properties
           │                       │
           │                       └─< property_contacts >── contacts ─< contact_phones >── phones
           │                                                    │
           └─< leads ──< call_logs                               │
                  │       │                                       │
                  │       └─< lead_submissions ─> review_items   │
                  │                                               │
                  └─< follow_ups (gcal/gtasks synced)             │
                  └─< deals (Phase 2)                              │
                                                                  │
automation_events / proposed_actions / command_inbox  (cross-cutting logs)
```

Owners are not their own table. They're a **role** in `property_contacts` (relationship='owner' | 'co_owner' | …). A contact can be a person or a company; companies have rep contacts via the same M2M.

Phones are **first-class** with status, source, confidence, evidence — to protect callers from wrong-owner / DNC / bad-number confusion.

Cities are normalized server-side at import (`VICTORIAVILLE` → `Victoriaville`, `ST-HYACINTHE` → `Saint-Hyacinthe`). One canonical column on `properties.city`.

## Vertical slice (acceptance test path)

Upload Québec rôle XLSX → preview (counts, dupes, errors) → confirm → `import_jobs` row + properties + contacts + phones + leads created → filter leads by city → assign 5 to a caller → caller logs hot seller → submission lands in Review Inbox → Telegram alert sent to Anthony → `automation_events` row visible.

Everything else (deals, research, proposals, smart scoring) is built **after** the slice ships and works.

## Build order

1. Schema + RLS + seeds (this turn)
2. Next.js scaffold + Supabase client + Google SSO (next turn)
3. Import pipeline: upload → parse → preview → confirm → DB writes (next turn)
4. Leads list + city filter + assignment UI (turn after)
5. Caller workspace: queue, outcome buttons, save+next, hot-seller submission (turn after)
6. Review Inbox + Automation Events views (turn after)
7. Telegram bot: hot-seller alert + daily brief + 3 commands (turn after)

After the slice works end-to-end on a real Granby file, expand: enrichment workflow, follow-ups + gcal sync, deals pipeline, more Telegram commands, research jobs.

## Non-negotiable quality bar

- No silent failures. Every import / API / workflow logs to `automation_events` with status.
- No fake success toasts. UI shows the actual database row counts.
- No localStorage as truth. Everything lives in Supabase.
- No AI auto-sending email or making legal/financial commitments.
- No cold-caller access to deal strategy, proposals, or admin views (RLS-enforced).
- No important automation without a row in `automation_events`.
- "Done" means tested end-to-end against the live DB and UI, not just a passing unit test.

See [DECISIONS.md](./DECISIONS.md) for choices made and their rationale.
