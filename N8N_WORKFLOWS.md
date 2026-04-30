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
| W7 | Phone enrichment | ⏳ | CRM webhook (set as `N8N_ENRICHMENT_WEBHOOK_URL` env). Body: `{ enrichment_job_id, lead_id, contact_id, job_type }` | Brave → Places → Pages Jaunes → for each finding `POST /api/n8n/enrichment-result` (one POST per finding). On done: `PATCH /api/enrichment-jobs/[id] { status: "success" }`. |
| W8 | Research job runner (Phase 3) | ⏳ | Webhook `research-job` | OpenClaw → `POST /api/research/[id]/result` |

## Enrichment workflow contract (W7)

The CRM owns the job lifecycle. n8n is a renderer + caller.

**Trigger payload** (CRM → n8n, when admin clicks "Send to enrichment" with `N8N_ENRICHMENT_WEBHOOK_URL` set):
```json
{
  "enrichment_job_id": "uuid",
  "lead_id": "uuid",
  "contact_id": "uuid",
  "job_type": "find_phone | verify_phone | find_email | find_website | owner_identity | property_context | general_research"
}
```

**Result callbacks** (n8n → CRM, one per finding):
```http
POST /api/n8n/enrichment-result
Authorization: Bearer ${N8N_SHARED_KEY}
Content-Type: application/json

{
  "enrichment_job_id": "uuid",
  "lead_id": "uuid",
  "result_type": "phone",
  "value": "+15145551234",
  "source": "brave_search",
  "source_url": "https://example.com/contact",
  "confidence": 80,
  "evidence": "Found on company contact page",
  "raw_payload": { /* whatever — for forensics */ }
}
```

**Job-status callback** (n8n → CRM, at completion):
```http
PATCH /api/enrichment-jobs/<id>
Authorization: Bearer ${N8N_SHARED_KEY}
Content-Type: application/json

{ "status": "success", "cost_usd": 0.04, "workflow_run_id": "n8n-execution-42" }
```

If the workflow errors:
```json
{ "status": "failed", "error_message": "Brave Search rate limited", "raw_output": { ... } }
```

**No auto-write** — every enrichment_result lands as `status='unverified'`. Anthony approves on `/leads/[id]`. Phone results that get approved are written to `phones` with status `verified` and source attribution.

### CRM admin operations on jobs (no n8n change needed)
- **Batch queue**: `POST /api/enrichment-jobs/batch` from `/leads` bulk action.
- **Retry**: `POST /api/enrichment-jobs/[id]/retry` resets a failed/cancelled job to pending and re-fires the webhook with `retry: true` in the payload. n8n can use that flag to skip its dedup logic.
- **Cancel**: `POST /api/enrichment-jobs/[id]/cancel` flips status='cancelled'. n8n is expected to honor cancellation if it polls; otherwise the cancel just stops the CRM from expecting more results.
- **Stuck detection** (CRM-side, not n8n): pending > 30 min or running > 60 min surfaces in `/admin/enrichment`, `/data-health`, and `/admin/test`. n8n doesn't need to know about it.

## Authoring rules

1. **Endpoint must exist before workflow goes live.** A workflow that POSTs to a 404 endpoint creates silent failures — exactly the v1 problem we're fixing.
2. **Test payload first.** For every workflow, copy a representative payload into the n8n "Manual" trigger node and run it through end-to-end. Save the result as a comment on the workflow.
3. **Idempotency-Key header on every CRM call.** Use a deterministic value: e.g. `gmail-message-id` for W1, `cron-${date}` for W2.
4. **Always end with `automation_events`.** The last node in every workflow is "Log to CRM" — POSTs to `/api/n8n/event` with the run summary.
5. **Failures are visible.** If any node errors, the catch branch posts `automation_events.status='failed'` with the error and (for high-priority workflows) a Telegram alert.
6. **No data ownership.** Workflows must not store business data in n8n's own variables/credentials. State lives in Supabase.

## Source-controlled exports

Each workflow is exported as JSON to `/n8n/workflows/<workflow-name>.json` after every meaningful change. Diffs go through PR review like code.
