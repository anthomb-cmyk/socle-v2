# N8N_WORKFLOWS.md

Every n8n workflow we plan to ship. Status: ⏳ planned · 🚧 in progress · ✅ live.

Each workflow is **owned** by n8n. The CRM is the source of truth — n8n calls API endpoints (`/api/n8n/*`), never writes directly to Supabase. Every workflow ends by POSTing an `automation_events` row.

| # | Name | Status | Trigger | Calls |
|---|---|---|---|---|
| W1 | Email triage | ⏳ | Gmail label `Inbox` new message | `POST /api/n8n/lead` (create/update) → optional `POST /api/follow-ups` → optional `POST /api/telegram/notify` |
| W2 | Daily command brief | ⏳ | Cron 09:00 weekday | `GET /api/automation/daily-brief` → Telegram send |
| W3 | Overdue follow-up nudge | ⏳ | Cron 09:00 + 15:00 | `GET /api/follow-ups?overdue=true` → Telegram send |
| W4 | Call prep | ⏳ | Calendar event 15min before | `GET /api/leads/[id]/prep` → Telegram send |
| W5 | Telegram chatbot router | ⏳ | Telegram webhook (proxied through n8n if we want LLM) | calls relevant CRM endpoints |
| W6 | CRM follow-up → Google Task sync | ⏳ | Webhook from CRM on follow-up create | Google Tasks API → `PATCH /api/follow-ups/[id]` to write back gtask_id |
| W7 | Phone enrichment | ⏳ | Webhook `enrich-lead` from CRM | Brave Search → Places → PJ → `POST /api/leads/[id]/phones` |
| W8 | Research job runner (Phase 3) | ⏳ | Webhook `research-job` | OpenClaw → `POST /api/research/[id]/result` |

## Authoring rules

1. **Endpoint must exist before workflow goes live.** A workflow that POSTs to a 404 endpoint creates silent failures — exactly the v1 problem we're fixing.
2. **Test payload first.** For every workflow, copy a representative payload into the n8n "Manual" trigger node and run it through end-to-end. Save the result as a comment on the workflow.
3. **Idempotency-Key header on every CRM call.** Use a deterministic value: e.g. `gmail-message-id` for W1, `cron-${date}` for W2.
4. **Always end with `automation_events`.** The last node in every workflow is "Log to CRM" — POSTs to `/api/n8n/event` with the run summary.
5. **Failures are visible.** If any node errors, the catch branch posts `automation_events.status='failed'` with the error and (for high-priority workflows) a Telegram alert.
6. **No data ownership.** Workflows must not store business data in n8n's own variables/credentials. State lives in Supabase.

## Source-controlled exports

Each workflow is exported as JSON to `/n8n/workflows/<workflow-name>.json` after every meaningful change. Diffs go through PR review like code.
