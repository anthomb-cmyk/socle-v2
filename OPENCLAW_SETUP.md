# OPENCLAW_SETUP.md

> **Status**: Verified 2026-04-30. Integration deferred until tunnel is configured.

## What OpenClaw actually is

OpenClaw is a self-hosted CLI gateway that connects messaging apps (WhatsApp, Telegram, Discord, iMessage) to an AI coding agent. It is **not** a research API with named endpoints for owner lookups.

- Install: `npm install -g openclaw@latest`
- Start: `openclaw gateway --port 18789`
- Dashboard: `http://127.0.0.1:18789/` (loopback only)
- Config: `~/.openclaw/openclaw.json`
- Auth: Bearer token set in config

## Verified HTTP interface (port 18789)

| Endpoint | Purpose |
|---|---|
| `POST /api/sessions/main/messages` | Send a prompt to the AI agent |
| `POST /set/headers` | Set browser headers (loopback only) |
| `POST /set/credentials` | Set browser credentials (loopback only) |
| `POST /set/geolocation` | Set browser geolocation (loopback only) |

**There is no `POST /research/owner` endpoint.** That was hypothetical and has been removed.

## Why n8n.cloud cannot call it directly

The gateway runs on `127.0.0.1:18789` on Anthony's Mac. n8n.cloud is a hosted SaaS — it cannot reach a loopback address. A tunnel is required before any n8n workflow can trigger OpenClaw.

## Setup required before integration

1. Install OpenClaw: `npm install -g openclaw@latest`
2. Run `openclaw onboard --install-daemon` (first time)
3. Start gateway: `openclaw gateway --port 18789`
4. Expose via tunnel:
   - `cloudflared tunnel --url http://localhost:18789` (free, no account needed for quick test)
   - OR `ngrok http 18789` (requires ngrok account)
5. Save the tunnel URL — this becomes the n8n call target
6. Set Bearer token in `~/.openclaw/openclaw.json` under `gateway.token`
7. Add the token to `.env.local` as `OPENCLAW_GATEWAY_TOKEN` (for future use)

## Integration pattern (once tunnel is live)

```
n8n → POST <tunnel_url>/api/sessions/main/messages
  body: { "text": "Research owner: <name>, address: <address>. Return: phone, email, website." }
  headers: { Authorization: "Bearer <token>" }

OpenClaw agent processes → calls web tools → posts result back to:
  POST https://<crm-url>/api/n8n/enrichment-result
  (OpenClaw tool use must be configured to do this callback)
```

All results land as `unverified` in `enrichment_results`. Anthony approves via `/leads/[id]`.

## Current status

- [ ] OpenClaw installed on Anthony's Mac → **unknown** (not verified in sandbox; must check on Mac terminal)
- [ ] Gateway running → **unknown**
- [ ] Tunnel configured → **not yet**
- [ ] Round-trip tested → **not yet**
