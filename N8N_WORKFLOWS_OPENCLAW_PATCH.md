# N8N_WORKFLOWS_OPENCLAW_PATCH.md

> **Status**: Spec only — do not build until tunnel is live and round-trip is verified.
> **Verified**: 2026-04-30. Replaces the Google Drive draft that assumed POST /research/owner.

## What changed from the original patch doc

The original draft assumed OpenClaw exposes a research-specific endpoint (`POST /research/owner`). **That endpoint does not exist.** OpenClaw's real API sends a freeform text message to an AI agent via `POST /api/sessions/main/messages`. The agent does the research using its tools (browser, web search) and must be instructed to post results back to the CRM.

## W7 workflow spec (build only after tunnel is verified)

**Trigger**: Webhook from CRM `POST /api/enrichment-jobs/[id]/webhook`
→ payload: `{ lead_id, job_id, job_type, contact_name, address, phones[] }`

**Node 1 — HTTP Request to OpenClaw gateway**
```
POST <OPENCLAW_TUNNEL_URL>/api/sessions/main/messages
Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>
{
  "text": "Research owner {{ contact_name }} at {{ address }}. Find: phone, email, company website. Post result to {{ CRM_URL }}/api/n8n/enrichment-result with job_id={{ job_id }} and lead_id={{ lead_id }}. Mark field_type as find_phone/find_email/find_website. Set source_url to the page you found it on."
}
```

**Node 2 — PATCH enrichment job to `running`**
```
PATCH {{ CRM_URL }}/api/enrichment-jobs/{{ job_id }}
Authorization: Bearer {{ N8N_SHARED_KEY }}
{ "status": "running" }
```

**Node 3 — n8n waits** (OpenClaw agent processes asynchronously; result arrives via callback)

**OpenClaw agent callback (configured in OpenClaw, not n8n)**:
```
POST {{ CRM_URL }}/api/n8n/enrichment-result
Authorization: Bearer {{ N8N_SHARED_KEY }}
{
  "lead_id": "...",
  "job_id": "...",
  "field_type": "find_phone",
  "value": "+1 514-555-1234",
  "source_url": "https://...",
  "raw_payload": { ... }
}
```

## Env vars required (n8n credentials)

| Var | Value |
|---|---|
| `OPENCLAW_TUNNEL_URL` | e.g. `https://abc123.trycloudflare.com` |
| `OPENCLAW_GATEWAY_TOKEN` | from `~/.openclaw/openclaw.json` → `gateway.token` |
| `N8N_SHARED_KEY` | already set in CRM `.env.local` |
| `CRM_URL` | ngrok or Vercel URL of the Next.js app |

## Prerequisite checklist (block on all of these before building W7)

- [ ] OpenClaw installed and running on Anthony's Mac
- [ ] Tunnel active and URL confirmed
- [ ] Manual round-trip test: curl to gateway → agent responds in Telegram/WhatsApp
- [ ] OpenClaw tool-use callback configured to POST to CRM `/api/n8n/enrichment-result`
- [ ] CRM publicly accessible (ngrok or Vercel)
- [ ] `N8N_SHARED_KEY` set in both `.env.local` and n8n credential store
