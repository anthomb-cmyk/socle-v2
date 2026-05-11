# Session Handoff — May 11, 2026

Picking up via Dispatch on phone. **Read this first** before exploring the repo.

---

## Project context (one-line)
Socle Acquisitions CRM — Next.js 15 + Supabase + Twilio. Quebec multi-residential acquisitions, cold-calling pipeline driven by REQ bulk export + enrichment researchers.

- Code: `/Users/anthonymakeen/Documents/New project/socle-v2/web`
- Production: `socle-v2-production.up.railway.app` (Railway, auto-deploys from `main`)
- DB: Supabase (project linked via Supabase MCP)

---

## What was just shipped (last commit on main)

1. **Twilio calling from the deal pipeline page** — `/pipeline/[id]` "Appeler" button now starts a real Twilio bridge call, just like `/calls/[leadId]`. New endpoint: `POST /api/deals/[id]/call`. Call history (recording + transcript + AI organize) shows below the activity log.
2. **Pipeline B preflight fix** — real bug was a double `routeOwner` call throwing silently. Fixed by passing `precomputedRouting` so the second call is skipped. Individual-owner enrichment runs should now actually enter researchers instead of exiting at `stageReached=none`.
3. **Enrichment status-sync safety net** — `web/lib/queue/worker.ts` now flips `lead.status` after the pipeline returns, even if the in-pipeline status writer fails. **86 stuck leads were backfilled** in the May 11 session: 24 → ready_to_call, 25 → needs_phone_review, 37 → unresolved_after_all_sources.
4. **REQ directors ingest** — code added in `web/scripts/ingest-req.ts` (`--directors-file=<path>` flag), but **not yet run** because `Administrateur.csv` wasn't on disk during the session.

---

## Open items (in priority order)

### 1. Run REQ directors ingest
Find `Administrateur.csv` in the Quebec REQ bulk export (likely `~/Téléchargements/Données Québec/` or wherever you extracted the zip). Then:
```bash
cd web && npx tsx scripts/ingest-req.ts --directors-file="/path/to/Administrateur.csv"
```
This populates `req_directors`, unblocking Pipeline B's stage-1 director-match. Without it, every Pipeline B run skips stage 1 silently.

### 2. Validate Pipeline B fix in production
Run after deploy:
```sql
-- Should drop toward 0 over the next few hours
SELECT COUNT(*) FROM enrichment_jobs
WHERE raw_output->>'stageReached' = 'none'
  AND created_at > NOW() - INTERVAL '6 hours';

-- Hypothesis counts for individuals — should start being non-zero
SELECT COUNT(*) FROM hypothesis h
JOIN canonical_owners co ON co.id = h.canonical_owner_id
WHERE co.owner_type = 'individual'
  AND h.created_at > NOW() - INTERVAL '6 hours';
```

### 3. Twilio recordings stuck in "Processing"
Some recordings are flagged Processing with duration `-1 sec` and never finish. Audit was inconclusive — looked like Twilio infrastructure. Open a Twilio support ticket if it recurs.

### 4. Deal-page call linkage (cosmetic)
Calls made from `/pipeline/[id]` have `lead_id = null` in `call_logs` — the deal id is in `raw->>'deal_id'`. The deal page's "Historique d'appels" reads from there, but those calls won't show up in any lead's call history. Decide later whether to backfill a deal→lead linkage.

---

## Audit baseline (May 11 snapshot)

| Metric | Value | Notes |
|---|---|---|
| REQ entities | 2,922,253 | Entreprise.csv ingested 2026-05-07 |
| Canonical owners | 455 | 124 company / 324 individual / 7 mixed |
| Phone candidates (openclaw auto_attached) | 477 | Pipeline A working |
| Leads in `ready_to_call` | 664 | Already > old system's 240 |
| Pipeline B candidates | 0 | **Should change after deploy** |
| `req_directors` rows | 0 | **Should change after running ingest** |
| Leads stuck `enrichment_running` | 0 | Was 86, backfilled |

---

## File map (don't re-grep these)

| Concern | File |
|---|---|
| Owner routing A vs B | `web/lib/research/classifier.ts` |
| Pipeline A orchestrator | `web/lib/research/pipeline-a.ts` |
| Pipeline B orchestrator | `web/lib/research/pipeline-b.ts` |
| Worker entry point | `web/lib/queue/worker.ts` |
| Main pipeline coordinator | `web/lib/enrichment/pipeline.ts` |
| REQ bulk ingest | `web/scripts/ingest-req.ts` |
| Twilio call start (lead) | `web/app/api/twilio/calls/start/route.ts` |
| Twilio call start (deal) | `web/app/api/deals/[id]/call/route.ts` |
| Recording webhook | `web/app/api/twilio/voice/recording/route.ts` |
| AI organize (per call) | `web/app/api/calls/[callLogId]/organize/route.ts` |
| Lead briefing | `web/app/api/leads/[id]/briefing/route.ts` |
| Whisper helpers | `web/lib/transcribe.ts` |
| Auth helpers | `web/lib/auth.ts` |

---

## Working preferences (so phone-Claude doesn't waste credits)

- Always delegate non-trivial coding to a **Sonnet subagent** — Opus only for orchestration.
- Read SKILL.md only when actually creating docs/sheets/slides — don't read pre-emptively.
- Never click web links from emails via computer-use — use Chrome MCP.
- Commits use single-quoted bracket paths to dodge zsh globbing: `git add "web/app/api/deals/[id]/call/route.ts"`.
- Don't push without TS clean (`cd web && npx tsc --noEmit`).
- French UI strings throughout — match the existing tone.
- Out of scope: Quebec Loi 25 and DNCL/LNNTE compliance (deliberately ignored).
