# Phone Enrichment Redesign — Master Execution Plan

**Audience:** AI agent orchestrating the rebuild. Optimized for autonomous execution with minimal user interruption.
**User involvement points:** ONLY at Phase 10 (backtest decision) and Phase 11 (cutover go/no-go). Everything else is automatic.

---

## How an agent uses this document

1. Read sections "Locked decisions," "Agent protocol," and "Architecture" first.
2. Look at `web/data/redesign_state.json` (if exists) to find current phase.
3. Execute the next phase in dependency order.
4. After each phase: run the verify-done command, update state file, commit, push, report to user.
5. Move to the next phase WITHOUT WAITING. Only halt at user-decision-gates marked 🛑 USER GATE.
6. If a phase fails its verify-done check 3 times in a row: write `web/data/redesign_blockers.md` with the failure details and stop.

---

## Locked decisions (do not re-ask)

| Decision | Value | Source |
|---|---|---|
| REQ file | `telechargments---jeudonnes--entreprise.csv` (find via `find ~ -name '*entreprise*.csv' -type f 2>/dev/null` on first use) | User confirmed |
| REQ format | CSV | User confirmed |
| Twilio account | User has activated. Env vars `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` will be on Railway. If not, agent halts at first Twilio call with clear error. | User confirmed |
| Wave 1 import | DO NOT IMPORT during the rebuild. User will import after Phase 11 cutover. | User confirmed |
| Geocoding service | Google Geocoding API. Env var `GOOGLE_GEOCODING_API_KEY`. ~$5 per 1000 lookups, no rate limit. | User confirmed |
| Geocode match radius | 75 meters | Default |
| Aggregator threshold | 10 unlinked entities at one geocode | Default |
| Twilio cache TTL | 30 days | User confirmed |
| Twilio caller-name pricing | $0.04 per lookup with name; $0.005 line-type only. Use name lookup. | Locked |
| Manual ground-truth labels | Hybrid: agent labels what it can from existing data; user spot-checks 10-20 high-stakes leads via a /admin/backtest-review page (built in Phase 0). | User confirmed |
| Existing briefings | All 240+ existing briefings re-generated with new template during Phase 8 | User confirmed |
| Branch strategy | Commit directly to main, push at end of each phase | User confirmed |
| Old pipeline retention | Keep `pipeline-legacy.ts` for 30 days post-cutover, then remove in a follow-up commit | User confirmed |
| Progress reports | Brief summary after every phase. Deep update only at user gates. | User confirmed |
| Daily monitoring during cutover week | `/admin/cutover-status` page in the app | Default |
| Backtest decision threshold | New system wrong-rate ≤ old AND found-rate within 5pp of old. If both met → cut over. If not → user decides. | Default |
| Code style | Match existing repo: 2-space indent, double quotes, named exports, vitest tests | Existing |
| Migrations | Apply via Supabase MCP `apply_migration` tool. Check into `supabase/migrations/`. | Existing |
| Compliance | OUT OF SCOPE. Do not add Loi 25 or DNCL/LNNTE work. User has explicitly de-scoped. | User confirmed |

---

## Architecture (final, locked)

### Data model — six new tables, plus existing CRM tables

The new tables sit alongside existing `leads`, `contacts`, `phones`, `properties`. The new architecture WRITES to new tables; a bridge in Phase 9 publishes from new tables → existing CRM tables so callers keep working.

**`raw_property`** — immutable. One row per property per ingest. Keyed by `(matricule, source_file_hash)`. Verbatim copy of the rôle row. Provenance floor.

**`canonical_owner`** — the deduped owner. `owner_id` is stable across files. Carries normalized name, owner_type (`individual` / `numbered_co` / `named_co` / `trust` / `government`), Quebec NEQ if known, mailing-address fingerprint, dedupe_status (`auto` / `human_confirmed` / `pending_review`).

**`owner_alias`** — every spelling variant seen for a canonical owner. New files merge through this table.

**`evidence`** — every fact fetched, one row per fetch. Immutable. Source name, URL or query, fetched_at, raw response (jsonb), structured extraction.

**`hypothesis`** — proposed contact fact with status `candidate` / `accepted` / `rejected` / `superseded`. Points to supporting evidence. Tracks tier (A-E).

**`owner_record`** — published snapshot to CRM. Keyed by `(owner_id, snapshot_hash)`. Immutable. The thing the bridge publishes.

### Two-pipeline routing (preserved from our work)

```
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
```

### Confidence tiers (from peer review)

| Tier | Definition | CRM label |
|---|---|---|
| A | 2+ independent sources, ≥1 authoritative (REQ, gov, name+postal directory match) | `confirmed` |
| B | 1 authoritative source, no corroboration | `likely` |
| C | Name+postal directory match only, no other corroboration | `connected` |
| D | Connected number — director/spouse/lawyer/accountant of the actual owner | `connected` |
| E | Single source no postal corroboration, OR evidence >12 months old | `weak` |

Pipeline A releases at A or B (one strong source ok because the call expectation is "reaches the entity's office"). Pipeline B requires A only (two-source rule because the call expectation is "owner's direct line").

### Refresh cadence

- `confirmed` → re-research after 180 days
- `likely` → re-research after 180 days
- `connected` → re-research after 90 days
- `weak` / no record → re-research after 30 days
- Wrong-number disposition from caller → immediate re-research, exclude the rejected source

---

## Agent protocol

### State file: `web/data/redesign_state.json`

Created in Phase 0. Updated after every phase.

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

1. Runs the phase's verify-done command. If fails, retry up to 3 times. If still failing, append to `redesign_blockers.md` and halt.
2. Updates `redesign_state.json` to mark phase complete.
3. Runs typecheck + lint + relevant tests:
   ```
   cd web && npm run typecheck && npm run lint && npx vitest run
   ```
4. Commits with message: `feat(redesign): Phase N — <phase name> complete`
5. Pushes to main.
6. Posts a brief report (template at end of this doc).
7. Begins next phase WITHOUT pausing.

### When to halt and ask user

ONLY at these two gates:

- **🛑 PHASE 10 GATE:** After backtest, if metrics don't pass thresholds. Agent presents data, user decides cut-over vs. tune-and-retry.
- **🛑 PHASE 11 GATE:** Pre-cutover go/no-go. Agent confirms "ready to switch authoritative writes," user says go.

Anything else: agent decides using locked decisions or sensible defaults. Document the decision in the commit message.

### If stuck (3 retry failures on a phase)

- Write `web/data/redesign_blockers.md` with: phase number, failure details, last 50 lines of relevant logs, what was tried, what's needed from user.
- Halt. Wait for user.

---

## PHASE 0 — Foundation & backtest harness

**Goal:** Establish ground truth and the harness to compare new vs. old before any architectural change.

**Inputs:** Existing production database with current leads.

**Outputs:**
- `web/data/ground_truth_v0.json` — snapshot of current production leads
- `web/data/redesign_state.json` — initialized state file
- Backtest harness module + tests
- `/admin/backtest-review` page for user spot-checks

### 0.1 — Initialize state file

**Files:** Create `web/data/redesign_state.json` with the structure above. Set `rebuild_started_at` to now, `git_commit_at_phase_start` to current HEAD.

**Verify done:** File exists and is valid JSON.

### 0.2 — Snapshot existing leads as ground truth

**Files create:**
- `web/scripts/snapshot-ground-truth.ts`

**Behavior:**
- Reads `leads` joined with `contacts`, `properties`, `phones`, `phone_candidates`
- Filters: leads NOT from test imports (exclude file_name LIKE `socle_phone_enrichment%` and `StHyacinthe_test50%`)
- Includes: lead_id, contact_id, owner full_name, company_name, mailing fields, property fields, current_phone (if any), candidate phone count, current status, current disposition
- Writes to `web/data/ground_truth_v0.json` with timestamp
- Exits 0 with row count printed

**Agent prompt (paste to Sonnet):**
> Build `web/scripts/snapshot-ground-truth.ts` that exports current production lead state to `web/data/ground_truth_v0.json`. Use Supabase admin client at `web/lib/supabase-server.ts`. Schema described in REDESIGN_PLAN.md §0.2. Filter out leads from test imports. Run the script after building it; confirm it prints a row count > 200.

**Verify done:** `web/data/ground_truth_v0.json` exists and contains ≥200 entries.

### 0.3 — Build backtest harness

**Files create:**
- `web/lib/backtest/runner.ts`
- `web/lib/backtest/__tests__/runner.spec.ts`
- `web/lib/backtest/types.ts`

**Behavior:**
- Function `runBacktest(snapshot, pipeline)` runs a pipeline implementation against snapshot leads in shadow mode
- Pipeline must NEVER write to production tables (raw_property, canonical_owner, etc. are ok; phones/leads/phone_candidates/enrichment_events are forbidden)
- Produces `BacktestReport` with: leads_evaluated, released_count, released_correct (vs. existing ready_to_call), released_wrong (vs. existing — newly attached phone differs from production), held_correctly, held_when_should_release, by_pipeline_a/b breakdown
- Outputs markdown summary

**Agent prompt:**
> Build the backtest harness at `web/lib/backtest/runner.ts`. Spec in REDESIGN_PLAN.md §0.3. The runner must enforce shadow mode by passing a read-only Supabase client (no service role) to the pipeline. Add 8+ tests in `__tests__/runner.spec.ts` covering: deterministic output given same inputs, refuses pipelines that try to write, correct metric calculation. Make the markdown output template parameterizable.

**Verify done:** Tests pass. `runBacktest(snapshot, async () => ({outcome: 'unresolved'}))` returns valid report.

### 0.4 — Build /admin/backtest-review page

**Files create:**
- `web/app/admin/backtest-review/page.tsx`
- `web/app/api/backtest-review/route.ts`

**Behavior:**
- Lists 30 stratified random leads from ground_truth (10 ready_to_call, 10 needs_phone_review, 10 unresolved)
- For each: shows owner name, mailing, property, current phone (if any), evidence
- User can mark: "phone correct," "phone wrong," "phone unknown — couldn't verify"
- Saves to `web/data/ground_truth_labels_v0.json`
- Page is admin-only (requireAdmin)

**Agent prompt:**
> Build the user spot-check UI at `web/app/admin/backtest-review/page.tsx`. Spec in REDESIGN_PLAN.md §0.4. After building, populate the page with 30 stratified leads from ground_truth_v0. The user will fill this in manually during Phase 10. Test the page renders, the API saves labels, and admin auth is enforced. Don't wait for the user to fill it in — that's a Phase 10 step.

**Verify done:** Page renders, API saves a sample label and reads it back.

### Phase 0 verify-done

```
test -f web/data/ground_truth_v0.json && \
test -f web/data/redesign_state.json && \
cd web && npx vitest run lib/backtest && \
echo "Phase 0 done"
```

---

## PHASE 1 — New schema migration

**Goal:** Add the 6 new tables alongside existing schema. No behavior change yet.

**Inputs:** Phase 0 complete.

**Outputs:** Migration applied to production, types generated, tables empty but queryable.

### 1.1 — Schema migration

**Files create:**
- `supabase/migrations/0023_canonical_owner_schema.sql`

**Schema (full SQL in the migration file):**

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Provenance floor: immutable raw rows from rôle imports
CREATE TABLE raw_property (
  id                uuid primary key default gen_random_uuid(),
  matricule         text not null,
  source_file_hash  text not null,
  source_import_job_id uuid references import_jobs(id) on delete set null,
  raw_row           jsonb not null,
  imported_at       timestamptz not null default now(),
  unique(matricule, source_file_hash)
);
CREATE INDEX raw_property_matricule_idx ON raw_property(matricule);

-- Deduped owner — the unit of work
CREATE TABLE canonical_owner (
  owner_id          uuid primary key default gen_random_uuid(),
  owner_type        text not null check (owner_type in ('individual', 'numbered_co', 'named_co', 'trust', 'government')),
  canonical_name    text not null,
  canonical_name_normalized text not null,
  neq               text,
  mailing_address_raw text,
  mailing_geocode   geography(Point, 4326),
  mailing_postal_fsa text,
  dedupe_status     text not null default 'auto' check (dedupe_status in ('auto', 'human_confirmed', 'pending_review')),
  is_aggregator_address boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
CREATE INDEX canonical_owner_normalized_idx ON canonical_owner(canonical_name_normalized);
CREATE INDEX canonical_owner_neq_idx ON canonical_owner(neq) where neq is not null;
CREATE INDEX canonical_owner_geocode_idx ON canonical_owner USING gist(mailing_geocode);
CREATE INDEX canonical_owner_postal_fsa_idx ON canonical_owner(mailing_postal_fsa);

-- Every spelling variant ever seen
CREATE TABLE owner_alias (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  alias_name        text not null,
  alias_name_normalized text not null,
  source            text not null,
  first_seen_at     timestamptz not null default now()
);
CREATE INDEX owner_alias_normalized_idx ON owner_alias(alias_name_normalized);
CREATE INDEX owner_alias_owner_idx ON owner_alias(owner_id);

-- Every fact ever fetched, immutable
CREATE TABLE evidence (
  evidence_id       uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  source            text not null,
  source_url        text,
  query_text        text,
  fetched_at        timestamptz not null default now(),
  raw_response      jsonb,
  structured        jsonb not null,
  weight_at_fetch   numeric not null default 1.0
);
CREATE INDEX evidence_owner_idx ON evidence(owner_id);
CREATE INDEX evidence_source_idx ON evidence(source);
CREATE INDEX evidence_fetched_at_idx ON evidence(fetched_at desc);

-- Proposed contact fact with status
CREATE TABLE hypothesis (
  hypothesis_id     uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  claim_type        text not null check (claim_type in ('phone', 'email', 'address')),
  claim_value       text not null,
  claim_value_e164  text,
  tier              text not null check (tier in ('A', 'B', 'C', 'D', 'E')),
  confidence_label  text not null check (confidence_label in ('confirmed', 'likely', 'connected', 'weak')),
  is_direct         boolean not null,
  status            text not null default 'candidate' check (status in ('candidate', 'accepted', 'rejected', 'superseded')),
  status_reason     text,
  evidence_ids      uuid[] not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
CREATE INDEX hypothesis_owner_idx ON hypothesis(owner_id);
CREATE INDEX hypothesis_status_idx ON hypothesis(status);

-- Published snapshot to CRM
CREATE TABLE owner_record (
  record_id         uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  snapshot_hash     text not null,
  primary_phone_e164 text,
  primary_phone_tier text,
  primary_phone_label text,
  primary_phone_is_direct boolean,
  alternate_phones  jsonb,
  briefing_text     text,
  whats_interesting text,
  property_matricules text[],
  audit_url         text,
  research_completed_at timestamptz not null default now(),
  published_to_crm  boolean not null default false,
  published_at      timestamptz,
  unique(owner_id, snapshot_hash)
);
CREATE INDEX owner_record_owner_idx ON owner_record(owner_id);
CREATE INDEX owner_record_published_idx ON owner_record(published_at desc nulls last);

-- Refresh tracking
CREATE TABLE owner_refresh_schedule (
  owner_id          uuid primary key references canonical_owner(owner_id) on delete cascade,
  last_researched_at timestamptz not null,
  next_research_at  timestamptz not null,
  current_tier      text,
  status            text not null default 'active' check (status in ('active', 'paused', 'do_not_research'))
);
CREATE INDEX owner_refresh_next_idx ON owner_refresh_schedule(next_research_at) where status = 'active';

-- Disposition feedback (for future Phase 12 integration)
CREATE TABLE phone_call_outcome (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references canonical_owner(owner_id) on delete cascade,
  hypothesis_id     uuid references hypothesis(hypothesis_id) on delete cascade,
  phone_e164        text not null,
  outcome           text not null check (outcome in ('correct', 'wrong_number', 'voicemail', 'no_answer', 'do_not_contact')),
  caller_id         uuid references auth.users(id),
  notes             text,
  recorded_at       timestamptz not null default now()
);
CREATE INDEX phone_call_outcome_owner_idx ON phone_call_outcome(owner_id);

-- RLS
ALTER TABLE raw_property ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE hypothesis ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_refresh_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_call_outcome ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='canonical_owner' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON raw_property FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON canonical_owner FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON owner_alias FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON evidence FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON hypothesis FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON owner_record FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON owner_refresh_schedule FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON phone_call_outcome FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
```

**Apply via:** Supabase MCP `apply_migration` tool with the above SQL.

### 1.2 — Generate TypeScript types

**Files modify:**
- `web/lib/database.types.ts` (regenerated)

Run `npx supabase gen types typescript --project-id mkgkrfcfhtrlecfuzroz > web/lib/database.types.ts` (or equivalent).

### 1.3 — Add table-access wrappers

**Files create:**
- `web/lib/research/db.ts` — typed wrappers for inserting evidence, hypothesis, owner_record

**Verify done:**
```
psql "$DATABASE_URL" -c "select count(*) from canonical_owner" && \
psql "$DATABASE_URL" -c "select count(*) from evidence" && \
cd web && npm run typecheck && \
echo "Phase 1 done"
```

---

## PHASE 2 — REQ snapshot ingest

**Goal:** Local Postgres copy of Quebec REQ queryable in <100ms.

### 2.1 — REQ tables

**Files create:**
- `supabase/migrations/0024_req_snapshot.sql`

```sql
CREATE TABLE req_entities (
  neq                  text primary key,
  legal_name           text not null,
  legal_name_normalized text not null,
  juridical_form       text,
  status               text,
  status_date          date,
  registered_address_raw text,
  mailing_address_raw  text,
  registered_geocode   geography(Point, 4326),
  mailing_geocode      geography(Point, 4326),
  postal_fsa           text,
  registered_phone     text,
  activity_codes       text[],
  imported_at          timestamptz not null default now()
);
CREATE INDEX req_entities_legal_name_normalized_idx ON req_entities(legal_name_normalized);
CREATE INDEX req_entities_postal_fsa_idx ON req_entities(postal_fsa);
CREATE INDEX req_entities_mailing_geocode_idx ON req_entities USING gist(mailing_geocode);
CREATE INDEX req_entities_registered_geocode_idx ON req_entities USING gist(registered_geocode);

CREATE TABLE req_directors (
  id            uuid primary key default gen_random_uuid(),
  neq           text not null references req_entities(neq) on delete cascade,
  full_name     text not null,
  full_name_normalized text not null,
  surname       text not null,
  given_name    text,
  role          text,
  start_date    date,
  end_date      date
);
CREATE INDEX req_directors_full_name_idx ON req_directors(full_name_normalized);
CREATE INDEX req_directors_surname_idx ON req_directors(surname);
CREATE INDEX req_directors_neq_idx ON req_directors(neq);

CREATE TABLE req_snapshot_meta (
  id                serial primary key,
  imported_at       timestamptz not null default now(),
  source_file       text not null,
  source_date       date,
  entity_count      integer not null,
  director_count    integer not null
);

ALTER TABLE req_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE req_directors ENABLE ROW LEVEL SECURITY;
ALTER TABLE req_snapshot_meta ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='req_entities' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON req_entities FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON req_directors FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON req_snapshot_meta FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
```

### 2.2 — Find REQ file and ingest

**Files create:**
- `web/scripts/ingest-req.ts`
- `web/scripts/__tests__/ingest-req.spec.ts`

**Behavior:**
- First action: locate the file by running `find ~ -name '*entreprise*.csv' -type f 2>/dev/null | head -5` and select the most recent. If none found, halt with clear error.
- Stream-parse the CSV (handle large files without OOM)
- Geocode addresses via Google Geocoding API (batch in groups of 50, cache results in a local file `web/data/geocode_cache.json`)
- Normalize names: lowercase, NFD-strip diacritics, remove suffixes (INC LTÉE LTEE LTD INCORPOREE ENR ENREGISTREE SENC SCS SOCIETE), collapse whitespace
- Bulk insert in batches of 1000
- Idempotent: re-runnable

**Agent prompt:**
> Build `web/scripts/ingest-req.ts` per REDESIGN_PLAN.md §2.2. Find the file via `find` (locked decision: the file is somewhere in the user's home directory). Use Google Geocoding API; key is in env `GOOGLE_GEOCODING_API_KEY`. Stream-parse with the `csv-parse` library (already in package.json or add it). Add 6+ tests covering: numbered company name parsing, accent normalization, multiple suffix handling, director extraction. Run the script after building it; confirm `req_entities` has at least 100k rows.

### 2.3 — Lookup helpers

**Files create:**
- `web/lib/req/lookup.ts`
- `web/lib/req/__tests__/lookup.spec.ts`

**Functions:**
- `findEntitiesByGeocode(sb, lat, lng, radiusMeters = 75)`
- `findEntitiesByName(sb, normalized, fuzzyDistance = 3)`
- `findEntitiesByDirector(sb, normalized)`
- `getDirectorsForEntity(sb, neq, currentOnly = true)`

**Verify done:**
```
psql "$DATABASE_URL" -c "select count(*) from req_entities" | grep -v 0 && \
cd web && npx vitest run lib/req && \
echo "Phase 2 done"
```

---

## PHASE 3 — Canonical owner derivation

**Goal:** Backfill `canonical_owner` from existing leads/contacts. Establish dedupe logic.

### 3.1 — Three-stage dedupe module

**Files create:**
- `web/lib/research/dedupe.ts`
- `web/lib/research/__tests__/dedupe.spec.ts`

**Logic:**
- Stage 1 (deterministic): match on `(canonical_name_normalized, mailing_postal)` → auto-merge
- Stage 2 (fuzzy): same normalized name, geocode within 500m → review queue (dedupe_status='pending_review')
- Stage 3 (long tail): name matches but no geocode and no shared property → keep separate, tag as `possibly_related`

For companies: match on NEQ first if known.

### 3.2 — Backfill script

**Files create:**
- `web/scripts/backfill-canonical-owners.ts`

**Behavior:**
- Iterates existing `contacts` table
- For each: classify owner_type from existing `kind` enum, normalize name, geocode mailing address, derive postal_fsa
- Run dedupe → either insert new canonical_owner or merge into existing
- Insert owner_alias for original spelling
- Insert raw_property rows for each property linked via property_contacts
- Idempotent (uses owner_alias to find existing canonical_owner before inserting new)

**Verify done:**
```
psql "$DATABASE_URL" -c "select count(*) from canonical_owner" && \
psql "$DATABASE_URL" -c "select count(*) from owner_alias" && \
psql "$DATABASE_URL" -c "select count(*) from raw_property" && \
echo "Phase 3 done"
```

---

## PHASE 4 — Routing classifier

**Goal:** Decide Pipeline A vs B for any given canonical_owner.

### 4.1 — Classifier module

**Files create:**
- `web/lib/research/classifier.ts`
- `web/lib/research/__tests__/classifier.spec.ts`

**Function:** `routeOwner(sb, ownerId): RoutingDecision`

**Returns:**
```typescript
type RoutingDecision = {
  pipeline: 'A' | 'B';
  primaryTarget?: ReqEntity;
  candidateTargets?: ReqEntity[];  // up to 3, ranked
  reqEnrichment?: { isDirector: boolean; directorOf: ReqEntity[] };
  isAggregator: boolean;
  reason: string;
};
```

**Algorithm:** Per architecture diagram. Aggregator threshold = 10 (locked decision).

**Verify done:**
```
cd web && npx vitest run lib/research/classifier && \
echo "Phase 4 done"
```

---

## PHASE 5 — Pipeline A (Business researcher)

**Goal:** Entity-driven research producing evidence rows + hypothesis candidates.

### 5.1 — Twilio Lookup wrapper

**Files create:**
- `web/lib/twilio/lookup.ts`
- `web/lib/twilio/__tests__/lookup.spec.ts`
- `supabase/migrations/0025_twilio_lookup_log.sql`

**Schema:**
```sql
CREATE TABLE twilio_lookup_log (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null,
  carrier_name  text,
  caller_type   text,
  line_type     text,
  cost_usd      numeric not null default 0.04,
  raw_response  jsonb,
  fetched_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days'
);
CREATE INDEX twilio_lookup_log_phone_idx ON twilio_lookup_log(phone_e164);
CREATE INDEX twilio_lookup_log_expires_idx ON twilio_lookup_log(expires_at);
```

**Function:** `lookupCallerName(e164): Promise<{caller_name, caller_type, line_type, error?}>`. Cache hit if `phone_e164` exists with `expires_at > now()`.

### 5.2 — REQ phone researcher

**Files create:**
- `web/lib/research/researchers/req-phone.ts`

**Behavior:** Reads `req_entities.registered_phone` for the entity. Writes evidence row. If phone exists, returns it as a candidate.

### 5.3 — Company website researcher

**Files create:**
- `web/lib/research/researchers/company-website.ts`

**Behavior:**
- Brave search: `"${entity.legal_name}" Quebec contact OR site:.ca`
- Fetch top 3 result pages
- Regex-extract phone numbers
- Each found phone → evidence row with source_url

### 5.4 — Pages Jaunes business researcher

**Files create:**
- `web/lib/research/researchers/pages-jaunes-business.ts`

**Behavior:** Brave search restricted to `pagesjaunes.ca` for entity name. Extract phones.

### 5.5 — Pipeline A orchestrator

**Files create:**
- `web/lib/research/pipeline-a.ts`
- `web/lib/research/__tests__/pipeline-a.spec.ts`

**Behavior:** Runs researchers 5.2 → 5.3 → 5.4. For each candidate phone, runs Twilio Lookup. Writes hypothesis rows with tier based on source count.

**Tier assignment in Pipeline A:**
- 2+ sources, ≥1 authoritative (REQ phone, government registry, name+postal directory) → A
- 1 authoritative source → B
- 1 directory match → C
- Connected number (director/etc.) → D
- Single weak source or stale → E

**Verify done:**
```
cd web && npx vitest run lib/research/pipeline-a lib/twilio && \
echo "Phase 5 done"
```

---

## PHASE 6 — Pipeline B (Individual researcher)

**Goal:** Individual-direct research with stricter 2-source requirement.

### 6.1 — Reverse address researcher

**Files create:**
- `web/lib/research/researchers/reverse-address.ts`

**Behavior:** Brave search for `"${owner.mailing_address}" telephone OR phone`. Extract phones from results. Each → evidence.

### 6.2 — Name + postal directory researcher

**Files create:**
- `web/lib/research/researchers/name-postal-directory.ts`

**Behavior:**
- Brave search: `"${owner.canonical_name}" "${owner.mailing_postal_fsa}" canada411 OR pagesjaunes`
- Extract phones from results
- Tag results that share postal code with owner's mailing as higher confidence

### 6.3 — Cross-property researcher

**Files create:**
- `web/lib/research/researchers/cross-property.ts`

**Behavior:** Query existing `canonical_owner` and join to `phones` table — if same owner has a verified phone elsewhere in the system (different property/file), surface that as a candidate.

### 6.4 — Pipeline B orchestrator

**Files create:**
- `web/lib/research/pipeline-b.ts`
- `web/lib/research/__tests__/pipeline-b.spec.ts`

**Tier assignment in Pipeline B:** Same A-E scale, but Pipeline B's release rule requires Tier A (2+ independent sources). B/C/D drop to review queue. E goes to dead-end.

**Verify done:**
```
cd web && npx vitest run lib/research/pipeline-b && \
echo "Phase 6 done"
```

---

## PHASE 7 — Hypothesis scoring & owner record assembly

**Goal:** Aggregate evidence into hypothesis with tier + label. Build owner_record.

### 7.1 — Scoring module

**Files create:**
- `web/lib/research/scorer.ts`
- `web/lib/research/__tests__/scorer.spec.ts`

**Function:** `scoreHypothesis(evidenceRows, ownerType): {tier, label, isDirect, statusReason}`

**Source independence config:**
- `web/lib/research/source-independence.json`

```json
{
  "independent_pairs": [
    ["req_phone", "twilio_caller_name"],
    ["req_phone", "company_website"],
    ["req_phone", "pages_jaunes_business"],
    ["company_website", "twilio_caller_name"],
    ["pages_jaunes_business", "twilio_caller_name"],
    ["canada411_personal", "pages_jaunes_personal"],
    ["canada411_personal", "twilio_caller_name"]
  ],
  "sibling_groups": [
    ["pagesjaunes.ca", "411.ca", "canada411.ca"]
  ]
}
```

### 7.2 — Owner record assembler

**Files create:**
- `web/lib/research/record-assembler.ts`

**Behavior:**
- Selects accepted hypothesis (highest tier, prefer direct over connected)
- Computes snapshot_hash from primary phone + briefing + property_matricules
- Inserts owner_record (uses ON CONFLICT to handle re-publishes)

### 7.3 — "What's interesting" rules

**Files create:**
- `web/lib/research/whats-interesting.ts`

**Rules:**
- "Recently inherited" — REQ history shows a director name change in last 24 months
- "Corporate restructure" — REQ status change (active → reorg → active) in last 12 months
- "Holds many but no phone ever found" — owner has ≥5 properties + 0 confirmed phones across all attempts → flag as "sophisticated owner avoiding directories"
- "Property age vs assessment delta" — building >50 years old + assessment >$500k average per unit
- "Owner-occupier" — mailing address matches one of their building addresses

**Verify done:**
```
cd web && npx vitest run lib/research/scorer lib/research/whats-interesting && \
echo "Phase 7 done"
```

---

## PHASE 8 — Briefing generation

**Goal:** Templated briefing with Haiku phrasing only.

### 8.1 — Templates

**Files modify:**
- `web/lib/llm/briefing.ts`

**Pipeline A template:**
```
Owner: {canonical_name}{if neq, append "(NEQ {neq})"}
{if directors, append "Director per REQ: {director_name}, registered {director_year}."}
Holds {n_buildings} buildings totaling {n_units} units in {city_list}, assessed at ${total_value}.
Largest: {largest_building.units}-unit at {largest_building.address}, assessed ${largest_building.value}, built {largest_building.year_built}.
{if mailing_is_property, append "Mailing address is {mailing_address}, also a {n_units_at_mailing}-unit owned by them — operates from home."}
{if connected, prepend "Phone: {phone} (rings at {entity_name}'s office). Ask for {owner_name}; if unfamiliar, mark wrong_number."}
{else "Phone: {phone}, sourced from {primary_source}{if corroboration, append " and corroborated by {secondary_source}"}."}
Confidence: {confirmed|likely|connected|weak}.
{whats_interesting_line}
```

**Pipeline B template:**
```
Owner: {canonical_name}, individual.
{if directorOf, append "Listed as director of {entity_name} (separate entity, conversation starter)."}
Holds {n_buildings} buildings totaling {n_units} units in {city_list}, assessed at ${total_value}.
Phone: {phone} (direct line per {primary_source}{if corroboration, append " + {secondary_source}"}).
Caller: verify it's them before mentioning real estate.
Confidence: {confirmed|likely|weak}.
{whats_interesting_line}
```

### 8.2 — Haiku phrasing pass

Constrained: "Make this flow naturally in {French if owner.canonical_name appears Francophone, else English}. Do not add any facts not in the input. Do not omit any fact."

### 8.3 — Re-generate existing briefings

**Files create:**
- `web/scripts/regenerate-briefings.ts`

**Behavior:** Iterates all leads with existing briefing_text. For each: maps lead → canonical_owner, runs new template, updates briefing_text. Idempotent.

**Verify done:**
```
cd web && npx vitest run lib/llm/briefing && \
echo "Phase 8 done"
```

---

## PHASE 9 — CRM publish bridge

**Goal:** Publish from owner_record → existing leads/phones tables so CRM keeps working.

### 9.1 — Bridge module

**Files create:**
- `web/lib/research/crm-bridge.ts`
- `web/lib/research/__tests__/crm-bridge.spec.ts`

**Behavior:**
- Takes an owner_record
- For each property_matricule in the record, finds the corresponding lead in the existing CRM
- Updates lead.status based on hypothesis tier:
  - confirmed/likely → ready_to_call
  - connected → needs_phone_review
  - weak → unresolved_after_research
- Inserts/updates phones row with the primary phone + tier as confidence + label as source

### 9.2 — Publish endpoint

**Files create:**
- `web/app/api/research/publish/route.ts`

**Behavior:** POST endpoint that takes an owner_id, looks up the latest owner_record, runs the bridge. Idempotent via snapshot_hash.

**Verify done:**
```
cd web && npx vitest run lib/research/crm-bridge && \
echo "Phase 9 done"
```

---

## PHASE 10 — 🛑 USER GATE: Backtest & decide

**Goal:** Validate the new system against existing ground truth before cutover.

### 10.1 — Run backtest

**Agent runs:**
```
cd web && npx tsx scripts/run-backtest.ts \
  --snapshot data/ground_truth_v0.json \
  --pipeline new \
  --output data/backtest_report_v1.md
```

### 10.2 — User spot-checks

**User action required:**
- Open `/admin/backtest-review`
- Spot-check 10-20 leads
- Save labels

### 10.3 — Compute decision metrics

**Agent runs:**
```
cd web && npx tsx scripts/compute-backtest-decision.ts \
  --report data/backtest_report_v1.md \
  --labels data/ground_truth_labels_v0.json \
  --output data/backtest_decision_v1.md
```

**Decision criteria (locked):**
- New wrong-rate ≤ old wrong-rate AND found-rate within 5pp of old → AUTO-PROCEED to Phase 11
- Either fails → 🛑 HALT, present data, await user decision

**🛑 USER GATE:** Only at this point does the agent halt to ask the user. The report makes the decision easy.

---

## PHASE 11 — 🛑 USER GATE: Cutover

**Goal:** Switch authoritative writes from old pipeline to new.

### 11.1 — Final pre-cutover smoke test

**Agent runs:** End-to-end test with a single fresh import. Confirm new pipeline produces an owner_record, bridges to lead, briefing renders, audit page renders.

### 11.2 — Cutover

**Files modify:**
- `web/lib/enrichment/pipeline.ts` (the orchestrator) — swap to call new research module
- Move old pipeline to `web/lib/enrichment/pipeline-legacy.ts`

### 11.3 — Build /admin/cutover-status page

**Files create:**
- `web/app/admin/cutover-status/page.tsx`

**Shows:**
- Records published in last 24h
- Tier distribution (% A / B / C / D / E)
- Wrong-rate from disposition feedback
- New canonical_owners created
- Refresh queue depth

### 11.4 — Disable OpenClaw infrastructure

**Agent runs:**
- `railway variables --remove OPENCLAW_WEBHOOK_URL --service socle-v2`
- (User runs locally) `pkill -f openclaw-shim; pkill -f cloudflared`
- Comment out OpenClaw imports in pipeline.ts

**🛑 USER GATE:** "Ready to switch authoritative writes. Confirm to proceed."

---

## PHASE 12 — Post-cutover hardening (post-go-live)

Not blocking. Run after 7 days of cutover stability.

### 12.1 — Refresh scheduler (cron job using `owner_refresh_schedule`)
### 12.2 — Disposition feedback receiver
### 12.3 — Remove `pipeline-legacy.ts` after 30 days

**Out of scope (per user decision):** DNCL/LNNTE integration, Loi 25 compliance review. Do not add.

---

## Per-phase report template

After each phase, agent writes a brief summary to chat:

```markdown
## Phase N complete: {phase_name}

**Duration:** Xm
**Files changed:** N created, M modified
**Tests added:** K (all green)
**DB state:** {key counts}
**Commit:** {hash} on main
**Next:** Phase N+1 — {next_phase_name}, starting now.

{Any unusual observations or assumptions made}
```

After Phase 6, additional check: report the ratio of leads that route to Pipeline A vs B in the existing ground truth. If suspicious (e.g. 100% to A or 100% to B), halt.

---

## Estimated execution time

Aggressive (Opus orchestrating Sonnet, no interruptions): **3-4 days**
Realistic (with backtest tuning loop in Phase 10): **5-7 days**

Phase 10 is the hardest to predict because it depends on backtest results. If the new system is dramatically better than old, cutover can happen fast. If it's worse, expect a tuning iteration of 1-2 days.

Phases 1-9 are mostly mechanical and can run end-to-end without user intervention.

---

## End of plan
