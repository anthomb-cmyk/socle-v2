# API.md

Every endpoint. Status: ⏳ planned · 🚧 in progress · ✅ shipped + tested.

All endpoints under `/api/` in the Next.js app. JSON in/out. Auth via Supabase session cookie (browser) or Bearer JWT (n8n/Telegram).

| Method | Path | Status | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/import/upload` | ⏳ | admin | Upload XLSX, parse, return preview job |
| POST | `/api/import/[jobId]/confirm` | ⏳ | admin | Commit a previewed import |
| POST | `/api/import/[jobId]/cancel` | ⏳ | admin | Cancel a pending/preview job |
| GET | `/api/import/[jobId]` | ⏳ | admin | Job state + preview data |
| GET | `/api/leads` | ⏳ | admin/caller | List leads (RLS-scoped). Query: `?city=&status=&assigned_to=&q=` |
| POST | `/api/leads/assign` | ⏳ | admin | `{ leadIds: [...], userId }` → bulk assign |
| GET | `/api/leads/[id]` | ⏳ | admin/caller | Lead dossier with property + contact + phones + history |
| POST | `/api/calls/log` | ⏳ | caller/admin | Log a call outcome `{ leadId, phoneId, outcome, notes, durationSec? }` |
| POST | `/api/submissions` | ⏳ | caller/admin | Submit hot lead `{ leadId, callLogId, sellerInterestLevel, ... }` |
| POST | `/api/submissions/[id]/review` | ⏳ | admin | Accept / archive / reject a submission |
| GET | `/api/review` | ⏳ | admin | Review inbox listing (open items by urgency) |
| GET | `/api/automation-events` | ⏳ | admin | Audit log, filterable by source/status/related |
| POST | `/api/follow-ups` | ⏳ | admin/caller/n8n/telegram | Create a follow-up |
| POST | `/api/follow-ups/[id]/complete` | ⏳ | admin/caller | Mark done |
| POST | `/api/telegram/webhook` | ⏳ | bot secret | Telegram inbound — parses commands |
| POST | `/api/n8n/event` | ⏳ | n8n shared key | n8n posts an automation_event row |
| POST | `/api/n8n/lead` | ⏳ | n8n shared key | Create/update a lead from email triage |
| GET | `/api/health` | ⏳ | none | Liveness probe |

## Conventions

### Request shape
- All POST bodies validated via zod. Errors return 400 with `{ ok: false, errors: [{ path, message }] }`.

### Response shape
```ts
// success
{ ok: true, data: { ... } }

// error
{ ok: false, error: string, errors?: ZodIssue[] }
```

### Idempotency
- Mutating endpoints accept `Idempotency-Key` header. n8n and Telegram MUST send one.
- `/api/calls/log` keys on `twilio_call_sid` if present.

### Logging contract
- Every mutating endpoint that's triggered by n8n or Telegram inserts an `automation_events` row before returning.
- Web-app actions log only when business-significant (import, assign, submit, review).

### Error handling
- Never swallow errors. If a step fails partway, set `import_jobs.status='failed'` with the error in `errors[]`, don't hide it.

## Authentication

| Caller | How |
|---|---|
| Browser | Supabase session cookie (handled by `@supabase/ssr`) |
| n8n | Header: `Authorization: Bearer ${N8N_SHARED_KEY}` (env var, rotated quarterly) |
| Telegram webhook | Path-secret + verify Telegram's `X-Telegram-Bot-Api-Secret-Token` header |
