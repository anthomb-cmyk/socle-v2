Claude
Socle CRM — Caller Module Design & Implementation Handoff
Repo: anthomb-cmyk/socle-v2 · Stack: Next.js 15 App Router · Supabase · Twilio · Tailwind + custom --crm-* tokens · FR/EN i18n via LocaleProvider

Operating principle: the existing code is the functional source of truth. The mockups (Socle Caller PWA.html, Socle Caller Desktop.html) are the visual & layout source of truth. Use the design to restyle and reorganize functionality, not to replace it.

1. Files Claude Code must inspect first (in this order)
Read these before touching anything. They define the contract.

Foundation

web/middleware.ts — auth gate; understand which routes are protected.
web/lib/auth.ts — role types: admin | manager | caller | cold_caller | research_assistant | viewer. isCallerTier() is the gate for caller-only UI.
web/lib/i18n.ts — full FR/EN dictionary. Every visible string in the new UI must come from t.*.
web/components/locale-provider.tsx — useLocale() hook, LocaleToggle, LOCALE_STORAGE_KEY.
web/app/globals.css — existing --crm-* tokens (cream, gold, charcoal, red, amber, green) + utility classes (crm-card, crm-btn, crm-pill--*, crm-phone-cta, crm-outcome-btn--*, crm-mobile-bottom-nav, crm-sidebar*).
Navigation & shell 6. web/components/app-sidebar.tsx — desktop sidebar, PRIMARY_NAV + ADMIN_NAV, useSidebarCounts() polling /api/sidebar-counts every 30s, mobile slide-out, LocaleToggle placement. 7. web/components/mobile-bottom-nav.tsx — 4-tab bottom bar (Calls / Follow-ups / Leads / Menu). 8. web/app/layout.tsx — where LocaleProvider, AppSidebar, MobileBottomNav are mounted.

Caller module 9. web/app/calls/queue/page.tsx — server query: assigned_to = user.id, status in CALLABLE_STATUSES, best_phone not null, exclude leads with active locks held by other callers, order by priority/next_action_at/last_contacted_at. 10. web/app/calls/queue/QueueLeadList.tsx — left-border priority colors, overdue badge, tel: link, status pills. 11. web/app/calls/[leadId]/page.tsx — server: fetch lead + phones + last 15 call_logs + users_meta.twilio_forward_to. Caller-tier sees only their own assigned leads. 12. web/app/calls/[leadId]/CallWorkspace.tsx — phone selector, tap-to-call, Twilio call state machine (idle→initiating→ringing→answered→completed/failed), 3-second status polling, call lock acquire/release lifecycle (useEffect POST + sendBeacon DELETE), outcome catalog, callback picker, escalating-outcome submission form. 13. web/app/calls/[leadId]/CallLeadHeader.tsx — header chip pattern. 14. web/app/calls/[leadId]/CallHistoryPanel.tsx — timeline + transcript + AI organize block. 15. web/components/caller/OutcomeButtonGroup.tsx + CallerField.tsx + CallerInput.tsx + CallerSelect.tsx + CallerDateTimeInput.tsx — atomic caller form primitives.

Phone review 16. web/app/phone-review/page.tsx + PhoneReviewClient.tsx — confidence buckets, multi-select, bulk approve/reject (concurrency 10), evidence chips, OpenClaw verdict. 17. web/app/phone-review/PhoneReviewRules.tsx — visibility rules.

Follow-ups 18. web/app/follow-ups/page.tsx + FollowUpsList.tsx — overdue / today / upcoming buckets.

API surface (do not modify) 19. web/app/api/calls/lock/route.ts — POST acquire, DELETE release. 20. web/app/api/calls/log/route.ts — outcome routing + status transitions. 21. web/app/api/calls/next/route.ts — "next lead" picker. 22. web/app/api/calls/status/route.ts — Twilio call state polling. 23. web/app/api/twilio/calls/start/route.ts — outbound bridge initiator. 24. web/lib/twilio.ts — phone normalization, TwiML helpers.

2. Existing functions that MUST be preserved (non-negotiable)
Auth & visibility

Role-based navigation: PRIMARY_NAV items with adminOnly: true are hidden for caller-tier roles.
assigned_to = user.id filter on queue/lead pages — callers only see their own leads.
Locked-by-another-caller exclusion via call_locks table.
Queue

CALLABLE_STATUSES = ["new", "ready_to_call", "in_outreach", "no_answer", "phone_verified"].
Filter best_phone not null.
Hide leads with next_action_at in the future (callbacks reappear when due).
Sort: priority desc → next_action_at asc → last_contacted_at asc.
Per-lead call count badge.
Workspace — call lifecycle

useEffect lock acquire on mount via POST /api/calls/lock.
Lock release on unmount via navigator.sendBeacon + DELETE /api/calls/lock keepalive.
409 on lock = non-fatal (lead is being viewed by another caller; show banner, do not block).
Workspace — phone

Phone selector preserves multi-phone ordering by confidence desc.
tel: link uses selectedPhone.e164 directly.
Twilio "Call" button hits POST /api/twilio/calls/start with {leadId, phoneId} — bridges to the user's twilio_forward_to. If forward number missing, show amber warning, disable Twilio call (keep tel: link working).
Status polling every 3000ms via GET /api/calls/status?callLogId=.... States: idle | initiating | ringing | answered | completed | failed.
Workspace — outcomes QUICK (neutral/info/negative/danger): no_answer, voicemail_left, wrong_number, bad_number, not_interested, do_not_contact, maybe_later. HOT / escalating: wants_more_info, open_to_selling, wants_offer, hot_seller, follow_up_booked. These trigger the submission form (interest level, timeline, motivation, asking price, summary) → POST /api/submissions → routes to Anthony. CALLBACK: call_back_later with nextCallAt ISO datetime. Default = tomorrow 10:00.

Phone review

Confidence buckets: all, ≥80, 70–79, 60–69, 50–59, <50.
Multi-select + bulk approve/reject/keep_unresolved at concurrency 10.
Actions: approve | reject | retry | keep_unresolved. retry keeps card visible.
Evidence chip taxonomy: mailing_address, city, postal_prefix, contact_name, company_name, related_entity are HIGH_TRUST (green); rest amber. Tenant-prefix snippet detection → warning chip.
i18n

Every visible string flows through useLocale().t. New keys go in web/lib/i18n.ts (both FR + EN).
Persists in localStorage under LOCALE_STORAGE_KEY. Default FR.
PWA / mobile

Existing manifest.json + safe-area inset on mobile bottom nav.
44px minimum tap target enforced in crm-mobile-bottom-tab and crm-outcome-btn.
3. Features the mockups don't show but MUST remain
Call recording + Twilio status webhook (/api/twilio/voice/status, /api/twilio/voice/recording).
Transcript pipeline: transcript_status: none | processing | completed | failed, polled from /api/calls/status.
AI Organize block: POST /api/calls/{id}/organize → returns {seller_name, intent_level, asking_price, objections[], next_steps[], summary}.
Sidebar polling counts (/api/sidebar-counts, 30s interval): leads_total, leads_ready_to_call, phone_candidates_needs_review, review_items_pending, proposed_actions_pending, hot_sellers_pending.
NextStepBanner when queue is empty.
OpenClaw verdict: likely_match | uncertain | unlikely_match + reasoning + evidence text.
Locked-by-other-caller state — currently leads are silently hidden in the queue. Surface a soft banner if a caller deep-links into one.
4. Screens to modify
Route    Current file    What changes    What stays
/calls/queue    QueueLeadList.tsx    Visual: stats strip, denser row layout, preview panel on desktop.    Server query, sort, filter, lock exclusion.
/calls/[leadId]    CallWorkspace.tsx + CallLeadHeader.tsx    Visual: 2-column desktop layout, dominant gold phone CTA card, restyle outcomes.    Lock lifecycle, Twilio state machine, outcome routing, escalating submission form.
/calls/[leadId] history    CallHistoryPanel.tsx    Visual: timeline w/ left rail, badges.    Transcript polling, AI organize.
/phone-review    PhoneReviewClient.tsx    Visual: split list+evidence panel on desktop, sticky bulk bar restyle.    Bucket filters, bulk concurrency, action taxonomy.
/follow-ups    FollowUpsList.tsx    Visual: tighter cards, status accent rail.    Bucket fetches, complete/cancel handlers.
Sidebar    app-sidebar.tsx    Add caller-only "Module appels" section header; visually demote admin-only items for caller-tier (already filtered out, just confirm).    All nav data, badges, recent leads/deals, polling.
Mobile bottom nav    mobile-bottom-nav.tsx    Confirm 4 tabs; restyle active state to muted gold.    Tab list, locale-aware labels.
5. Components to create / reuse
New (caller-module-only)

Component    Purpose    Desktop    Mobile    States    Data    Preserves
CallerAppShell    Top-level layout wrapper that picks Desktop vs Mobile layout based on viewport.    n/a    n/a    —    role    role gating
CallerDesktopLayout    Sidebar + max-width content area + sticky top bar.    248px sidebar, 1280px max content    hidden    —    role, counts    sidebar contract
CallerMobileLayout    iOS-PWA style. Top bar + safe-area + bottom nav.    hidden    full-bleed    —    role    bottom nav contract
CallerQueueStats    4 KPI tiles.    4 cols    horizontal scroll, 2 cols    loading skeletons    counts from sidebar API or page query    non-destructive
CallerQueueFilters    Search input + status/priority chips.    inline w/ list header    sticky under top bar    active filter state    filters    URL search params if currently used
CallerLeadRow    Desktop tabular row.    grid columns    n/a    hover, selected, locked, overdue    QueueLead    priority border, overdue badge
CallerLeadCard    Mobile card.    n/a    full-width    same as row    QueueLead    tap-to-call vs open distinction
CallerLeadPreviewPanel    Sticky right-rail preview on desktop.    sticky, 460px    hidden    empty (no selection)    selected lead + property + phone    links to workspace
CallerWorkspaceHeader    Breadcrumb + prev/next + skip.    yes    back chevron only    busy disables next    leadId, queue position    goNext() route
OwnerCard    Owner identity + status pill + priority.    yes    yes    hot/normal    lead    status mapping
PropertyCard    Address + units + assessed + built.    yes    yes    missing fields collapse    property    display only
PhoneActionCard    The dominant gold CTA.    yes    sticky bottom on mobile during call    idle/initiating/ringing/answered/completed/failed/no-phone/no-forward    phones[], userForwardTo, callState    full Twilio state machine
PhoneSelector    Dropdown when multiple phones.    yes    yes    single phone hides selector    phones[]    confidence ordering
TwilioCallStatePanel    Live duration + mute/keypad/hangup during answered state.    yes    yes    states above    callLogId    status polling
OutcomeButtonGroup (existing)    Outcome buttons.    grid    grid    disabled while busy    options[]    variant routing
CallbackScheduler    Datetime picker chips (in 15m / 1h / tomorrow AM/PM / custom).    inline    full-width    preview before confirm    callbackTime    nextCallAt ISO contract
CallNotesPanel    Multiline notes textarea.    yes    yes    autosave indicator (future)    notes    passes notes to log
HotSellerSubmissionPanel    The escalating-outcome form.    yes    yes    submitting, error    interest/timeline/motivation/asking/summary    /api/submissions body shape
CallHistoryTimeline    Vertical timeline.    yes    yes    empty, transcript loading    call_logs[]    transcript + organize APIs
PhoneReviewCandidateList    Left list.    yes    full-width    empty, filtered    candidates[]    filter buckets
PhoneReviewEvidencePanel    Right rail with chips, snippet, OpenClaw, action buttons.    sticky    full-screen modal on mobile    approve/reject/retry/keep    candidate    action taxonomy
LockStatusBanner    Yellow banner when lead is locked by someone else.    yes    yes    dismissible    lockedBy    non-blocking
EmptyState / LoadingState / ErrorState    Standard placeholders.    yes    yes    —    —    —
StatusBadge / PriorityBadge / ConfidenceBadge    Visual atoms.    yes    yes    —    —    —
MobileBottomCallBar    Sticky bottom bar during active call (mute / hangup / outcome shortcut).    hidden    shown when callState === "answered"    answered only    call state    doesn't replace bottom nav, layered above
RoleAwareMobileNav    Wraps MobileBottomNav; admins get an extra "Admin" tab leading to /admin.    hidden    yes    role-based    role    existing tab list
Reuse as-is CallerField, CallerInput, CallerSelect, CallerDateTimeInput, OutcomeButtonGroup, LocaleToggle, useLocale, NextStepBanner, app-sidebar, mobile-bottom-nav.

6. Visual tokens (extend globals.css, do not replace)
Cream / charcoal / muted gold mapping to existing --crm-*:

--so-bg:        #faf6ee;  /* page cream */
--so-bg-soft:   #f5f0e3;
--so-card:      #ffffff;
--so-fg-1:      #2b2922;  /* charcoal */
--so-fg-3:      #5a5648;
--so-fg-5:      #a39e8e;
--so-border:           rgba(43,41,34,0.10);
--so-border-faint:     rgba(43,41,34,0.06);
--so-gold-300: #ecd99a;
--so-gold-500: #c9a84c;   /* primary CTA */
--so-gold-700: #8c6f1a;
--so-gold-light: #faf3de;
--so-success: #4f7a4a;
--so-warn:    #b78c2b;
--so-danger:  #a23b3b;
Keep --crm-gold, --crm-gold-border, --crm-card, --crm-text*, --crm-red, --crm-amber, --crm-green, --crm-blue exactly as they are. New --so-* aliases live alongside, not instead.

Type

Display: existing serif (already in globals).
Body: existing sans.
Mono: tabular numerals on phones, durations, units, assessed values: font-feature-settings: "tnum" 1;.
Radii / shadow

Cards: 12–14px radius. Buttons: 8–10px. Phone CTA: 16px.
One soft shadow token for card hover; no glassmorphism in production styles.
7. Mobile / PWA rules
Status bar safe-area: padding-top: env(safe-area-inset-top) on CallerMobileLayout top bar.
Bottom safe-area: padding-bottom: max(env(safe-area-inset-bottom), 12px) on MobileBottomNav and on the main scroll region.
Tap targets ≥44×44px. Outcome buttons 48px. Phone CTA call button 52–56px.
Active call: MobileBottomCallBar slides up over the bottom nav (not replacing it; layered z-index).
No horizontal scrolling. No native browser inputs — use Caller* primitives.
Pull-to-refresh acceptable; do not implement custom.
Caller mobile shell shows ONLY: Calls / Follow-ups / Leads / Menu. Admin gets +Admin tab.
8. Desktop layout rules
Sidebar: 248px, sticky, full-height. Caller-tier shows the "Module appels" section above a dimmed "Reste du CRM" group; admin sees full nav as today.
Content: max-width 1280px, centered, 32px horizontal padding. Never stretch lists to full viewport.
Queue: split layout 1fr / 460px (list / sticky preview).
Workspace: split layout 460px / 1fr (left = owner+property+phone CTA, right = outcomes+notes+callback+history). Left column is position: sticky; top: 88px so the phone CTA stays visible.
Phone review: split layout 1fr / 520px (list / sticky evidence).
Below 1180px viewport, stack to single column with the preview/evidence panel becoming a slide-over.
9. Role-aware access / navigation
Single source of truth = user.app_metadata.role.

Surface    Admin    Caller-tier
Sidebar PRIMARY_NAV    All items    Hide items with adminOnly: true (Dashboard, Pipeline, Phone-review, Review, Import, Enrichment)
Sidebar ADMIN_NAV section    Show    Hide entire section
/calls/queue    Sees all callers' queues if a query param is passed (future); otherwise own    Own assigned leads only — already enforced server-side
/calls/[leadId]    Any lead    Only assigned_to === user.id — notFound() otherwise
/phone-review    Full UI + bulk actions    Hidden from sidebar; route still gated by API role check
/follow-ups    Own + supervisory view (future)    Own only
Hot-seller submissions    Routes to Anthony    Same
Caller supervision view (admin-only, future): /admin/calls/live showing locked leads + caller activity. Out of scope for this pass; design hooks: read-only versions of CallerQueueRow and TwilioCallStatePanel.

10. State matrix
For every screen, design these states explicitly. Mockup files contain the visual treatments.

Screen    normal    loading    empty    error    locked    no-data    hot-priority    overdue-callback    needs-review    success-after-save
Queue    tabular list + preview    row skeletons (6 rows)    NextStepBanner + browse-leads link    inline error pill above list    hidden (filtered server-side) — banner only if deep-linked    "No leads assigned" empty state    red-left border, hot pill    blue-left border + "in retard de Xj" badge    n/a    toast on bulk action
Workspace    2-col with phone CTA    left+right column skeletons    n/a (lead always exists)    red banner above CTA, keep tel: working    yellow LockStatusBanner ("verrouillé par X") above header    "no phones" amber card replaces phone CTA    red-left border on owner card    overdue badge in header    shown in candidate phone list    green checkmark inline next to CTA, then auto-advance
Phone review    split list+evidence    list skeleton + spinner panel    "Tout est validé !" celebration    per-card error line    n/a    bucket = 0 → "Aucun candidat"    high-confidence ≥80 highlighted    n/a    the whole screen    bulk progress bar then refresh
Follow-ups    bucketed list    spinner    "Aucun suivi en attente"    red banner    n/a    n/a    red accent rail on overdue    accent rail    n/a    row collapse animation on complete
History    timeline    per-row skeleton    "Aucun appel précédent"    inline    n/a    first call → only show after first log    n/a    n/a    "transcribing..." pulse    new entry slides in at top
Mobile shell    top bar + content + bottom nav    content skeleton    per-screen    toast    n/a    n/a    n/a    red dot on Calls tab    amber dot on Menu (Phone review entry)    toast confirmation
11. Implementation phases
Phase 0 — Read-only exploration (no commits)

Read everything in §1.
Run the app locally with a caller-tier test account; click through queue → workspace → phone-review → follow-ups.
Note any string not coming from t.* and add to i18n in Phase 1.
Phase 1 — Tokens & atoms (no behavior change)

Append --so-* cream/gold/charcoal aliases to globals.css.
Build the badge / pill / icon-chip atoms as classes (no new components yet).
Add new i18n keys for any new copy used in subsequent phases.
Visual diff: zero behavior change. Old screens still work as today.
Phase 2 — Caller shell

Create CallerAppShell, CallerDesktopLayout, CallerMobileLayout.
In app/layout.tsx, wrap routes under /calls/*, /phone-review, /follow-ups with the new shell when isCallerTier(role) is true. Admin keeps the existing layout.
Restyle MobileBottomNav active state to gold; add RoleAwareMobileNav if a caller-only set diverges.
Phase 3 — Queue

Replace QueueLeadList markup with new CallerQueueStats, CallerQueueFilters, CallerLeadRow (desktop) / CallerLeadCard (mobile), CallerLeadPreviewPanel.
Keep server query untouched. Only the client renderer changes.
Phase 4 — Workspace

Refactor CallWorkspace.tsx into composition of OwnerCard + PropertyCard + PhoneActionCard + TwilioCallStatePanel + OutcomeButtonGroup (reused) + CallbackScheduler + CallNotesPanel + HotSellerSubmissionPanel.
DO NOT touch the lock useEffect, the Twilio state machine, the polling, or the API call shapes. Only move JSX.
Add MobileBottomCallBar for the answered state.
Phase 5 — Phone review

Re-skin PhoneReviewClient into PhoneReviewCandidateList + PhoneReviewEvidencePanel (split layout on desktop, slide-over on mobile).
Bulk action bar restyle. Concurrency, taxonomy, polling untouched.
Phase 6 — History timeline

Re-skin CallHistoryPanel as a vertical timeline. Transcript / Organize blocks unchanged.
Phase 7 — Follow-ups + admin polish

Restyle FollowUpsList cards.
Confirm sidebar caller-section header.
Phase 8 — QA

Run ACCEPTANCE_TESTS.md.
Lighthouse PWA pass on mobile.
Bilingual smoke test (FR + EN, every screen, every state).
Each phase is a separate PR. Each PR must pass build + existing tests before merge.

12. Acceptance checklist
Tick before merge.

Functional preservation

 Caller-tier user does not see Dashboard, Pipeline, Phone-review, Review, Import, Enrichment in sidebar.
 Caller-tier user cannot open /calls/<leadId> for a lead they don't own (404).
 Lead locked by another caller is hidden from the queue.
 Lock acquired on workspace mount; released on unmount even if tab closes (sendBeacon).
 Twilio call goes through full state machine and surfaces "answered" within 3s of pickup.
 If users_meta.twilio_forward_to is null, Twilio call button is disabled but tel: link still works.
 Hot-seller / wants-offer / open-to-selling / wants-more-info / follow-up-booked all open the submission form, not auto-advance.
 call_back_later requires a future nextCallAt; default = tomorrow 10:00.
 Phone review bulk approve runs at concurrency 10 and surfaces progress.
 Sidebar count badges update every 30s.
Visual / UX

 Cream --so-bg everywhere; no off-white drift.
 No emoji in caller surfaces (history panel is the only exception, and only the existing 🎙 / 🎉 / 📅 markers — do not add more).
 No native browser inputs visible. All inputs use Caller* primitives.
 All visible strings come from t.*.
 Mobile tap targets ≥44px.
 Safe-area insets respected on iPhone PWA.
 Phone CTA is the visually dominant element in the workspace.
 Desktop content max-width 1280px; sidebar 248px sticky.
 No screen has a horizontal scroll on 375px width.
Quality

 tsc --noEmit clean.
 eslint clean.
 No new dependencies.
 Bundle size delta < 30KB gz.
13. Things Claude Code MUST NOT touch
API routes under /app/api/** (signatures, response shapes, side effects).
Any file under web/lib/ other than adding new pure helpers — never edit auth.ts, twilio.ts, i18n.ts schema, supabase-*.ts.
Supabase queries / view definitions / RLS / migrations under supabase/.
Database column names referenced by the queue page (leads_view, call_locks, call_logs, phones, users_meta).
Outcome value strings (no_answer, wrong_number, hot_seller, etc.) — they are routing keys.
The escalating-outcomes set: wants_more_info, open_to_selling, wants_offer, hot_seller, follow_up_booked.
Twilio webhook URLs, env vars, TwiML payloads.
Lock TTL or 409 semantics.
sidebar-counts polling interval (30s) or shape.
Production environment variables.
Existing --crm-* token values — only add --so-* aliases.
PRIMARY_NAV and ADMIN_NAV href values, adminOnly flags, or order.
14. Implementation warning for Claude Code
The existing Socle CRM code is the functional source of truth. The new design is the visual & layout source of truth.

Use the design to restyle and reorganize existing functionality, not to replace it. If a mockup omits something present in code (e.g. AI Organize, transcript polling, lock 409 handling), that thing stays. If a mockup adds something not in code (e.g. preview panel, stats strip), build it as a new client component that consumes existing data — do not invent new API endpoints in this pass. When in doubt, preserve the function and re-skin around it.
