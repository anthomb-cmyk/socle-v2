# Phone Enrichment Redesign — Master Execution Plan

**Audience:** AI agent orchestrating the rebuild. Optimized for autonomous execution with minimal user interruption. **User involvement points:** ONLY at Phase 10 (backtest decision) and Phase 11 (cutover go/no-go). Everything else is automatic.

## How an agent uses this document

1. Read sections "Locked decisions," "Agent protocol," and "Architecture" first.
2. Look at web/data/redesign_state.json (if exists) to find current phase.
3. Execute the next phase in dependency order.
4. After each phase: run the verify-done command, update state file, commit, push, report to user.
5. Move to the next phase WITHOUT WAITING. Only halt at user-decision-gates marked USER GATE.
6. If a phase fails its verify-done check 3 times in a row: write web/data/redesign_blockers.md with the failure details and stop.

## Locked decisions (do not re-ask)

| Decision | Value | Source |
| :-: | :-: | :-: |
| REQ file | telechargments---jeudonnes--entreprise.csv (find via `find ~ -name '*entreprise*.csv' -type f 2>/dev/null` on first use) | User confirmed |
| REQ format | CSV | User confirmed |
| Twilio account | User has activated. Env vars TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN will be on Railway. If not, agent halts at first Twilio call with clear error. | User confirmed |
| Wave 1 import | DO NOT IMPORT during the rebuild. User will import after Phase 11 cutover. | User confirmed |
| Geocoding service | Google Geocoding API. Env var GOOGLE_GEOCODING_API_KEY. ~$5 per 1000 lookups, no rate limit. | User confirmed |
| Geocode match radius | 75 meters | Default |
| Aggregator threshold | 10 unlinked entities at one geocode | Default |
| Twilio cache TTL | 30 days | User confirmed |
| Twilio caller-name pricing | $0.04 per lookup with name; $0.005 line-type only. Use name lookup. | Locked |
| Manual ground-truth labels | Hybrid: agent labels what it can from existing data; user spot-checks 10-20 high-stakes leads via a /admin/backtest-review page (built in Phase 0). | User confirmed |
| Existing briefings | All 240+ existing briefings re-generated with new template during Phase 8 | User confirmed |
| Branch strategy | Commit directly to main, push at end of each phase | User confirmed |
| Old pipeline retention | Keep pipeline-legacy.ts for 30 days post-cutover, then remove in a follow-up commit | User confirmed |
| Progress reports | Brief summary after every phase. Deep update only at user gates. | User confirmed |
| Daily monitoring during cutover week | /admin/cutover-status page in the app | Default |
| Backtest decision threshold | New system wrong-rate ≤ old AND found-rate within 5pp of old. If both met → cut over. If not → user decides. | Default |
| Code style | Match existing repo: 2-space indent, double quotes, named exports, vitest tests | Existing |
| Migrations | Apply via Supabase MCP apply_migration tool. Check into supabase/migrations/. | Existing |
| Compliance | OUT OF SCOPE. Do not add Loi 25 or DNCL/LNNTE work. User has explicitly de-scoped. | User confirmed |

NOTE: Branch strategy override — user has placed us on branch `claude/execute-redesign-plan-GkXWo`. Commit/push to that branch instead of main.

## Architecture (final, locked)

### Data model — six new tables, plus existing CRM tables

The new tables sit alongside existing leads, contacts, phones, properties. The new architecture WRITES to new tables; a bridge in Phase 9 publishes from new tables → existing CRM tables so callers keep working.

**raw_property** — immutable. One row per property per ingest. Keyed by (matricule, source_file_hash). Verbatim copy of the rôle row. Provenance floor.

**canonical_owner** — the deduped owner. owner_id is stable across files. Carries normalized name, owner_type (individual / numbered_co / named_co / trust / government), Quebec NEQ if known, mailing-address fingerprint, dedupe_status (auto / human_confirmed / pending_review).

**owner_alias** — every spelling variant seen for a canonical owner. New files merge through this table.

**evidence** — every fact fetched, one row per fetch. Immutable. Source name, URL or query, fetched_at, raw response (jsonb), structured extraction.

**hypothesis** — proposed contact fact with status candidate / accepted / rejected / superseded. Points to supporting evidence. Tracks tier (A-E).

**owner_record** — published snapshot to CRM. Keyed by (owner_id, snapshot_hash). Immutable. The thing the bridge publishes.

### Two-pipeline routing

Owner enters research
│
├─ Owner type = company / numbered_co?
│     → Pipeline A (REQ identity → website → directory → Twilio)
│
└─ Owner type = individual?
       │
       ├─ REQ has name-linked entity at mailing geocode?
       │     → Pipeline A (treat matched entity as research target)
       │
       ├─ REQ has >10 unlinked entities at mailing geocode (aggregator)?
       │     → Pipeline B + flag mailing as professional aggregator
       │
       └─ Otherwise:
              → Pipeline B (reverse-address + name+postal directory + Twilio opportunistic)

### Confidence tiers

| Tier | Definition | CRM label |
| :-: | :-: | :-: |
| A | 2+ independent sources, ≥1 authoritative (REQ, gov, name+postal directory match) | confirmed |
| B | 1 authoritative source, no corroboration | likely |
| C | Name+postal directory match only, no other corroboration | connected |
| D | Connected number — director/spouse/lawyer/accountant of the actual owner | connected |
| E | Single source no postal corroboration, OR evidence >12 months old | weak |

Pipeline A releases at A or B (one strong source ok because the call expectation is "reaches the entity's office"). Pipeline B requires A only (two-source rule because the call expectation is "owner's direct line").

### Refresh cadence

- confirmed → re-research after 180 days
- likely → re-research after 180 days
- connected → re-research after 90 days
- weak / no record → re-research after 30 days
- Wrong-number disposition from caller → immediate re-research, exclude the rejected source

## Agent protocol

### State file: web/data/redesign_state.json

```json
{
  "current_phase": 0,
  "current_phase_name": "Foundation & backtest harness",
  "phases_completed": [],
  "last_phase_completed_at": null,
  "blockers": [],
  "user_gates_pending": [],
  "schema_version": "v0",
  "git_commit_at_phase_start": "abc123",
  "stats": {
    "leads_total_at_phase_0": 0,
    "rebuild_started_at": null
  }
}
```

### After each phase, the agent:

1. Runs the phase's verify-done command. If fails, retry up to 3 times. If still failing, append to redesign_blockers.md and halt.
2. Updates redesign_state.json to mark phase complete.
3. Runs typecheck + lint + relevant tests: `cd web && npm run typecheck && npm run lint && npx vitest run`
4. Commits with message: `feat(redesign): Phase N — <phase name> complete`
5. Pushes.
6. Posts a brief report.
7. Begins next phase WITHOUT pausing.

### When to halt and ask user

- **PHASE 10 GATE:** After backtest, if metrics don't pass thresholds.
- **PHASE 11 GATE:** Pre-cutover go/no-go.

## PHASE 0 — Foundation & backtest harness

### 0.1 Initialize state file
File: web/data/redesign_state.json. Set rebuild_started_at to now, git_commit_at_phase_start to current HEAD.

### 0.2 Snapshot existing leads as ground truth
File: web/scripts/snapshot-ground-truth.ts. Reads leads joined with contacts, properties, phones, phone_candidates. Filters out test imports (file_name LIKE 'socle_phone_enrichment%' and 'StHyacinthe_test50%'). Writes web/data/ground_truth_v0.json. Verify ≥200 entries.

### 0.3 Build backtest harness
Files: web/lib/backtest/runner.ts, web/lib/backtest/__tests__/runner.spec.ts, web/lib/backtest/types.ts. Function runBacktest(snapshot, pipeline). Shadow mode (read-only client). Produces BacktestReport with leads_evaluated, released_count, released_correct, released_wrong, held_correctly, held_when_should_release, by_pipeline_a/b breakdown. 8+ tests including: deterministic output; refuses pipelines that try to write; correct metric calculation.

### 0.4 Build /admin/backtest-review page
Files: web/app/admin/backtest-review/page.tsx, web/app/api/backtest-review/route.ts. Lists 30 stratified leads. Save labels to web/data/ground_truth_labels_v0.json. Admin-only.

### Phase 0 verify-done
```
test -f web/data/ground_truth_v0.json && \
test -f web/data/redesign_state.json && \
cd web && npx vitest run lib/backtest && \
echo "Phase 0 done"
```

## PHASE 1 — New schema migration

### 1.1 Schema migration
File: supabase/migrations/0023_canonical_owner_schema.sql. Tables: raw_property, canonical_owner, owner_alias, evidence, hypothesis, owner_record, owner_refresh_schedule, phone_call_outcome. RLS enabled with admin_all policy. (Full SQL in original plan; uses postgis geography(Point,4326) and standard indexes.)

### 1.2 Generate types
Regenerate web/lib/database.types.ts.

### 1.3 Table-access wrappers
File: web/lib/research/db.ts.

### Verify done
```
psql "$DATABASE_URL" -c "select count(*) from canonical_owner" && \
psql "$DATABASE_URL" -c "select count(*) from evidence" && \
cd web && npm run typecheck && \
echo "Phase 1 done"
```

## PHASE 2 — REQ snapshot ingest

### 2.1 REQ tables
File: supabase/migrations/0024_req_snapshot.sql. Tables: req_entities (neq pk), req_directors, req_snapshot_meta. RLS admin_all.

### 2.2 Ingest script
File: web/scripts/ingest-req.ts (+ tests). Find file via `find ~ -name '*entreprise*.csv' -type f 2>/dev/null | head -5`. Stream-parse CSV. Geocode via Google API (cache web/data/geocode_cache.json). Normalize names (strip diacritics, suffixes INC LTÉE LTEE LTD INCORPOREE ENR ENREGISTREE SENC SCS SOCIETE). Bulk insert in batches of 1000. Idempotent.

### 2.3 Lookup helpers
File: web/lib/req/lookup.ts. findEntitiesByGeocode, findEntitiesByName, findEntitiesByDirector, getDirectorsForEntity.

### Verify done
```
psql "$DATABASE_URL" -c "select count(*) from req_entities" | grep -v 0 && \
cd web && npx vitest run lib/req && \
echo "Phase 2 done"
```

## PHASE 3 — Canonical owner derivation

### 3.1 Dedupe module
File: web/lib/research/dedupe.ts. Stage 1 deterministic (name_normalized + postal). Stage 2 fuzzy (same name, geocode <500m → pending_review). Stage 3 long-tail. Companies match on NEQ first.

### 3.2 Backfill script
File: web/scripts/backfill-canonical-owners.ts. Iterate contacts, classify owner_type, normalize, geocode, postal_fsa, dedupe, insert. Insert owner_alias for original spelling. Insert raw_property rows. Idempotent.

### Verify done
```
psql "$DATABASE_URL" -c "select count(*) from canonical_owner" && \
psql "$DATABASE_URL" -c "select count(*) from owner_alias" && \
psql "$DATABASE_URL" -c "select count(*) from raw_property" && \
echo "Phase 3 done"
```

## PHASE 4 — Routing classifier

### 4.1
File: web/lib/research/classifier.ts. Function routeOwner(sb, ownerId): RoutingDecision { pipeline: 'A'|'B'; primaryTarget?; candidateTargets?; reqEnrichment?; isAggregator; reason }. Aggregator threshold = 10.

### Verify done
```
cd web && npx vitest run lib/research/classifier && echo "Phase 4 done"
```

## PHASE 5 — Pipeline A (Business researcher)

### 5.1 Twilio Lookup wrapper
Files: web/lib/twilio/lookup.ts, supabase/migrations/0025_twilio_lookup_log.sql. Cache 30 days.

### 5.2 REQ phone researcher
File: web/lib/research/researchers/req-phone.ts.

### 5.3 Company website researcher
File: web/lib/research/researchers/company-website.ts. Brave search "${entity.legal_name} Quebec contact OR site:.ca". Top 3 results, regex phones.

### 5.4 Pages Jaunes business researcher
File: web/lib/research/researchers/pages-jaunes-business.ts.

### 5.5 Orchestrator
File: web/lib/research/pipeline-a.ts. Tier assignment per spec.

### Verify done
```
cd web && npx vitest run lib/research/pipeline-a lib/twilio && echo "Phase 5 done"
```

## PHASE 6 — Pipeline B (Individual researcher)

### 6.1 Reverse address researcher
File: web/lib/research/researchers/reverse-address.ts.

### 6.2 Name + postal directory researcher
File: web/lib/research/researchers/name-postal-directory.ts.

### 6.3 Cross-property researcher
File: web/lib/research/researchers/cross-property.ts.

### 6.4 Orchestrator
File: web/lib/research/pipeline-b.ts. Pipeline B requires Tier A.

### Verify done
```
cd web && npx vitest run lib/research/pipeline-b && echo "Phase 6 done"
```

After Phase 6: report ratio of A vs B in ground truth. Halt if 100% one side.

## PHASE 7 — Hypothesis scoring & owner record assembly

### 7.1 Scoring
Files: web/lib/research/scorer.ts, web/lib/research/source-independence.json. independent_pairs: [req_phone,twilio_caller_name], [req_phone,company_website], [req_phone,pages_jaunes_business], [company_website,twilio_caller_name], [pages_jaunes_business,twilio_caller_name], [canada411_personal,pages_jaunes_personal], [canada411_personal,twilio_caller_name]. sibling_groups: [pagesjaunes.ca,411.ca,canada411.ca].

### 7.2 Record assembler
File: web/lib/research/record-assembler.ts.

### 7.3 What's interesting rules
File: web/lib/research/whats-interesting.ts.

### Verify done
```
cd web && npx vitest run lib/research/scorer lib/research/whats-interesting && echo "Phase 7 done"
```

## PHASE 8 — Briefing generation

### 8.1 Templates
File: web/lib/llm/briefing.ts. Pipeline A/B templates per spec.

### 8.2 Haiku phrasing pass
French if Francophone name, else English. No new facts, no omissions.

### 8.3 Re-generate existing briefings
File: web/scripts/regenerate-briefings.ts. Iterate leads with briefing_text, rebuild via new template. Idempotent.

### Verify done
```
cd web && npx vitest run lib/llm/briefing && echo "Phase 8 done"
```

## PHASE 9 — CRM publish bridge

### 9.1 Bridge module
File: web/lib/research/crm-bridge.ts. confirmed/likely → ready_to_call; connected → needs_phone_review; weak → unresolved_after_research. Insert/update phones row.

### 9.2 Publish endpoint
File: web/app/api/research/publish/route.ts. Idempotent via snapshot_hash.

### Verify done
```
cd web && npx vitest run lib/research/crm-bridge && echo "Phase 9 done"
```

## PHASE 10 — USER GATE: Backtest

### 10.1 Run backtest
`cd web && npx tsx scripts/run-backtest.ts --snapshot data/ground_truth_v0.json --pipeline new --output data/backtest_report_v1.md`

### 10.2 User spot-checks
User opens /admin/backtest-review.

### 10.3 Compute decision
`cd web && npx tsx scripts/compute-backtest-decision.ts --report data/backtest_report_v1.md --labels data/ground_truth_labels_v0.json --output data/backtest_decision_v1.md`

Decision: New wrong-rate ≤ old AND found-rate within 5pp → AUTO-PROCEED. Else HALT, user decides.

## PHASE 11 — USER GATE: Cutover

### 11.1 Smoke test end-to-end.

### 11.2 Cutover
Modify web/lib/enrichment/pipeline.ts to call new module. Move old to pipeline-legacy.ts.

### 11.3 /admin/cutover-status page

### 11.4 Disable OpenClaw infra
`railway variables --remove OPENCLAW_WEBHOOK_URL --service socle-v2`. Comment out OpenClaw imports.

USER GATE: confirm before switching authoritative writes.
