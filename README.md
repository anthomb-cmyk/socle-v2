# Socle CRM V2

Québec multifamily acquisition operating system. Clean rebuild.

See [SPEC.md](./SPEC.md) for product, [DECISIONS.md](./DECISIONS.md) for choices.

## Status

Foundation in place — schema, docs, decision log. Vertical slice (import → assign → hot seller → Telegram → review inbox) is the next milestone. v1 (`../proforma-`) stays live in production until v2 hits parity.

## Stack at a glance

- Postgres / Auth / Storage: **Supabase**
- UI: **Next.js 15 + TypeScript + Tailwind v4**
- Orchestration: **n8n.cloud**
- Mobile: **Telegram bot (grammY)**
- Voice: **Twilio**

## Repo layout

```
SPEC.md                  ← product spec, build order, quality bar
DECISIONS.md             ← append-only decision log
RUNBOOK.md               ← infra setup + ops + recovery
ACCEPTANCE_TESTS.md      ← E2E acceptance tests (AT-1 is the must-pass)
API.md                   ← every endpoint, status tracked
N8N_WORKFLOWS.md         ← every workflow, status tracked
TELEGRAM_COMMANDS.md     ← Telegram bot commands
.env.example
.gitignore
supabase/
  migrations/0001_init.sql   ← full schema (~500 lines, 16 tables, RLS)
n8n/
  workflows/                 ← exported workflow JSON
web/                         ← Next.js app (scaffolded next turn)
scripts/                     ← v1→v2 migration (Phase 3)
docs/
  ROLE_FORMATS.md            ← Quebec rôle XLSX format reference
```

## Get started

See [RUNBOOK.md](./RUNBOOK.md) — three sections of `[manual]` setup (~15 min), then `pnpm dev`.

## How "done" is defined

A feature is **done** only when:
1. It works end-to-end against the live Supabase + UI.
2. Data is persisted.
3. UI shows the result.
4. Failures are visible (not swallowed).
5. The relevant row of the matching `AT-*` acceptance test passes manually.

No exceptions. v1 broke this rule constantly and the bugs piled up.
