# API.md

Every endpoint. Status: ⏳ planned · 🚧 in progress · ✅ shipped + tested.

All endpoints under `/api/` in the Next.js app. JSON in/out. Auth via Supabase session cookie (browser) or Bearer JWT (n8n/Telegram).

## Imports

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/import/upload` | ✅ | admin | Upload XLSX, parse, return preview job |
| POST | `/api/import/[jobId]/confirm` | ✅ | admin | Commit a previewed import |
| GET | `/api/import/[jobId]` | ✅ | admin/caller | Job state + preview data |

## Leads

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/leads` | ✅ | admin/caller | List leads (RLS-scoped). Query: `?city=&status=&assigned_to=&q=&limit=&offset=` |
| GET | `/api/leads/[id]` | ✅ | admin/caller | Lead dossier (lead + property + contact + phones + history) |
| PATCH | `/api/leads/[id]` | ✅ | admin | Update notes, status, priority, assigned_to. Inserts `lead_assignments` row on reassign. |
| POST | `/api/leads/assign` | ✅ | admin | `{ leadIds: [...], userId }` → bulk assign |
| GET | `/api/calls/next` | ✅ | admin/caller | Next eligible lead in queue (for "+next" auto-advance) |

## Properties / Contacts (admin browsers)

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/properties` | ✅ | admin/caller | Search by `?city=&q=`. Returns `lead_count` per row. |
| GET | `/api/contacts` | ✅ | admin/caller | Search by `?kind=&q=`. Returns `phone_count`, `lead_count` per row. |

## Calls + submissions

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/calls/log` | ✅ | caller/admin | Log a call outcome `{ leadId, phoneId?, outcome, notes?, durationSec? }`. Propagates DNC/bad-number to `phones`, advances `lead.status`. |
| POST | `/api/submissions` | ✅ | caller/admin | Submit hot lead `{ leadId, callLogId?, sellerInterestLevel, timeline, ..., callerSummary }`. Creates `review_items` + Telegram alert on urgent/high. |

## Review + automation

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/automation-events` | ✅ | admin | Audit log; filter by `?source=&status=&limit=&offset=` |
| GET | `/api/proposed-actions` | ✅ | admin | List pending proposed actions |
| POST | `/api/proposed-actions/[id]` | ✅ | admin | `{ action: "approve" \| "reject" }` — applies (when type=`append_note` + target=`leads`) or rejects |

## Follow-ups

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/follow-ups` | ✅ | admin/caller | `?status=&bucket=overdue\|today\|upcoming\|done&leadId=`. Hydrates `lead` info per row. |
| POST | `/api/follow-ups` | ✅ | admin/caller/telegram | Create `{ leadId?, contactId?, dueAt, note, priority?, source?, assignedToUserId? }` |
| PATCH | `/api/follow-ups/[id]` | ✅ | admin/caller | Update fields |
| DELETE | `/api/follow-ups/[id]` | ✅ | admin/caller | Soft cancel (status='cancelled') |
| POST | `/api/follow-ups/[id]/complete` | ✅ | admin/caller | Mark done |
| POST | `/api/follow-ups/[id]/sync` | ✅ | n8n bearer | n8n writes back sync state (gcal/gtask IDs, status, error) |
| POST | `/api/follow-ups/sync-batch` | ✅ | n8n bearer | Batch update many follow-ups in one POST. Per-row results, partial-success tolerated. |

## Users

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/users` | ✅ | admin/caller | List `users_meta` (admin sees all + auth.users orphans; caller sees self) |
| PATCH | `/api/users/[id]` | ✅ | admin | Update display_name / role / is_active / telegram_user_id / email / twilio_forward_to. Mirrors role to auth.app_metadata. |

## Auth

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/auth/signout` | ✅ | any | Clear Supabase session cookie |

## Dashboard

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/dashboard` | ✅ | admin | Counts + recent imports + recent failures |
| GET | `/api/data-health` | ✅ | admin | Dirty/stuck-data signals (counts) |
| GET | `/api/diagnostics` | ✅ | admin | System readiness: migrations + env + JWT + seed data, with per-check fix instructions |
| GET | `/api/health` | ✅ | none | Liveness probe; reports schema-applied status |

## Telegram

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/telegram/webhook` | ✅ | `X-Telegram-Bot-Api-Secret-Token` | Inbound bot messages; intent-parsed (today / search / follow_up / note / unknown). Logs every update to `automation_events`. |
| POST | `/api/telegram/setup` | ✅ | admin | One-shot helper: registers webhook with Telegram |
| GET | `/api/telegram/identify` | ✅ | admin | List recent chats from `getUpdates` to discover Anthony's `chat_id` |

## Enrichment

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/enrichment-jobs` | ✅ | admin | Create job `{ leadId, jobType?, contactId? }`. Fires `N8N_ENRICHMENT_WEBHOOK_URL` if configured. |
| GET | `/api/enrichment-jobs` | ✅ | admin | List jobs; filter `?leadId=&status=&limit=` |
| GET | `/api/enrichment-jobs/[id]` | ✅ | admin | Single job detail |
| PATCH | `/api/enrichment-jobs/[id]` | ✅ | admin OR n8n bearer | Update status / error_message / cost / workflow_run_id |
| POST | `/api/enrichment-jobs/[id]/retry` | ✅ | admin | Reset failed/cancelled job to pending, bump attempts, re-fire webhook (best-effort) |
| POST | `/api/enrichment-jobs/[id]/cancel` | ✅ | admin | Mark queued/running job as cancelled |
| POST | `/api/enrichment-jobs/batch` | ✅ | admin | `{ leadIds, jobType, force? }` — bulk create with skip-if-existing semantics. Returns per-row results. |
| GET | `/api/enrichment-results` | ✅ | admin/caller (RLS-scoped) | List results; filter `?leadId=&status=` |
| POST | `/api/enrichment-results/[id]` | ✅ | admin | Approve or reject. Approve writes to phones / contact's primary_email / primary_website depending on kind. |

## n8n

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/n8n/event` | ✅ | `Authorization: Bearer ${N8N_SHARED_KEY}` | Single audit-log sink. Inserts `automation_events` with `source='n8n'`. |
| POST | `/api/n8n/lead` | ✅ | bearer | Create/update a lead from email triage |
| POST | `/api/n8n/enrichment-result` | ✅ | bearer | n8n posts back a single phone/email/website/owner_identity/property_fact/note finding. Always lands as `unverified` for human approval. |

## Dev / seed (admin only)

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/dev/seed-caller` | ✅ | admin | Create a fake caller-role auth user |
| POST | `/api/dev/seed-leads` | ✅ | admin | Create campaign + N fake leads (+ optional follow-ups + review item) |
| POST | `/api/dev/seed-submission` | ✅ | admin | Full hot-seller path: campaign → … → review_item → Telegram |
| POST | `/api/dev/seed-proposed-action` | ✅ | admin | Synthetic Telegram-style note proposed for the latest lead |
| POST | `/api/dev/seed-everything` | ✅ | admin | One-shot full chain: caller → leads → follow-ups → submission → review → proposed action |

## Conventions

### Request shape
- All POST bodies validated via zod. Errors return 400 with `{ ok: false, error, errors: ZodIssue[] }`.

### Response shape
```ts
// success
{ ok: true, data: { ... } }

// error
{ ok: false, error: string, errors?: ZodIssue[] }
```

### Idempotency
- Mutating endpoints accept `Idempotency-Key` header. n8n and Telegram MUST send one (planned — currently best-effort via natural keys).
- `/api/calls/log` keys on `twilio_call_sid` if present.

### Logging contract
- Every mutating endpoint that's triggered by n8n or Telegram inserts an `automation_events` row.
- Web-app actions log when business-significant (import, assign, submit, review, lead_updated, follow_up_*).

### Error handling
- Never swallow errors. If a step fails partway, set `import_jobs.status='failed'` with the error in `errors[]`.

## Authentication

| Caller | How |
|---|---|
| Browser | Supabase session cookie (handled by `@supabase/ssr`) |
| n8n | Header: `Authorization: Bearer ${N8N_SHARED_KEY}` (env var, rotated quarterly) |
| Telegram webhook | `X-Telegram-Bot-Api-Secret-Token` header — must match `TELEGRAM_WEBHOOK_SECRET` env |
