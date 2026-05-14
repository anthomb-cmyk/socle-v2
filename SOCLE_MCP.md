# Socle CRM MCP

Local MCP server for Codex and Claude. It gives agents an allowlisted way to inspect Socle CRM, generate authenticated app links, and run explicit confirmed actions without getting stuck at the login screen.

## What It Can Do

- Check Supabase connectivity with `socle_health`.
- Generate a one-time Socle login URL with `create_login_link`.
- Read dashboard state with `get_dashboard_state`.
- Read Textos conversations with `list_textos` and `get_texto_thread`.
- Read pipeline deals with `list_deals` and `get_deal`.
- Optional writes, only when `SOCLE_MCP_ALLOW_WRITES=true` and the tool input includes `confirm: "write to socle"`:
  - `seed_test_sms`
  - `update_deal_stage`
  - `add_deal_note`
  - `resolve_review_item` for defer/reject

There is no raw SQL tool. This is intentional: agents get useful platform access without unrestricted database mutation.

## Setup

1. Install web dependencies if needed:

```bash
cd "/Users/anthonymakeen/Documents/New project/socle-v2/web"
npm install
```

2. Make sure `web/.env.local` has:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

3. Add MCP client env:

```bash
SOCLE_APP_BASE_URL=https://socle-v2-production.up.railway.app
SOCLE_MCP_AUTH_EMAIL=your-socle-login-email@example.com
SOCLE_MCP_ALLOW_WRITES=false
```

Use `SOCLE_MCP_ALLOW_WRITES=true` only when you want agents to run confirmed write actions.

## Claude Code

Claude Code can use the repo-level config format. Copy `.mcp.example.json` to `.mcp.json` and change `SOCLE_MCP_AUTH_EMAIL`.

The local `.mcp.json` is intentionally ignored by git so your real email/env stays local.

## Claude Desktop

Merge `mcp/claude_desktop_config.example.json` into:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Then restart Claude Desktop.

## Using It

Good first calls:

```text
socle_health
create_login_link { "path": "/textos" }
get_dashboard_state
list_textos { "limit": 20 }
list_deals { "stage": "analyse", "limit": 20 }
```

For UI testing, open the `loginUrl` returned by `create_login_link`. It signs the browser into Socle via Supabase and redirects to the requested page, for example `/textos`.

Treat generated login URLs as sensitive. They are short-lived but should not be pasted into public docs or commits.
