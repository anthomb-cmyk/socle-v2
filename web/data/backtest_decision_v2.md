# Backtest Decision Report

**Generated at:** 2026-05-08T01:27:54.392Z
**Backtest run at:** 2026-05-08T01:27:49.478Z
**Mode:** smoke-test (REQ-only) / dry-run

## Decision: PROCEED

> Both gates pass: wrong_rate 0.0% ≤ 0.0% (old), found_rate delta 0.0pp ≤ 5pp.

## Metrics

### Old System (CRM baseline)

| Metric | Value |
|--------|-------|
| Total leads | 369 |
| Leads with phone | 0 |
| Found rate | 0.0% |
| Wrong rate | n/a (assumed 0 — CRM is ground truth) |

### New System (pipeline results)

| Metric | Value |
|--------|-------|
| Leads evaluated | 369 |
| Released (phone found) | 0 |
| Held (candidate only) | 0 |
| Unresolved | 369 |
| Released correct | 0 |
| Released wrong | 0 |
| Released unverifiable | 0 |
| Found rate | 0.0% |
| Wrong rate | n/a (no verifiable releases) |

## Gate Checks

| Gate | Threshold | New | Old | Result |
|------|-----------|-----|-----|--------|
| Wrong rate | new ≤ old | 0.0% | 0.0% | PASS |
| Found rate delta | |new − old| ≤ 5pp | 0.0% | 0.0% (diff: 0.0pp) | PASS |

## Pipeline Breakdown

| Pipeline | Evaluated | Released | Held | Unresolved |
|----------|-----------|----------|------|------------|
| A        | 0 | 0 | 0 | 0 |
| B        | 0 | 0 | 0 | 0 |
| (none)   | 369 | 0 | 0 | 369 |

## Top Disagreements (Spot-Check Candidates)

Leads where new and old pipeline do not agree (up to 20):

| Lead ID | Snapshot Phone | New Phone | Outcome | Pipeline |
|---------|----------------|-----------|---------|----------|
| 26d12ace-2181-4beb-97bc-e30f4acbba4d | +15144753302 | (none) | unresolved | ? |
| 1d205d7d-76c6-4194-b63d-d2d48ef44428 | +15144753302 | (none) | unresolved | ? |
| 24288485-d908-45cc-84e0-0201fae1cb44 | +14504652600 | (none) | unresolved | ? |
| 0aa4adf0-5306-4862-97d9-70bcee85057a | +15146797702 | (none) | unresolved | ? |
| a0831c06-cb0c-4bda-85fb-24813bc96bf9 | +14506591927 | (none) | unresolved | ? |
| 6de8d48b-ac42-4425-8b06-f92b2dee598e | +14506591927 | (none) | unresolved | ? |
| f49d245d-98d1-40b1-b511-09de64555d92 | +14506591927 | (none) | unresolved | ? |
| 39624a11-de3b-487e-b27e-5aadd1c758aa | +15147617105 | (none) | unresolved | ? |

## Notes

- Wrong rate for old system is assumed 0 (CRM data treated as ground truth).
- In smoke-test mode, Brave-powered researchers (company-website, pages-jaunes-business,
  reverse-address, name-postal-directory) and Twilio lookups are skipped.
- Only req-phone (Pipeline A) and cross-property (Pipeline B) are active.
- Most leads will appear as 'unresolved' if their canonical_owner was not found
  (Phase 3 backfill may not cover all contacts in this sandbox environment).
- Rerun with `--persist` to write evidence/hypothesis rows to DB.