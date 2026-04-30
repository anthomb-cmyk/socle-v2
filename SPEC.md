# Socle CRM V2 — Spec

Québec multifamily acquisition operating system. Not a generic CRM.

Clean data in → system organizes it → callers work assigned leads → hot sellers reach Anthony → Anthony decides → n8n + Telegram execute.

## Stack

| Layer | Tech |
|---|---|
| Truth | Supabase (Postgres 15 + Auth + Storage) |
| UI | Next.js 15 App Router + React 19 + TypeScript + Tailwind v4 + shadcn/ui |
| Orchestration | n8n (n8n.cloud) |
| Mobile command | Telegram bot (grammY, Next.js webhook) |
| Voice | Twilio |
| Schedule | Google Calendar |
| Checkboxes | Google Tasks (selectively) |
| Research (later) | OpenClaw / background worker |

Single-tenant for Anthony + Gaylord + future cold callers. RLS uses `app_metadata.role` (`admin` vs `caller`).

## Product surfaces

| Surface | Who | What |
|---|---|---|
| Admin dashboard | Anthony | Imports, campaigns, leads, review inbox, data health, automation events |
| Cold caller workspace | Caller | Assigned leads only, call queue, outcome buttons, save+next |
| Anthony Review Inbox | Anthony | Hot sellers, caller submissions, command clarifications, urgent items |
| Telegram | Anthony | Hot alerts, daily brief, follow-up commands, search, call prep |
| n8n | system | Email triage, daily brief, overdue escalation, call prep, research jobs |

## Data model — high level

```
campaigns ─┬─< import_jobs ─< properties
           │                       │
           │                       └─< property_contacts >── contacts ─< contact_phones >── phones
           │                                                    │
           └─< leads ──< call_logs                               │
                  │       │                                       │
                  │       └─< lead_submissions ─> review_items   │
                  │                                               │
                  └─< follow_ups (gcal/gtasks synced)             │
                  └─< deals (Phase 2)                              │
                                                                  │
automation_events / proposed_actions / command_inbox  (cross-cutting logs)
```

Owners are not their own table. They're a **role** in `property_contacts` (relationship='owner' | 'co_owner' | …). A contact can be a person or a company; companies have rep contacts via the same M2M.

Phones are **first-class** with status, source, confidence, evidence — to protect callers from wrong-owner / DNC / bad-number confusion.

Cities are normalized server-side at import (`VICTORIAVILLE` → `Victoriaville`, `ST-HYACINTHE` → `Saint-Hyacinthe`). One canonical column on `properties.city`.

## Vertical slice (acceptance test path)

Upload Québec rôle XLSX → preview (counts, dupes, errors) → confirm → `import_jobs` row + properties + contacts + phones + leads created → filter leads by city → assign 5 to a caller → caller logs hot seller → submission lands in Review Inbox → Telegram alert sent to Anthony → `automation_events` row visible.

Everything else (deals, research, proposals, smart scoring) is built **after** the slice ships and works.

## Build order

1. Schema + RLS + seeds (this turn)
2. Next.js scaffold + Supabase client + Google SSO (next turn)
3. Import pipeline: upload → parse → preview → confirm → DB writes (next turn)
4. Leads list + city filter + assignment UI (turn after)
5. Caller workspace: queue, outcome buttons, save+next, hot-seller submission (turn after)
6. Review Inbox + Automation Events views (turn after)
7. Telegram bot: hot-seller alert + daily brief + 3 commands (turn after)

After the slice works end-to-end on a real Granby file, expand: enrichment workflow, follow-ups + gcal sync, deals pipeline, more Telegram commands, research jobs.

## Non-negotiable quality bar

- No silent failures. Every import / API / workflow logs to `automation_events` with status.
- No fake success toasts. UI shows the actual database row counts.
- No localStorage as truth. Everything lives in Supabase.
- No AI auto-sending email or making legal/financial commitments.
- No cold-caller access to deal strategy, proposals, or admin views (RLS-enforced).
- No important automation without a row in `automation_events`.
- "Done" means tested end-to-end against the live DB and UI, not just a passing unit test.

See [DECISIONS.md](./DECISIONS.md) for choices made and their rationale.

---

## V2 Blueprint — Design & Pipeline Decisions (2026-04-30)

> These decisions were finalized after reviewing V1 and n8n workflow patterns. They are the official direction for V2 design, import/enrichment, and automation architecture.

### 1. Visual Direction: Keep V1 Feel, Replace V1 Architecture

V2 should feel immediately familiar to Anthony — a cleaner, more reliable version of V1. It must not look like a generic SaaS dashboard.

**V1 source files to scan for visual/UX inspiration (do not copy tech):**
- `proforma-web/src/pages/LeadsManager.jsx`
- `proforma-web/src/components/LeadListRow.jsx`
- `proforma-web/src/components/LeadFiche.jsx`
- `proforma-web/src/components/Topbar.jsx`
- `proforma-web/src/lib/stages.js`
- `proforma-web/src/components/ReviewQueue.jsx`
- `proforma-web/src/components/EnrichmentDashboard.jsx`
- Global CSS (`style.css` / `admin.css`)

**V1-inspired visual/UX patterns to carry forward:**
- Compact lead rows
- Owner/company name visible first; status pill on the right
- Property address below owner name; city + unit count + phone in the row
- Phone number easy to tap/call; "sans tél." clearly visible when missing
- Selected row: soft warm/gold background + gold left-border accent
- Warm neutral background; white cards with soft borders
- Dark charcoal text; muted gray secondary text
- Muted green = valid phone/contact; amber/gold = review/warning; red = bad number / DNC / urgent error only
- Simple topbar: title, subtitle, notification count, user identity, mobile menu
- French-first operational labels where natural for Québec acquisition work

**V1 status concepts to carry forward:**
`Nouveau` · `À appeler` · `Contacté` · `Qualifié` · `Converti` · `Fermé`

**V1 technical weaknesses to NOT carry forward:**
- No `localStorage` as source of truth
- No browser-only import state
- No frontend-only lookup/enrichment loops
- No silent success toasts
- No duplicate-prone in-memory merge logic
- No enrichment work that cannot be audited in Supabase
- No fragile state hidden in React components

---

### 2. Import / Enrichment Pipeline Architecture

The correct pipeline model, in order:

```
Excel upload
  → Deterministic V2 parser (code, not n8n, not OpenClaw, not primarily OpenAI)
  → High-confidence + phone-ready leads → status = ready_to_call → Leads (done, skip all below)
  → Unresolved leads → status = brave_queued → Brave Search
  → Brave finds phone → status = ready_to_call (exit)
  → Brave no result → status = unresolved_after_brave → 411 / directory
  → 411 finds phone → status = ready_to_call (exit)
  → 411 no result → status = unresolved_after_411 → Google Places
  → Places finds phone → status = ready_to_call (exit)
  → Places no result / conflict / low-confidence / high-value missing-phone leads → OpenClaw
  → OpenClaw findings land as unverified enrichment_results
  → Anthony / research assistant approves uncertain/conflicting/low-confidence findings
```

**The parser is deterministic code inside Socle CRM V2** — not n8n, not OpenClaw, not OpenAI. Deterministic code first because it is cheaper, faster, repeatable, and testable. OpenAI API assists only on genuinely ambiguous parser rows. OpenClaw is a judgment-call worker later in the pipeline, not a first-pass parser.

---

### 3. High-Confidence Leads Do Not Require Approval

If the parser finds a lead with all of the following, it is auto-created and goes directly to Leads (`ready_to_call`):
- Clear owner / contact / company
- Clear property address and city
- Valid phone if present in the file
- No duplicate conflict
- No broker / property-manager confusion
- High parser confidence score

**If the file already contains a valid phone number:**
- Create/update owner, contact, property, phone, lead records
- Mark lead `ready_to_call`
- Show it in Leads immediately
- Do NOT send to Brave, 411, Google Places, or OpenClaw
- Do NOT ask Anthony to approve it

**Each phone-ready lead must carry:**
owner name · company/person type · property address · city · unit count (if available) · building age/year built (if available) · assessment/value (if available) · campaign · source file · row number · phone source · confidence score · reason it is callable

Do not invent missing fields. If building age or unit count is absent from the file, leave blank or queue for enrichment separately.

---

### 4. Only Uncertain Records Go to Human Review

**Send to Import Review / Human Review only if:**
- Owner is unclear
- City or address is unclear
- Phone looks suspicious or appears across many unrelated owners
- Duplicate property conflict exists
- Broker or property manager may be confused with the owner
- Relationship confidence is low
- Parser cannot confidently classify the row
- Search results conflict
- OpenClaw is unsure

**Anthony or a research assistant approves:**
uncertain parser results · low-confidence phone/contact matches · duplicate conflicts · broker/owner confusion · conflicting OpenClaw findings · high-impact changes to existing records

Clean leads flow automatically without any approval step.

---

### 5. Supabase Controls Pipeline Filtering — Not n8n Memory

n8n must never decide eligibility from stale in-memory arrays. Every stage queries Supabase for its own eligible batch.

**Each stage must:**
1. Query only eligible unresolved leads from Supabase (by status)
2. Run the search/enrichment step
3. Save results to `enrichment_results`
4. Update lead/enrichment status
5. Set `best_phone_id` / `best_contact_id` when safely resolved
6. Log `automation_event`
7. Exclude solved leads from the next stage by status/query (do not delete)

**Pipeline status values:**

| Status | Meaning |
|---|---|
| `ready_to_call` | Has a valid phone; callable immediately |
| `needs_enrichment` | No phone yet; queued for pipeline |
| `parser_needs_review` | Parser uncertain; awaits human review |
| `brave_queued` | In Brave search queue |
| `unresolved_after_brave` | Brave found nothing |
| `directory_411_queued` | In 411 queue |
| `unresolved_after_411` | 411 found nothing |
| `places_queued` | In Google Places queue |
| `unresolved_after_places` | Places found nothing or conflicting |
| `openclaw_queued` | Sent to OpenClaw for judgment |
| `needs_human_review` | OpenClaw uncertain; awaits human |
| `no_contact_found` | All stages exhausted; no phone found |

---

### 6. Stage Counts Are Required at Every Step

Every import/enrichment stage must report:

| Counter | Description |
|---|---|
| input_count | Records entering this stage |
| found_count | Records where this stage found a result |
| auto_accepted_count | Results auto-accepted (high confidence) |
| pending_review_count | Results held for human review |
| no_result_count | Records where nothing was found |
| failed_count | Records that errored |
| passed_to_next_count | Records forwarded to next stage |
| skipped_already_solved_count | Records already `ready_to_call`; excluded |

No fake success messages. Anthony must know exactly what happened at each stage.

Example — Parser output:
```
2,000 rows input
430 phone-ready leads auto-created (ready_to_call)
1,420 need enrichment (queued for Brave)
110 need review (parser_needs_review)
40 failed
```

Example — Brave output:
```
1,420 input
350 found → ready_to_call
310 auto-accepted
40 pending review
1,030 passed to 411
40 failed
```

---

### 7. OpenClaw Role

OpenClaw is not the replacement for the whole pipeline. It replaces brittle hardcoded "final guess" logic.

**Use OpenClaw for:**
- Low-confidence leads
- Misleading or conflicting results
- Broker vs owner confusion
- Same phone appearing across many unrelated owners
- Leads where Brave / 411 / Places found nothing
- High-value missing-phone leads
- Public web research requiring judgment

**OpenClaw must return structured findings:**

```json
{
  "result_type": "phone | email | owner_identity | property_context | general",
  "value": "...",
  "source_url": "https://...",
  "confidence": 0-100,
  "reasoning_summary": "...",
  "raw_payload": {},
  "recommended_action": "..."
}
```

OpenClaw findings land as `unverified` `enrichment_results`. OpenClaw must never overwrite CRM records directly.

---

### 8. API Search Ordering: Brave → 411 → Google Places → OpenClaw

Use direct APIs/search steps before OpenClaw when possible:

| Step | Tool | Purpose |
|---|---|---|
| 1 | **Brave Search** | General web search; free tier; first pass |
| 2 | **411 / directory** | Phone/directory lookups; Quebec personal listings |
| 3 | **Google Places** | Business/entity/location matches |
| 4 | **OpenClaw** | Messy judgment calls; only after prior steps fail or conflict |

Reason: APIs are faster, cheaper, and more predictable for clean lookups. OpenClaw is better at messy judgment calls. Do not use OpenClaw for cases a direct API lookup can resolve.

---

### 9. Twilio — Current Decision

**Current setup:**
- Incoming calls to Twilio number forward to Anthony's iPhone
- Anthony does not need to be at his computer to receive calls

**Planned future module (not to build until alpha is stable):**
```
Incoming call/SMS
  → Twilio webhook
  → n8n or CRM endpoint
  → communication_event
  → match contact/lead by phone
  → missed call can create follow-up
  → important SMS can create Review Inbox item
  → replies eventually go through CRM/Telegram/Twilio, not personal iPhone
```

Do not build full Twilio CRM integration until core alpha is stable.

---

### 10. Current Alpha Priority (Do Not Deviate)

**Immediate priorities in order:**
1. Prove n8n Email → CRM round-trip: one real email creates/updates a CRM lead, creates a Gmail draft, logs an `automation_event`
2. Prove core caller loop: seed/import lead → assign caller → caller logs call → hot seller submission → Review Inbox → `automation_event`
3. Deploy to stable public URL
4. Then implement staged enrichment pipeline

**Do NOT start before alpha proof works:**
- OpenClaw W8 / real enrichment workflow
- Proposal engine
- Advanced scoring
- Duplicate merge UI
- Twilio CRM integration
- UI polish beyond V1-inspired direction
