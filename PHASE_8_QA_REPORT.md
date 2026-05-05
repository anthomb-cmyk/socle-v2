# Phase 8 — QA Report

Status: **PASS** for the automated checks. Manual smoke / Lighthouse blocks remain
the user's action — the Phase 8 directive lists them under "your action before
Phase 5 starts" / general manual verification, and a CLI agent cannot run them
in this environment.

## Automated checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (exit 0, no output) |
| `npx next lint` | ✅ 17 warnings — same as the Phase 4.5 baseline; zero new across phases 5/6/7 |
| Bundle size delta | n/a — `next build` not run in this environment |

## Component inventory

Caller-related component count after the batch:

| Directory | Components |
|---|---|
| `web/components/caller/` | 12 |
| `web/app/calls/[leadId]/components/` | 14 |
| `web/app/phone-review/components/` | 6 |
| `web/app/follow-ups/components/` | 2 |

Total: **34 presentational components** under the four caller folders.

## Milestone-3 preservation

Confirmed all 6 listed backend files are still on disk with non-trivial line counts:

| File | Lines |
|---|---|
| `supabase/migrations/0007_phone_pipeline.sql` | 180 |
| `web/lib/enrichment/pipeline.ts` | 349 |
| `web/lib/enrichment/openclaw-validate.ts` | 264 |
| `web/app/phone-review/page.tsx` | 103 |
| `web/app/api/enrichment/start/route.ts` | 231 |
| `web/app/api/enrichment/openclaw-callback/route.ts` | 206 |

## API body shapes — preserved verbatim

| Endpoint | Body shape |
|---|---|
| `POST /api/calls/log` | `{ leadId, phoneId, outcome, notes, nextCallAt? }` |
| `POST /api/twilio/calls/start` | `{ leadId, phoneId }` |
| `POST /api/submissions` | `{ leadId, outcome, sellerInterestLevel, timeline, motivation, askingPrice, callerSummary }` |
| `POST /api/calls/lock` | `{ leadId }` |
| `DELETE /api/calls/lock` | `?leadId=…` |
| `GET /api/calls/status` | `?callLogId=…` (3-second poll) |
| `POST /api/calls/{id}/transcribe` | (no body) |
| `POST /api/calls/{id}/organize` | (no body) |
| `POST /api/phone-review/{id}` | `{ action, note? }` |
| `POST /api/phone-review/{id}` (bulk) | `{ action }` |
| `POST /api/follow-ups/{id}/complete` | (no body) |
| `DELETE /api/follow-ups/{id}` | (no body) |
| `GET /api/follow-ups?bucket=…` | `bucket: overdue \| today \| upcoming` |
| `GET /api/sidebar-counts` | (admin-only response shape unchanged) |

## Invariants — preserved verbatim

- ✅ `BULK_CONCURRENCY = 10` (PhoneReviewClient.tsx)
- ✅ `ESCALATING` set: `{ wants_more_info, open_to_selling, wants_offer, hot_seller, follow_up_booked }` (CallWorkspace.tsx)
- ✅ All 13 outcome routing keys present in CallWorkspace.tsx (20 occurrences across the file): `no_answer, voicemail_left, wrong_number, bad_number, not_interested, do_not_contact, maybe_later, wants_more_info, open_to_selling, wants_offer, hot_seller, follow_up_booked, call_back_later`
- ✅ Default callback time = tomorrow 10:00 (CallWorkspace.tsx:`defaultCallbackTime`)
- ✅ Lock release: `navigator.sendBeacon` + `DELETE keepalive` (CallWorkspace.tsx, useEffect cleanup)
- ✅ Status polling: `setInterval(..., 3000)` (CallWorkspace.tsx:`startPolling` and CallHistoryTranscript.tsx)
- ✅ Phone-review `?_just_approved=1` redirect + `router.refresh()` after bulk approve (PhoneReviewClient.tsx:`runBulkAction`)
- ✅ `HIGH_TRUST` evidence chip set: `{ mailing_address, contact_name, company_name, related_entity }` (PhoneReviewEvidencePanel.tsx)
- ✅ `TENANT_PREFIX_RE` regex preserved verbatim (PhoneReviewEvidencePanel.tsx)
- ✅ Sidebar counts polling `POLL_INTERVAL_MS = 30_000` (app-sidebar.tsx — file untouched in Phase 7 except the JSX header insertion)
- ✅ `PRIMARY_NAV` and `ADMIN_NAV` arrays byte-identical (app-sidebar.tsx lines 21–42)

## Layering invariants (z-index)

- ✅ `MobileBottomNav` z-index 50
- ✅ `MobileBottomCallBar` z-index 60 — visible only when `callState === "answered"`, layered above bottom nav, NOT replacing it
- ✅ `PhoneReviewBulkBar` mobile fixed-bottom z-index 60 — same pattern as Phase 4
- ✅ `PhoneReviewMobileSlideover` z-index 70 — sits above the bulk bar when both are open

## State ownership

| Route | State owner | New state added across batch |
|---|---|---|
| `/calls/queue` | `QueueLeadList.tsx` (orchestrator) | `filter`, `query` (Phase 3) |
| `/calls/[leadId]` | `CallWorkspace.tsx` | `durationSec` (Phase 4), `lockedBy` (Phase 4.5) |
| `/phone-review` | `PhoneReviewClient.tsx` | `selectedId` (Phase 5) |
| `/calls/[leadId]` history | `CallHistoryPanel.tsx` (now thin pass-through) | none |
| `/follow-ups` | `FollowUpsList.tsx` | none |
| Sidebar | `app-sidebar.tsx` | none — JSX-only edit |

## Slide-over a11y (Phase 5)

- ✅ `role="dialog"` + `aria-modal="true"` while open (`PhoneReviewMobileSlideover.tsx`)
- ✅ Escape key dismisses (window keydown listener)
- ✅ Focus moves to back-chevron on open (`backRef.current?.focus()`)
- ✅ Focus returns to originating row on close (via `id="pr-row-{id}"` lookup in cleanup)
- ✅ List is NOT unmounted on slide-over open — list scroll position survives dismiss

## Caller security

- ✅ `/calls/queue` `resolveScope()` server-side gate forces caller-tier to `"mine"` regardless of `?scope=…` URL param
- ✅ `/calls/[leadId]` server-side gate `if (role !== "admin" && lead.assigned_to !== user.id) return notFound()`
- ✅ `/phone-review` server-side admin redirect `if (role !== "admin") redirect("/leads")`
- ✅ Lock-holder lookup on 409 uses RLS-gated browser client — caller-tier sees localized "another caller" generic, never a UUID

## i18n

- ✅ Every visible string in **new** Phase 4–7 components reads from `useLocale().t`
- ✅ FR + EN keys present for every Phase 1–7 addition
- ✅ Pre-existing FR-inline strings inside `PhoneReviewEvidencePanel` evidence chip labels (`evidenceLabel`, "Nom trouvé :", "[voir plus]") were preserved verbatim — these existed before the redesign; they did not have i18n keys before this batch and were not part of the Phase 5 split-layout scope. Logged as a known follow-up.

## Pre-existing emoji preservation (per directive)

| Marker | Where | Preserved |
|---|---|---|
| 🎙 (recording) | `CallHistoryEntry.tsx` | ✅ |
| 🎉 (celebration) | `FollowUpsList.tsx` empty state | ✅ |
| 📅 (calendar) | `FollowUpCard.tsx` due-date row, `t.outcome.call_back_later` | ✅ |
| 🔥 (hot seller) | `t.outcome.hot_seller` (i18n value) | ✅ |
| ⟳ (loading spinner) | `FollowUpsList.tsx` loading state | ✅ |

No new emojis added in any new component.

## Backlog

- **B-1**: regenerate Supabase types via `npm run gen:types`. Skipped — Supabase CLI not installed on this machine. The Phase 4.5 narrow row casts (`LockRow`, `MetaRow`) in `CallWorkspace.tsx` remain in place and are documented inline. Run when on a machine with the CLI.
- **B-2** (new): pre-existing FR-only inline strings inside `PhoneReviewEvidencePanel`'s evidence chip labels (`evidenceLabel`, contextual labels like "Nom trouvé :", "Adresse source :", "[voir plus]" / "[voir moins]") could be wired through `useLocale().t` for full bilingual coverage. Not regression-relevant — these existed pre-batch and are localized FR.
- **B-3** (new): `/calls/[leadId]/page.tsx` does not pass `year_built` because `leads_view` doesn't have the column; `PropertyCard` collapses the cell gracefully. If a `year_built` column is added to `leads_view`, the cell renders automatically.
- **B-4** (new): `LockStatusBanner.sinceISO` for caller-tier users defaults to `Date.now()` because RLS denies the read. If the banner template is ever changed to display "since 14:32", either loosen RLS for `created_at` (via a view) or add a thin admin-mediated endpoint for lock metadata.

## Manual verification — caller's action

The following blocks of the Phase 8 acceptance checklist require a browser, a deployed app, and at least two caller accounts. They cannot be run by the CLI agent.

### Bilingual smoke (FR + EN)
- [ ] `/calls/queue` — header, stats, filters, list, scope chips, empty-state breakdown
- [ ] `/calls/[leadId]` — owner, property, phone CTA, outcomes, callback chips, submission form, notes, history
- [ ] `/phone-review` — bucket bar, list rows, evidence panel, slide-over, bulk bar
- [ ] `/follow-ups` — bucket headers, card content, complete/cancel buttons
- [ ] Sidebar — caller section header reads "Module appels" (FR) / "Caller module" (EN)

### Mobile viewport (375px iPhone)
- [ ] No horizontal scroll on any of the 4 caller routes
- [ ] All tap targets ≥44px
- [ ] Safe-area insets respected at top + bottom
- [ ] `PhoneReviewBulkBar` fixed-bottom layered above `MobileBottomNav`
- [ ] `PhoneReviewMobileSlideover` opens, dismisses, list scroll survives
- [ ] Slide-over Escape key dismisses (use Bluetooth keyboard if no physical key)
- [ ] Focus returns to originating row on slide-over close

### Active call (mobile, real Twilio call)
- [ ] `MobileBottomCallBar` slides up only when `callState === "answered"`
- [ ] Layered above `MobileBottomNav` (both visible)
- [ ] Live `MM:SS` counter ticks (~3s polling cadence)
- [ ] Bar slides out when call ends; bottom nav remains

### Lock banner (Phase 4.5 smoke, replicated here for completeness)
- [ ] Two caller accounts open the same lead in two windows
- [ ] First window acquires lock cleanly; no banner
- [ ] Second window's amber `LockStatusBanner` appears with the first caller's name (admin) or "un autre appelant" (caller-tier)
- [ ] Dismiss × hides banner locally; navigation away + back re-mounts it

### Lighthouse PWA pass (mobile, Chrome DevTools)
- [ ] Performance: target ≥80
- [ ] Accessibility: target ≥95
- [ ] Best Practices: target ≥90
- [ ] PWA: installable, service worker (if present), manifest valid
- Record numbers in this report when available.

## Sign-off

The 8-phase batch (Phases 5–8 + B-1) ships with `tsc` clean and `next lint` at the
17-warning baseline. All API request bodies, action keys, polling cadences,
concurrency limits, and security gates are byte-identical or stricter (caller-tier
scope hardcoded server-side). Code-level acceptance is **green**. Browser-level
manual verification remains the user's action.

— Phase 8 (date: 2026-05-05)
