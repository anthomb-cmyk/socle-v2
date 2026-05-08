# Backtest Report

**Run at:** 2026-05-07T20:10:00.000Z
**Leads evaluated:** 369
**Mode:** smoke-test (REQ-only) / dry-run (SQL fallback — no SUPABASE_SERVICE_ROLE_KEY in sandbox)

## Canonical Owner Match (Phase 10 Fix Verification)

| Metric | Count | % |
|--------|-------|---|
| Leads matched to canonical_owner | 264 | 71.5% |
| Leads not matched | 105 | 28.5% |
| **Total** | **369** | **100%** |

> The diacritic + suffix migration fix is confirmed working: 264/369 (71.5%) of snapshot
> leads now resolve to a canonical_owner row via normalized name matching. Previously 0%
> matched due to the mismatch bug.

## Outcomes

| Outcome     | Count | % of Total |
|-------------|-------|------------|
| Released    | 0 | 0.0% |
| Held        | 0 | 0.0% |
| Unresolved  | 369 | 100.0% |

> All 369 leads are unresolved: the pipeline ran in smoke-test dry-run mode
> (no Brave, no Twilio, no evidence/hypothesis rows written). With an empty
> hypothesis table, no phones can be released. The 264 matched leads would
> proceed to Pipeline A/B on a live run with evidence.

## Accuracy

| Metric                        | Count |
|-------------------------------|-------|
| Released correct              | 0 |
| Released wrong                | 0 |
| Released unverifiable         | 0 |
| Held correctly                | 0 |
| Held when should release      | 8 |
| Precision                     | n/a |

> `held_when_should_release` = 8: these are the 8 snapshot leads that had a
> CRM phone but the pipeline returned unresolved (expected in smoke dry-run).

## Pipeline Breakdown

| Pipeline | Evaluated | Released | Held | Unresolved |
|----------|-----------|----------|------|------------|
| A        | 0 | 0 | 0 | 0 |
| B        | 0 | 0 | 0 | 0 |
| (none)   | 369 | 0 | 0 | 369 |

## Notes

- Run method: **SQL fallback** (Supabase MCP direct query; no tsx execution possible — env vars absent).
- Canonical owner matching used: lowercase + NFD-unaccent + strip non-alphanum → space-collapse.
- Match sources: `canonical_owner.canonical_name_normalized` (direct) + `owner_alias.alias_name_normalized` (fallback).
- Smoke-test mode: Brave-powered researchers and Twilio skipped.
- Hypothesis/evidence tables are empty in this sandbox; a live --persist run would populate them.
