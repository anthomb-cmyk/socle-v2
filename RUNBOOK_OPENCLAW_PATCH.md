# RUNBOOK_OPENCLAW_PATCH.md

> **Status**: Verified 2026-04-30. Replaces Google Drive draft. Append to RUNBOOK.md when OpenClaw is active.

## OpenClaw operations

### Start the gateway
```bash
openclaw gateway --port 18789
```
Dashboard: http://127.0.0.1:18789

### Expose via tunnel (required for n8n.cloud)
```bash
# Option A — Cloudflare (no account needed for temporary URL)
cloudflared tunnel --url http://localhost:18789

# Option B — ngrok
ngrok http 18789
```
Save the tunnel URL → set as `OPENCLAW_TUNNEL_URL` in n8n credential store.

### Test the gateway manually
```bash
curl -X POST http://localhost:18789/api/sessions/main/messages \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, are you there?"}'
```
Expected: 200 + the agent queues a response (response arrives async in configured channel).

### Check gateway status
```bash
openclaw status
# or via HTTP:
curl http://localhost:18789/api/status
```

### Stuck enrichment jobs (OpenClaw-related)
If an enrichment job is `running` for > 60 min and was triggered via OpenClaw:
1. Go to `/admin/enrichment` → find the stuck job
2. Check OpenClaw dashboard at http://127.0.0.1:18789 for the session
3. If agent is stuck: restart gateway (`openclaw gateway --port 18789`)
4. Then use `/admin/enrichment` → Retry button to re-trigger

### Gateway token rotation
1. Update `~/.openclaw/openclaw.json` → `gateway.token`
2. Update `OPENCLAW_GATEWAY_TOKEN` in n8n credential store
3. Restart gateway

## What does NOT exist (do not build against these)

- `POST /research/owner` — **does not exist**
- Any named research endpoint — OpenClaw only accepts freeform text prompts
- Synchronous response — the agent processes async; results arrive via callback or channel
