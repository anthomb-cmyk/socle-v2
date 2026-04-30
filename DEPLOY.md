# DEPLOY.md — Socle V2 Deployment Plan

> **Current target**: Railway (Next.js) + Supabase (already live) + n8n.cloud (already live)
> **Est. time**: ~30 min once Telegram token is valid

---

## Railway deployment (active path)

### Why Railway instead of Vercel
Railway was chosen over Vercel for this deployment. The instructions below supersede the Vercel steps further down this file.

### Railway settings (set these in the Railway UI)

| Setting | Value |
|---|---|
| **Root Directory** | `web` |
| **Build Command** | *(leave blank — nixpacks detects Next.js and runs `npm install && npm run build` automatically)* |
| **Start Command** | *(leave blank — `railway.json` sets `next start -p $PORT`)* |
| **Watch Paths** | *(leave blank)* |

`web/railway.json` is committed and handles the start command. Do not override it in the Railway UI or it will conflict.

### Required environment variables

Set all of these in Railway → Service → Variables before the first deploy:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mkgkrfcfhtrlecfuzroz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Supabase dashboard → Project Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase dashboard — server-only, never expose) |
| `TELEGRAM_BOT_TOKEN` | (from @BotFather) |
| `TELEGRAM_ANTHONY_CHAT_ID` | `8613064895` |
| `TELEGRAM_WEBHOOK_SECRET` | run `openssl rand -hex 32` and paste result |
| `N8N_SHARED_KEY` | `05dfee4b2ad40915ac06f734877df491de07a85b0d07002a696d129b0660118d` |
| `NEXT_PUBLIC_APP_URL` | set to Railway's generated URL after first deploy (e.g. `https://socle-v2-production.up.railway.app`) |
| `N8N_ENRICHMENT_WEBHOOK_URL` | *(leave blank — not needed until W7)* |

### Why `$PORT` matters
Railway assigns a random port at runtime via the `$PORT` env var. The `package.json` `start` script hardcodes `-p 8985` for local dev. `railway.json` overrides this with `next start -p $PORT` so Railway's health check can reach the app.

### Post-deploy steps
1. **Supabase auth redirect** — Supabase dashboard → Authentication → URL Configuration → add `https://<railway-url>/auth/callback` to Redirect URLs and set Site URL.
2. **Register Telegram webhook** — `curl -X POST https://<railway-url>/api/telegram/setup -H "Content-Type: application/json" -d '{"publicUrl":"https://<railway-url>"}'`
3. **Update n8n workflows** — change `https://legislate-onyx-crane.ngrok-free.app` → `https://<railway-url>` in workflow `2gZp3dbXCZPU3NV6` nodes: `Notify CRM - Lead`, `Log Event - Triage A`, `Log Event - Triage B`.
4. **Set `NEXT_PUBLIC_APP_URL`** — once Railway gives you a stable URL, add it as an env var and redeploy so hot-seller Telegram alerts include the correct CRM link.

### Smoke test after deploy
```bash
curl https://<railway-url>/api/health
```
Then open `https://<railway-url>/admin/test` — all critical checks should be green.

---

---

## Pre-flight checklist (do before Vercel import)

- [ ] **Telegram bot token valid** — `curl https://api.telegram.org/bot<TOKEN>/getMe` returns `{"ok":true}`. If not: @BotFather → `/mybots` → your bot → API Token → Revoke → copy new token.
- [ ] **TELEGRAM_ANTHONY_CHAT_ID known** — after fixing token: send `/start` to your bot, then call `GET /api/telegram/identify` locally. Copy the numeric id.
- [ ] **All env vars ready** — see `web/.env.production.example` for the full list.
- [ ] **Supabase Google OAuth redirect URL** — Supabase dashboard → Authentication → URL Configuration → add `https://<your-vercel-url>` to Redirect URLs (can do after Vercel gives you a URL).

---

## Step 1 — Push to GitHub (if not already)

```bash
cd "/Users/anthonymakeen/Documents/New project/socle-v2"
git add -A && git commit -m "chore: pre-deploy cleanup"
git push origin main
```

The repo root contains `supabase/` and `web/`. Vercel's root directory must be set to `web/`.

---

## Step 2 — Import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo (`socle-v2`)
3. **Framework Preset**: Next.js (auto-detected)
4. **Root Directory**: `web`
5. **Build Command**: `npm run build` (default)
6. **Install Command**: `npm install` (default)
7. Do **not** deploy yet — set env vars first (Step 3)

---

## Step 3 — Set environment variables in Vercel

In Vercel → Project Settings → Environment Variables, add:

| Variable | Value | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mkgkrfcfhtrlecfuzroz.supabase.co` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Supabase dashboard) | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase dashboard — keep server-only) | ✅ |
| `TELEGRAM_BOT_TOKEN` | (new token from @BotFather) | ✅ |
| `TELEGRAM_ANTHONY_CHAT_ID` | (numeric chat ID) | ✅ |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32` | ✅ |
| `N8N_SHARED_KEY` | `05dfee4b2ad40915ac06f734877df491de07a85b0d07002a696d129b0660118d` | ✅ |
| `N8N_ENRICHMENT_WEBHOOK_URL` | (leave blank or omit) | optional |

Then click **Deploy**.

---

## Step 4 — Post-deploy: Supabase auth redirect

1. Supabase dashboard → Authentication → URL Configuration
2. Add to **Redirect URLs**: `https://<your-vercel-url>/auth/callback`
3. Also add the `https://<your-vercel-url>` to **Site URL** if it's the primary domain.

---

## Step 5 — Register Telegram webhook

```bash
curl -X POST https://<your-vercel-url>/api/telegram/setup \
  -H "Content-Type: application/json" \
  -H "Cookie: <your admin session cookie>" \
  -d '{"publicUrl":"https://<your-vercel-url>"}'
```

Or from `/admin/test` → Verify each surface → navigate to the Telegram section in RUNBOOK.

---

## Step 6 — Update n8n workflow to stable URL

In n8n, update workflow `2gZp3dbXCZPU3NV6` — change the 3 HTTP Request nodes that currently point to `https://legislate-onyx-crane.ngrok-free.dev` to `https://<your-vercel-url>`:

- `Notify CRM - Lead` → url
- `Log Event - Triage A` → url
- `Log Event - Triage B` → url

This removes the ngrok dependency for daily use.

---

## Step 7 — Smoke test

```bash
# Health
curl https://<your-vercel-url>/api/health

# n8n lead endpoint (replace URL)
curl -X POST https://<your-vercel-url>/api/n8n/lead \
  -H "Authorization: Bearer 05dfee4b2ad40915ac06f734877df491de07a85b0d07002a696d129b0660118d" \
  -H "Content-Type: application/json" \
  -d '{"property":{"address":"Test deploy"},"contact":{"kind":"person","full_name":"Deploy Test","primary_email":"deploy@test.com"}}'
```

Then open `https://<your-vercel-url>/admin/test` — all critical checks should be green.

---

## What stays on ngrok / local (intentionally)

| Component | Why |
|---|---|
| OpenClaw gateway | Localhost-only by design; n8n W7 needs tunnel when built |
| Local dev server (port 8985) | Dev only — never put on ngrok for production |

---

## Cost summary (at Socle V2 scale)

| Service | Tier | Monthly cost |
|---|---|---|
| Vercel | Hobby (free) | $0 — sufficient for <100GB bandwidth |
| Supabase | Free | $0 — sufficient for <500MB DB |
| n8n.cloud | Starter | ~$20 — already active |
| Telegram bot | Free | $0 |
| **Total** | | **~$20/month** |

Upgrade Vercel to Pro ($20) only if you add team members who need deployment access or exceed bandwidth.
