# RUNBOOK.md

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

### 4. Vercel project **[manual]**

1. Import the `socle-v2` repo in Vercel.
2. Root directory: `web/`.
3. Add env vars from `.env.example` (filled in with real values).
4. Deploy.

### 5. n8n.cloud **[manual, deferred until Phase 2]**

Skip until import + caller workspace are working.

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

## Things that will go wrong, and how to recover

| Symptom | Likely cause | Fix |
|---|---|---|
| Signup works but RLS blocks every read | Role not set in `app_metadata` | Run the SQL in step 3 above |
| Import preview shows 0 rows | XLSX parser didn't detect format | Check `import_jobs.format_detected`; if 'unknown', see `docs/ROLE_FORMATS.md` |
| Caller sees admin views | RLS not enabled or policy wrong | `select tablename, rowsecurity from pg_tables where schemaname='public';` — all should be true |
| Telegram bot stops responding | Webhook expired | Re-set webhook: `curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d url=https://YOUR-VERCEL/api/telegram/webhook` |

## Cost ceilings (for reference)

| Service | Tier | Likely monthly |
|---|---|---|
| Supabase | Free → Pro $25 | $0 until 500MB / 2GB egress, then $25 |
| Vercel | Free → Pro $20 | $0 until 100GB bandwidth |
| n8n.cloud | Free → Starter $24 | $0 until 5k executions |
| Twilio | Pay-as-you-go | $0.013/min outbound + $1/mo number |
| Brave Search | Free | $0 (1 qps limit) |
| Google Places | Pay-as-you-go | ~$17 per 1k Text Search calls — same as v1 |
