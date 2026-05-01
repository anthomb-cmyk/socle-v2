# DEPLOY.md — Socle V2 Deployment

> **Status: LIVE on Railway as of 2026-04-30.**
> Production URL: `https://socle-v2-production.up.railway.app`
> All post-deploy steps completed. Both alpha loops confirmed.

---

## Railway deployment — LIVE ✅

### Why Railway instead of Vercel
Railway was chosen for simpler port binding (`$PORT`), no cold starts, and built-in nixpacks builder. The Vercel instructions below are superseded and kept for reference only.

### Railway settings

| Setting | Value |
|---|---|
| **Root Directory** | `web` |
| **Build Command** | *(leave blank — `railway.json` overrides to `npm run build` only)* |
| **Start Command** | *(leave blank — `railway.json` sets `next start -p $PORT`)* |

**Important**: `web/railway.json` sets `buildCommand: "npm run build"` — do NOT override in the Railway UI. Using `npm ci && npm run build` causes an EBUSY error because nixpacks mounts `/app/node_modules/.cache` as a Docker cache volume in build step 8, and `npm ci` tries to rmdir it while it is locked.

`web/.node-version` contains `22` — this forces nixpacks to use Node 22. `package.json` has `"engines": { "node": ">=22.0.0" }` for belt-and-suspenders.

### Required environment variables (all confirmed set)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mkgkrfcfhtrlecfuzroz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never expose to client. |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_ANTHONY_CHAT_ID` | `8613064895` |
| `N8N_SHARED_KEY` | `05dfee4b2ad40915ac06f734877df491de07a85b0d07002a696d129b0660118d` |
| `NEXT_PUBLIC_APP_URL` | `https://socle-v2-production.up.railway.app` |
| `TELEGRAM_WEBHOOK_SECRET` | Set when registering Telegram webhook |
| `N8N_ENRICHMENT_WEBHOOK_URL` | Leave blank until W7 is built |

### Why `$PORT` matters
Railway assigns a random port at runtime via `$PORT`. `package.json`'s `start` script hardcodes `-p 8985` for local dev. `railway.json` overrides this with `next start -p $PORT` so Railway's health check can reach the app.

### Post-deploy steps — ALL COMPLETE ✅

| Step | Status |
|---|---|
| Supabase Auth → Site URL = `https://socle-v2-production.up.railway.app` | ✅ Done |
| Supabase Auth → Redirect URLs include Railway + localhost:8985 | ✅ Done |
| n8n W1a (`2gZp3dbXCZPU3NV6`) CRM nodes → Railway URLs | ✅ Done (published activeVersionId `dba063d4`) |
| `NEXT_PUBLIC_APP_URL` set in Railway | ✅ Done |
| `TELEGRAM_ANTHONY_CHAT_ID` set in Railway | ✅ Done |

### Remaining manual steps (not blocking, not yet done)

| Step | Notes |
|---|---|
| Register Telegram webhook | `curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -d '{"url":"https://socle-v2-production.up.railway.app/api/telegram/webhook","secret_token":"<WEBHOOK_SECRET>"}'` |
| Attach Gmail OAuth2 to W1a | Gmail trigger + `Create Draft - Ask for Details` + `Create Draft - Acknowledge Numbers` in n8n UI |
| Attach OpenAI credential to W1a | `AI Email Classifier` node in n8n UI |
| Create W1a-biz | Duplicate W1a in n8n UI, swap Gmail credential to `anthony@socleacquisitions.com` |

### Smoke test

```bash
curl https://socle-v2-production.up.railway.app/api/health
# Expected: {"ok":true,"schemaApplied":true,...}
```

Then open `https://socle-v2-production.up.railway.app/admin/test` — all critical checks green.

---

## Alpha loop status (confirmed 2026-04-30)

### Alpha Proof A — Hot seller loop ✅ CONFIRMED ON RAILWAY
Evidence: `automation_events` row at 2026-04-30 23:52:35 UTC — `event_type: lead_submission_created`, `source: web_app`, `telegram_message_id: "43"`, `error_message: null`.

Flow confirmed: caller submits hot seller on Railway → `call_log` created → `lead_submission` created → `review_item` created → Telegram alert fires → `automation_event` logged with `telegram_message_id`.

### Alpha Proof B — Email-to-CRM loop ✅ CRM SIDE CONFIRMED / Gmail trigger pending credentials
Evidence: `automation_events` rows `lead_upserted_from_email` from n8n at 23:26:34 UTC. W1a active, all 3 CRM HTTP nodes → Railway, no ngrok.

Pending for full end-to-end: Anthony attaches Gmail OAuth2 + OpenAI credentials to W1a in n8n UI, then sends a test email to `antho02mb@gmail.com`.

---

## Cost summary (Railway)

| Service | Tier | Monthly cost |
|---|---|---|
| Railway | Hobby | ~$5–10 (usage-based, small app) |
| Supabase | Free | $0 — sufficient for <500MB DB |
| n8n.cloud | Starter | ~$20 — already active |
| Telegram bot | Free | $0 |
| **Total** | | **~$25–30/month** |

---

## Superseded: Vercel instructions (kept for reference only)

The steps below were the original Vercel deployment plan. Railway is the active production platform. These steps are no longer needed.

### Pre-flight checklist (Vercel)

- [ ] **Telegram bot token valid** — `curl https://api.telegram.org/bot<TOKEN>/getMe` returns `{"ok":true}`.
- [ ] **TELEGRAM_ANTHONY_CHAT_ID known** — send `/start` to bot, call `GET /api/telegram/identify`.
- [ ] **All env vars ready** — see `web/.env.production.example`.

### Vercel import (superseded)

1. Go to [vercel.com/new](https://vercel.com/new) → import `socle-v2` repo
2. Root directory: `web/`
3. Set env vars (same list as Railway above)
4. Deploy

### Post-deploy Supabase auth redirect (Vercel)

1. Supabase → Authentication → URL Configuration
2. Add `https://<vercel-url>/auth/callback` to Redirect URLs

### n8n workflow update (Vercel — superseded)

Same as Railway: update W1a nodes `Notify CRM - Lead`, `Log Event - Triage A`, `Log Event - Triage B` to point at your Vercel URL instead of ngrok.

---

## What stays local (intentionally)

| Component | Why |
|---|---|
| OpenClaw gateway | Localhost-only by design; n8n W7 needs tunnel when built |
| Local dev server (port 8985) | Dev only — `npm run dev` |
