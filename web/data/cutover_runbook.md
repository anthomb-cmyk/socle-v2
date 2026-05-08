# Cutover Runbook — Phase 11

This runbook covers the Phase 11 cutover from the legacy enrichment pipeline
(Brave-driven, with OpenClaw fallback) to the new canonical-owner research
pipeline.  It also documents the kill-switch and the OpenClaw teardown.

## 1. Kill-switch (instant rollback, no deploy)

The new pipeline runs whenever `ENRICHMENT_USE_LEGACY` is unset or anything
other than the literal string `"true"`.  To roll back without a deploy:

```bash
# Engage legacy fallback
railway variables --set ENRICHMENT_USE_LEGACY=true --service web

# Re-enable the new pipeline
railway variables --unset ENRICHMENT_USE_LEGACY --service web
```

The flag is read at runtime on every call to `runEnrichmentPipeline`, so
flipping it takes effect on the next worker tick — no restart required.

Default behaviour when unset: NEW pipeline is active.  This is intentional
for the cutover.

## 2. Daily API caps

Two new env vars (optional) override the defaults:

| Variable                       | Default | Purpose                          |
| ------------------------------ | ------- | -------------------------------- |
| `MAX_TWILIO_LOOKUPS_PER_DAY`   | 200     | Twilio Lookup v2 calls per day   |
| `MAX_BRAVE_QUERIES_PER_DAY`    | 1000    | Brave Search queries per day     |

Counters are stored in `api_daily_usage(date, key, count)` and reset at
midnight UTC.  When a cap is exceeded the wrapper returns an empty result
(Brave) or an error stub (Twilio); pipelines degrade gracefully.

Live usage and caps are shown at `/admin/cutover-status`.

## 3. OpenClaw teardown

OpenClaw is no longer used by the new pipeline.  After 7 days of stable
running on the new pipeline:

```bash
# Remove OpenClaw envs from Railway
railway variables --unset OPENCLAW_WEBHOOK_URL          --service web
railway variables --unset OPENCLAW_API_KEY              --service web
railway variables --unset OPENCLAW_CALLBACK_SECRET      --service web

# (n8n side, manual) Disable / archive the OpenClaw deep-search workflow.
```

The legacy pipeline still references these envs.  As long as they are unset
the legacy code path will simply skip the OpenClaw step (it already handles
missing envs via `requestOpenclawDeepSearch`).  Do NOT remove the legacy
code yet — keep it in `web/lib/enrichment/pipeline-legacy.ts` as the
kill-switch target for at least one full retention cycle.

## 4. Rollback procedure

If the new pipeline misbehaves in production:

1. `railway variables --set ENRICHMENT_USE_LEGACY=true --service web`
2. Verify on `/admin/cutover-status` that the flag flipped.
3. Re-queue the affected leads with `/api/enrichment/bulk-rerun`.
4. File an incident ticket with the failing lead IDs and event payloads
   (visible in `enrichment_events`).

## 5. Health checks

Watch these metrics for the first 7 days:

- `/admin/cutover-status` — daily caps below 80%, error count < 5/day.
- Tier distribution skewed toward A/B (≥ 40% of `solved` outcomes).
- `enrichment_events` should NOT contain `openclaw_dispatched` rows after
  cutover.
- `owner_record.published_to_crm` should converge to true within minutes
  of the worker run.
