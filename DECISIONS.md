# DECISIONS.md

Append-only log. Newest at top. One entry per decision.

---

## 2026-04-29 — Frontend stack: Next.js 15 + TypeScript + Tailwind v4 + shadcn/ui
- **Why**: Next.js 15 deploys instantly to Vercel. App Router + Server Actions = type-safe DB writes without separate API plumbing for the common case. Tailwind v4 + shadcn/ui = fast UI without a heavy component library. TS catches the schema-drift bugs that plagued v1.
- **Trade-off**: Steeper learning curve than vanilla React. Acceptable: I write the code, Anthony approves the product.
- **Reversible**: Yes — could pivot to Remix or vanilla CRA without losing data.

## 2026-04-29 — Auth: Supabase Google SSO, role via `app_metadata.role`
- **Why**: Anthony already authorizes Google for Calendar. Same identity = same login. `app_metadata` is server-only-mutable, so role can't be self-elevated by a malicious client.
- **Roles**: `admin` (Anthony), `caller` (Gaylord and future cold callers). RLS policies discriminate via `(auth.jwt() -> 'app_metadata' ->> 'role')`.
- **Reversible**: Yes — magic link is a one-line config flip.

## 2026-04-29 — Owners modeled as a relationship, not a table
- **Why**: A property can have many owners; a contact (person or company) can own many properties; the relationship has metadata (share %, owner vs co-owner vs broker). One M2M (`property_contacts`) with a `relationship` enum is cleaner than a separate `owners` table that would just be a renamed view of contacts.
- **Trade-off**: Querying "owners of property X" requires a join with `where relationship in ('owner','co_owner')`. Acceptable.

## 2026-04-29 — Phones are a first-class table, not a JSON column
- **Why**: Blueprint requires phone-level status (DNC, bad number, wrong person), source (file vs role vs Brave vs caller-verified), confidence. JSON columns can't be indexed or constrained well. Separate table = uniqueness, RLS on the phone, audit trail per phone.
- **E.164 normalization**: NANP-only for now (`+1XXXXXXXXXX`). Non-NANP rejected. `phones.e164` is the canonical key.

## 2026-04-29 — XLSX parsing: SheetJS server-side in Next.js API route
- **Why**: Parser must run server-side so the user can't tamper with the parsed result. n8n is for orchestration of recurring/scheduled work, not interactive request/response. SheetJS handles all four Quebec rôle formats (A/B/C/D) in <100ms for typical files.
- **Trade-off**: Larger Vercel function payload. Acceptable up to ~10 MB files; bigger files use Supabase Storage upload + Edge Function fan-out (Phase 2).

## 2026-04-29 — City normalization in DB function + TS lib (mirror)
- **Why**: Two callers (import API + Telegram search) need the same normalization. A Postgres function (`normalize_city(text)`) called from migrations + a TS module re-exporting the same map keeps both in sync. Tests assert parity.

## 2026-04-29 — Phone enrichment chain: Brave → Google Places → Pages Jaunes (drop B2BHint)
- **Why**: B2BHint is paid and weak for Quebec residential owners. Pages Jaunes is free and Quebec-native. Brave is free tier (1qps) for first-pass; Places handles entities with locations; PJ handles personal listings.
- **Reversible**: Add B2BHint back as a fallback if PJ misses cases.

## 2026-04-29 — Outreach channel for v1-of-v2: voice only, no SMS
- **Why**: Quebec Law 25 makes SMS outreach require explicit consent tracking. Voice is the existing flow. Add SMS in Phase 3 with proper consent UI.

## 2026-04-29 — n8n hosting: n8n.cloud, not self-hosted
- **Why**: One less infra component to babysit. Free tier covers our volume (~hundreds of executions/month). Switch to self-hosted on Railway only if cost becomes an issue or we need custom node code.

## 2026-04-29 — Migration strategy: v2 in new repo, v1 stays live until parity
- **Why**: Two real users have real deals. Zero-downtime migration. v2 ships at its own pace.

## 2026-04-29 — No ORM. Use `supabase-js` + zod for validation
- **Why**: ORMs (Prisma, Drizzle) duplicate Supabase's auto-generated types. `supabase-js` plus `supabase gen types` produces typed clients for free. Zod handles input validation at API boundaries.

## 2026-04-29 — Background work: Supabase Edge Functions for now
- **Why**: For phone enrichment fan-out and bulk import processing, Edge Functions run close to the DB and are free at our scale. n8n handles user-triggered orchestration; Edge Functions handle CPU-bound batch work.
- **Reversible**: Pull into a dedicated worker (e.g. Trigger.dev) if Edge Function timeouts bite.
