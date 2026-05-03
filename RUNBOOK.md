# RUNBOOK.md

> **Production is live.** Railway URL: `https://socle-v2-production.up.railway.app`
> One-time setup is complete. Use this file for operational procedures and re-deployment steps.

Setup steps for v2. Anthony does the parts marked **[manual]**; everything else is automated.

## One-time infra setup

### 1. Supabase project **[manual]**

1. Go to [supabase.com](https://supabase.com) → New project
2. Name: `socle-v2`. Region: `ca-central-1` (closest to Quebec).
3. Save the project URL + anon key + service-role key into a password manager.
4. **Enable Google OAuth provider**: Project → Authentication → Providers → Google → Enable. Use the same Google OAuth client as your existing Calendar integration (Project Settings → Authentication → Redirect URLs should include your Vercel domain once deployed).

### 2. Apply migrations

```bash
cd "/Users/anthonymakeen/Documents/New project/socle-v2"
supabase link --project-ref YOUR-PROJECT-REF
supabase db push    # applies supabase/migrations/0001_init.sql
```

### 3. Seed admin role for Anthony **[manual, one SQL command]**

In Supabase SQL editor, after Anthony has signed in once via the web app:

```sql
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb), '{role}', '"admin"'
)
where email = 'anthonymakeen@gmail.com';

insert into users_meta (user_id, display_name, role)
select id, 'Anthony Makeen', 'admin' from auth.users where email = 'anthonymakeen@gmail.com'
on conflict (user_id) do update set role = 'admin', display_name = 'Anthony Makeen';
```

(Repeat with `'caller'` for Gaylord once he signs in.)

### 4. Railway deployment **[COMPLETE as of 2026-04-30]**

Railway is the production platform. Vercel is superseded.

- Root directory: `web/`
- `web/railway.json` handles build + start commands — do not override in Railway UI
- All env vars set in Railway → Service → Variables (see DEPLOY.md for full list)
- Supabase Auth URL Configuration updated to Railway URL

### 5. n8n.cloud **[COMPLETE — W1a active, W1a-biz pending]**

W1a (`2gZp3dbXCZPU3NV6`) is live and pointing to Railway.
Pending manual steps: attach Gmail OAuth2 credentials to trigger + 2 draft nodes, attach OpenAI credential to classifier.

### 6. Telegram bot **[manual, deferred until Phase 2]**

Skip. Created with @BotFather when we wire the alerts.

## Local development

```bash
cd web
pnpm install
cp ../.env.example .env.local      # fill with Supabase URL + anon key
pnpm dev                           # http://localhost:3000
```

Run migrations against a local Supabase:

```bash
cd ..
supabase start                     # boots local Postgres on :54322
supabase db reset                  # re-runs all migrations from scratch
```

## Common operations

### Re-run migrations
```bash
supabase db push        # remote
supabase db reset       # local — destroys data
```

### Apply migration 0003 (role taxonomy + is_active + email mirror)
Paste `supabase/migrations/0003_user_roles.sql` into the SQL Editor. Idempotent.
After applying, you'll be able to manage users at `/admin/users` instead of via SQL.

### Apply migration 0004 (enrichment extensions)
Paste `supabase/migrations/0004_enrichment_extensions.sql` into the SQL Editor.
Adds `enrichment_jobs.job_type`, widens `enrichment_kind` enum, and extends
`enrichment_results` with `lead_id` / `source_url` / `raw_payload` / `reviewed_*`.
Idempotent.

### Operate enrichment from the admin UI
- `/admin/enrichment` — counts by status, stuck-job warning, pending results awaiting approval, jobs table with Retry/Cancel inline.
- `/leads` → select rows → "Send to enrichment ▾" → batch-queue jobs (skips leads with existing non-terminal job of the same type unless Force is checked).

### Test the enrichment round-trip end-to-end
```bash
# 1. Create an enrichment job (no actual research happens — just creates row)
LEAD_ID="<a real lead id>"
curl -X POST http://localhost:8985/api/enrichment-jobs \
  -H "Content-Type: application/json" \
  --cookie "$(your supabase session cookie)" \
  -d '{ "leadId": "'$LEAD_ID'", "jobType": "find_phone" }'

# 2. Simulate n8n posting back a result
JOB_ID="<job id from step 1>"
curl -X POST http://localhost:8985/api/n8n/enrichment-result \
  -H "Authorization: Bearer $N8N_SHARED_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"enrichment_job_id\": \"$JOB_ID\",
    \"lead_id\": \"$LEAD_ID\",
    \"result_type\": \"phone\",
    \"value\": \"+15145550199\",
    \"source\": \"brave\",
    \"source_url\": \"https://example.com\",
    \"confidence\": 80
  }"

# 3. Verify on /leads/$LEAD_ID — the result appears under "Pending review"
#    with Approve/Reject buttons.
```

### Single command to know if the platform is healthy
Visit **`/admin/test`** — it reports migrations applied, env vars set, JWT
freshness, admin user configured, and seed-data counts. Each failing row
expands to show the exact fix. Click the green "Seed everything" button if
starting from empty state.

### Apply migrations 0007 + 0008 + 0009 (W7 phone pipeline v2/v3)

All three migrations are required before W7 can run on Railway.

**Migration 0007** — creates `phone_candidates`, `enrichment_events`, and required enums:
1. Supabase dashboard → SQL Editor
2. Paste contents of `supabase/migrations/0007_phone_pipeline.sql`
3. Click Run

**Migration 0008** — adds address-first pipeline v2 columns and enum values:
1. Supabase dashboard → SQL Editor
2. Paste contents of `supabase/migrations/0008_pipeline_v2_stages.sql`
3. Click Run

**Migration 0009** — OpenClaw as Stage 3 (B2BHint removed):
1. Supabase dashboard → SQL Editor
2. Paste contents of `supabase/migrations/0009_openclaw_stage3.sql`
3. Click Run

All three are fully idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` throughout).

**Verify in `/admin/test`:** look for `migration_0007` and `migration_0008` rows under Migrations — both should show ✓. Migration 0009 is verified by the `w7_openclaw_researching` counter being present.

### Set Railway env vars for W7

In Railway → socle-v2 service → Variables:

| Var | Required for | How to get |
|---|---|---|
| `BRAVE_SEARCH_API_KEY` | Stages 1 + 2 (required) | https://api.search.brave.com |
| `OPENCLAW_WEBHOOK_URL` | Stage 3 (optional) | n8n OpenClaw workflow webhook URL |

Without `BRAVE_SEARCH_API_KEY`, calling `POST /api/enrichment/start` will throw at runtime and the job will be marked failed.

**Note:** `B2BHINT_API_KEY` has been removed from the pipeline entirely. Do not set it — it is no longer referenced. OpenClaw (Stage 3) reads public B2BHint pages via browser without any API key.

### Test W7 on one lead

From a signed-in admin browser at `/admin/test`:
- Scroll to "W7 enrichment — single lead test"
- Click "Run enrichment test (1 lead)"
- Inspect result: outcome, stage reached, candidate phone, confidence, matched_on, source URL

Or via curl:
```bash
curl -X POST https://socle-v2-production.up.railway.app/api/dev/test-enrichment-one \
  -H "Cookie: <your session cookie>"
```

Expected responses:
- `outcome: "solved"` — phone found ≥80 confidence, auto-attached, lead is `ready_to_call`
- `outcome: "review"` — phone found 50–79 confidence, waiting at `/review`
- `outcome: "unresolved"` — nothing found (check `BRAVE_SEARCH_API_KEY` is set)

### Interpret W7 outcomes

| outcome | What happened | Where to look |
|---|---|---|
| `solved` | Phone auto-attached, lead → `ready_to_call` | `/leads` → filter `ready_to_call` |
| `review` | Phone candidate queued for you to approve | `/phone-review` → approve or reject |
| `openclaw_dispatched` | Stage 3 webhook sent to n8n, waiting for callback | `enrichment_jobs` table, status=`processing`; lead status=`openclaw_researching` |
| `unresolved` | No phone found — OPENCLAW_WEBHOOK_URL not set | `enrichment_events` for the lead shows what was tried; lead status=`unresolved_after_openclaw` |

### Approve/reject a phone candidate
Go to `/review` → find the candidate → click Approve (attaches phone, sets `ready_to_call`) or Reject (marks `rejected_by_anthony`).

### Apply migration 0002 manually (if Supabase CLI not installed)
Paste the contents of `supabase/migrations/0002_followups_sync.sql` into the
Supabase SQL Editor (same workflow as 0001) and click Run. Adds
`gtask_list_id`, `gcal_calendar_id`, `sync_status`, `sync_error`,
`sync_target` to `follow_ups`. Idempotent (uses `add column if not exists`).

### Generate TypeScript types after schema change
```bash
supabase gen types typescript --project-id YOUR-REF > web/lib/database.types.ts
```

### Inspect a stuck import job
```sql
select id, status, errors, errors_count, total_rows, started_at, completed_at
from import_jobs order by created_at desc limit 5;
```

### Cancel a running job
```sql
update import_jobs set status = 'cancelled' where id = '...';
```

### View Anthony's open review inbox (CLI)
```sql
select id, urgency, title, summary, created_at
from review_items where status = 'open'
order by case urgency when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
         created_at desc;
```

## Manual commands Anthony runs occasionally

### After every commit (sandbox can't push)
```bash
cd "/Users/anthonymakeen/Documents/New project/socle-v2"
rm -f .git/index.lock                              # clear any stale sandbox lock
git add -A
git -c user.email="anthony@socleacquisitions.com" -c user.name="Anthony Makeen" \
    commit -m "<message>"
git push origin main                               # once GitHub auth is sorted
```

If the GitHub push fails (HTTPS keychain issue we hit earlier), the working
fallback is GitHub CLI:
```bash
brew install gh
gh auth login                                      # GitHub.com → HTTPS → browser
git push -u origin main
```

### Refresh JWT after role change
```text
1. Click "Sign out" in the top-right of the app
2. Sign in again via Google
   (the JWT now includes app_metadata.role from raw_app_meta_data)
```

### Discover Telegram chat ID (one-time)
```text
1. Open Telegram, find your bot, send "/start"
2. Visit http://localhost:8985/api/telegram/identify (admin only)
3. Copy the `id` from the response
4. Add to web/.env.local: TELEGRAM_ANTHONY_CHAT_ID=<id>
5. Restart `npm run dev`
```

### Register the Telegram inbound webhook (when deployed)
Local dev needs an ngrok tunnel; prod uses your Vercel URL.
```bash
# generate webhook secret
openssl rand -hex 32
# put into web/.env.local: TELEGRAM_WEBHOOK_SECRET=<that>

# (local) start ngrok if testing inbound: ngrok http 8985

# register the webhook (admin must be signed in — call from the browser console):
fetch("/api/telegram/setup", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicUrl: "https://YOUR-PUBLIC-URL" })
}).then(r => r.json()).then(console.log)
```

### Seed test data (any time you want a clean dev state)
From a signed-in admin browser console at http://localhost:8985:
```js
// 1. A fake caller user
fetch("/api/dev/seed-caller", { method: "POST" }).then(r => r.json()).then(console.log)

// 2. 10 leads in Granby, assigned to that caller, with sample follow-ups
fetch("/api/dev/seed-leads", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    count: 10, city: "Granby",
    assignToUserId: "<userId from previous response>",
    createFollowUps: true, createReviewItem: true
  })
}).then(r => r.json()).then(console.log)

// 3. A fully-formed hot-seller submission (campaign → property → contact →
//    phone → lead → call_log → submission → review_item → automation_event
//    → optional Telegram alert)
fetch("/api/dev/seed-submission", { method: "POST" }).then(r => r.json()).then(console.log)

// 4. A synthetic Telegram-style proposed_action attached to the latest lead
fetch("/api/dev/seed-proposed-action", { method: "POST" }).then(r => r.json()).then(console.log)
// Then visit /review and Approve/Reject it — the note will be appended to lead.notes.
```

### n8n audit sink test
```bash
# Set N8N_SHARED_KEY in web/.env.local first, then restart dev server.
curl -X POST http://localhost:8985/api/n8n/event \
  -H "Authorization: Bearer YOUR_N8N_SHARED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "smoke_test",
    "status": "success",
    "payload": { "from": "manual curl test" }
  }'
# Expected: { ok: true, data: { eventId: "..." } }
# Verify in /admin/events filtered by source=n8n.
```

## Things that will go wrong, and how to recover

| Symptom | Likely cause | Fix |
|---|---|---|
| Signup works but RLS blocks every read | Role not set in `app_metadata` | Run the SQL in step 3 above |
| Import preview shows 0 rows | XLSX parser didn't detect format | Check `import_jobs.format_detected`; if 'unknown', see `docs/ROLE_FORMATS.md` |
| Caller sees admin views | RLS not enabled or policy wrong | `select tablename, rowsecurity from pg_tables where schemaname='public';` — all should be true |
| Telegram bot stops responding | Webhook expired | Re-set webhook: `curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d url=https://YOUR-VERCEL/api/telegram/webhook` |
| `import_jobs.preview_data` is huge | We stash full parsed result in jsonb to enable confirm-without-reupload | Files >5MB should switch to Supabase Storage upload + Edge Function processing (Phase 2) |
| Dashboard shows stale counts | Server component caches | Hard-reload (Cmd+Shift+R); admin pages aren't aggressively cached |
| `/calls/queue` empty when you expect leads | Either nothing assigned to you OR all leads are in non-callable status | Check `/leads?assigned_to=<your uid>` to verify |

## Cost ceilings (for reference)

| Service | Tier | Likely monthly |
|---|---|---|
| Supabase | Free → Pro $25 | $0 until 500MB / 2GB egress, then $25 |
| Vercel | Free → Pro $20 | $0 until 100GB bandwidth |
| n8n.cloud | Free → Starter $24 | $0 until 5k executions |
| Twilio | Pay-as-you-go | $0.013/min outbound + $1/mo number |
| Brave Search | Free | $0 (1 qps limit) |
| Google Places | Pay-as-you-go | ~$17 per 1k Text Search calls — same as v1 |
