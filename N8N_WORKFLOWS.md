# N8N_WORKFLOWS.md

Every n8n workflow we plan to ship. Status: ⏳ planned · 🚧 in progress · ✅ live.

Each workflow is **owned** by n8n. The CRM is the source of truth — n8n calls API endpoints (`/api/n8n/*`), never writes directly to Supabase. Every workflow ends by POSTing an `automation_events` row.

| # | Name | Status | Trigger | Calls |
|---|---|---|---|---|
| W1a | Auto-Reply: Immeubles Quebec | ✅ **Published** `2gZp3dbXCZPU3NV6` | Gmail new email | GPT-4o-mini classifier → Gmail draft. **Missing**: `POST /api/n8n/lead` + `POST /api/n8n/event` (alpha priority #1) |
| W1b | AI Secretary — Email Triage to Socle Calendar | ✅ **Published** `eLsh4aPMQfmNAOCx` | Gmail new email (3 inboxes) | GPT-4o-mini agent → Gmail draft / Calendar event / Google Tasks / Sheets / CRM lead |
| W2 | Daily command brief | ⏳ | Cron 09:00 weekday | `GET /api/automation/daily-brief` → Telegram send |
| W3 | Overdue follow-up nudge | ⏳ | Cron 09:00 + 15:00 | `GET /api/follow-ups?overdue=true` → Telegram send |
| W4 | Call prep | ⏳ | Calendar event 15min before | `GET /api/leads/[id]/prep` → Telegram send |
| W5 | Telegram chatbot router | ⏳ | Telegram webhook | CRM endpoints |
| W6 | CRM follow-up → Google Task sync | ⏳ | Webhook from CRM on follow-up create | Google Tasks API → `PATCH /api/follow-ups/[id]` to write back gtask_id |
| W7 | Staged phone enrichment | ⏳ **deferred — after alpha** | CRM webhook (`N8N_ENRICHMENT_WEBHOOK_URL`). Body: `{ enrichment_job_id, lead_id, contact_id, job_type }` | See staged pipeline below |
| W8 | OpenClaw research runner | ⏳ **deferred — after W7** | Webhook `research-job` | OpenClaw `POST /api/sessions/main/messages` → `POST /api/n8n/enrichment-result` |

## Enrichment workflow contract (W7)

The CRM owns the job lifecycle. n8n is a renderer + caller. **W7 is deferred — do not build until Email → CRM round-trip (alpha) is proven.**

### Staged pipeline architecture

W7 runs leads through a fixed four-stage pipeline. Leads exit as soon as one stage resolves their phone. Supabase status drives eligibility at every stage — n8n never passes arrays between stages.

```
Parser no-phone leads (needs_enrichment)
  → Stage 1: Brave Search      (brave_queued → ready_to_call OR unresolved_after_brave)
  → Stage 2: 411 / Directory   (directory_411_queued → ready_to_call OR unresolved_after_411)
  → Stage 3: Google Places     (places_queued → ready_to_call OR unresolved_after_places)
  → Stage 4: OpenClaw          (openclaw_queued → ready_to_call OR needs_human_review OR no_contact_found)
```

Each stage must:
1. Query Supabase for eligible leads **by status** (not from n8n memory)
2. Run the search / enrichment step
3. Save results to `enrichment_results` (always `unverified`)
4. Update `leads.status` to the next pipeline status
5. Set `best_phone_id` / `best_contact_id` when a result is high-confidence enough to auto-accept
6. Log `automation_events` with stage counts (see below)
7. Not touch leads that are already `ready_to_call` — exclude them by the status query

### Pipeline status values

| Status | Meaning |
|---|---|
| `ready_to_call` | Has a valid phone; callable immediately |
| `needs_enrichment` | No phone yet; queued for pipeline |
| `parser_needs_review` | Parser uncertain; awaits human review |
| `brave_queued` | In Brave search queue |
| `unresolved_after_brave` | Brave found nothing |
| `directory_411_queued` | In 411 queue |
| `unresolved_after_411` | 411 found nothing |
| `places_queued` | In Google Places queue |
| `unresolved_after_places` | Places found nothing or conflicting |
| `openclaw_queued` | Sent to OpenClaw for judgment |
| `needs_human_review` | OpenClaw uncertain; awaits human |
| `no_contact_found` | All stages exhausted; no phone found |

### Stage count reporting (required on every automation_events log)

Every stage posts an `automation_events` row with `event_type='enrichment_stage_complete'` and a `result` payload:

```json
{
  "stage": "brave",
  "input_count": 1420,
  "found_count": 350,
  "auto_accepted_count": 310,
  "pending_review_count": 40,
  "no_result_count": 1030,
  "failed_count": 40,
  "passed_to_next_count": 1030,
  "skipped_already_solved_count": 0
}
```

No fake success messages. Anthony must know exactly what happened at each stage.

### OpenClaw role (Stage 4)

OpenClaw is not a universal enrichment tool. It handles cases that prior API stages could not resolve:

- Low-confidence leads
- Conflicting search results
- Broker vs owner confusion
- Same phone appearing across many unrelated owners
- High-value leads with no phone after Brave / 411 / Places

OpenClaw must return structured findings:
```json
{
  "result_type": "phone | email | owner_identity | property_context | general",
  "value": "...",
  "source_url": "https://...",
  "confidence": 0,
  "reasoning_summary": "...",
  "raw_payload": {},
  "recommended_action": "..."
}
```

OpenClaw findings always land as `unverified enrichment_results`. OpenClaw never overwrites CRM records directly.

### CRM → n8n trigger payload

(CRM → n8n, when admin clicks "Send to enrichment" with `N8N_ENRICHMENT_WEBHOOK_URL` set):
```json
{
  "enrichment_job_id": "uuid",
  "lead_id": "uuid",
  "contact_id": "uuid",
  "job_type": "find_phone | verify_phone | find_email | find_website | owner_identity | property_context | general_research",
  "retry": false
}
```

`retry: true` is appended when the CRM retries a failed/cancelled job — n8n can use this flag to skip its dedup logic.

### n8n → CRM result callbacks

**One result per finding:**
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
  "raw_payload": {}
}
```

**Job-status callback at completion:**
```http
PATCH /api/enrichment-jobs/<id>
Authorization: Bearer ${N8N_SHARED_KEY}
Content-Type: application/json

{ "status": "success", "cost_usd": 0.04, "workflow_run_id": "n8n-execution-42" }
```

On workflow error:
```json
{ "status": "failed", "error_message": "Brave Search rate limited", "raw_output": {} }
```

**No auto-write** — every enrichment_result lands as `status='unverified'`. Anthony approves on `/leads/[id]`. Approved phone results are written to `phones` with `status='verified'` and source attribution.

### CRM admin operations on jobs (no n8n change needed)
- **Batch queue**: `POST /api/enrichment-jobs/batch` from `/leads` bulk action.
- **Retry**: `POST /api/enrichment-jobs/[id]/retry` resets a failed/cancelled job to pending and re-fires the webhook with `retry: true` in the payload.
- **Cancel**: `POST /api/enrichment-jobs/[id]/cancel` flips `status='cancelled'`. n8n is expected to honor cancellation if it polls; otherwise the cancel just stops the CRM from expecting more results.
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
