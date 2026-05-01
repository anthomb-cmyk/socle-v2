# IMPORT_GUIDE.md — Real Rôle XLSX Import

> Use this guide when running AT-1 (the formal import acceptance test) with a real Granby rôle file,
> or any time you're importing real data for the first time.

---

## Supported formats

| Format | Source | Detection rule | Status |
|---|---|---|---|
| **Format B** — Granby compact-indexed | Municipal rôle exports from Granby / similar | Headers contain `Propriétaire1_Nom`, `Propriétaire1_Téléphone` etc. | ✅ Supported (16/16 smoke tests) |
| **Format A** — Longueuil/Sherbrooke | Municipal exports — one row per owner×property | Headers contain `Nom propriétaire` or `Propriétaire Nom` | ✅ Supported (12/12 smoke tests) |
| **Format C/D** | Other municipal variants | Anything else | ⚠️ Falls back to Format B parser — may parse partially |

If `format_detected` shows `unknown` in the preview, the file needs a new parser. Don't confirm it — open an issue.

---

## Required and optional columns

### Format B (Granby) — minimum viable row

| Column | Required | Notes |
|---|---|---|
| `Adresse` | ✅ | Building civic address |
| `Ville` | Recommended | City — used in dedup fallback if no matricule |
| `Matricule` | Recommended | Best dedup key — if missing, uses address+city |
| `Logements` | Optional | Number of units (num_units) |
| `Propriétaire1_Nom` | ✅ | Owner name — "TREMBLAY, JEAN" or "Gestion X inc." |
| `Propriétaire1_Téléphone` | Recommended | Normalized to E.164. Missing = lead created but no phone |
| `Propriétaire2_Nom` | Optional | Second owner — creates second lead for same property |
| `Propriétaire2_Téléphone` | Optional | |
| `Évaluation totale` | Optional | Municipal assessed value |

### Format A (Longueuil) — minimum viable row

| Column | Required | Notes |
|---|---|---|
| `Adresse` | ✅ | |
| `Ville` | Recommended | |
| `Matricule` | Recommended | |
| `Nom propriétaire` | ✅ | |
| `Téléphone propriétaire` | Recommended | |
| `Évaluation totale` | Optional | |

---

## Duplicate protection (how it works)

The importer is **idempotent** — re-importing the same file is safe.

### Properties
1. Match by `matricule` (exact) — fastest, most reliable
2. Fallback: match by `address` + `city` (exact string match after normalization)
3. No match → create new property

### Contacts
1. Match by `full_name` for persons (exact, case-sensitive after title-casing)
2. Match by `company_name` for companies/trusts/numbered_co
3. No match → create new contact

### Leads
- Match by `(campaign_id, property_id, contact_id)` — unique triple
- Re-importing the same file with the same campaign name → `leads_updated`, not `leads_created`
- Importing the same file with a **different campaign name** → new leads created (correct — new campaign)

### Phones
- Upsert by `(contact_id, e164)` — same phone for same contact is never duplicated
- `status` stays `unverified` — never auto-promoted

---

## Pre-flight checklist before uploading a real file

- [ ] File is `.xlsx` (not `.xls`, `.csv`, `.ods`)
- [ ] First row is the header row (column names, not data)
- [ ] File is not password-protected
- [ ] File has at least one sheet named anything (parser reads `SheetNames[0]`)
- [ ] You know which format it is (open it, check if owners are `Propriétaire1_Nom` style or `Nom propriétaire`)
- [ ] You have a campaign name ready (e.g. "Granby rôle avril 2026")
- [ ] You know which caller to assign leads to after import

---

## Running the import

1. Go to `/import`
2. Upload the `.xlsx` file
3. Enter campaign name (required to group leads) and city (optional hint)
4. Click **"Parse and preview"** — wait a few seconds
5. Review the preview:
   - **Format detected** should be `role_b` or `role_a` — if `unknown`, stop
   - **Errors count** — open the errors accordion if > 0; soft errors (missing city) are OK, hard errors need investigation
   - **Properties / Owners / Phones** counts should be plausible for your file size
   - Scan first 10 rows — addresses and owner names should look right
6. Click **"Confirm import"**
7. Wait for completion (large files take up to 60s — the `maxDuration` is set to 300s)
8. Note the counts in the result screen

---

## What the preview counts mean

| Count | What it means |
|---|---|
| Properties | Unique properties detected (grouped by matricule or address) |
| Owners | Total owner records across all properties |
| Phones | Total unique E.164 phones extracted — this = callable leads |
| Errors | Rows that had a soft parse error (missing field, unknown owner type) |

A property with 2 owners = 1 property + 2 owners + 2 leads (one per owner).

---

## Post-import checklist

- [ ] `import_jobs` row shows `status='completed'`
- [ ] `leads_created` count matches expectations
- [ ] Go to `/leads` — filter by your campaign — leads appear with owner, city, phone
- [ ] Leads without a phone will show no phone number — they still exist but aren't callable until enrichment
- [ ] **Assign caller**: `/leads` → select all unassigned → choose caller from dropdown → Assign
- [ ] `/admin/test` → Import pipeline section → `import_unassigned_leads` should drop to 0 after assignment
- [ ] Caller logs into `/calls/queue` — their assigned leads appear

---

## Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `format_detected: unknown` | Headers don't match Format A or B patterns | Open the file, check exact column names. May need a new parser variant. |
| `properties: 0` in preview | Empty sheet, or wrong sheet is first | Check `SheetNames[0]` — rôle data must be on the first sheet |
| Many "missing address" errors | `Adresse` column has a different name | Check exact spelling in file — accents matter for detection |
| `leads_created: 0` after confirm | All leads already exist for this campaign | Re-import creates `leads_updated` not `leads_created` — correct |
| Phone count much lower than owners | Owners without phones, or phone column named differently | Check `Propriétaire1_Téléphone` column name. Phones without valid area code are dropped. |
| `status='failed'` on import_job | `commitImport` threw — likely DB constraint | Check `import_jobs.errors` column for the specific row and message |
| Preview shows garbled text | File encoding issue | Save the Excel file as `.xlsx` from Excel (not Google Sheets export) |

---

## Duplicate detection edge cases

**Same matricule, different city**: matricule wins — property is matched and updated, city is overwritten.

**Same address, different matricule**: two separate properties are created (different matricules = different properties).

**Same owner name, different address**: same contact, different property → two leads for the same contact. This is correct for a portfolio owner.

**Co-owners who are also sole owners elsewhere**: each name is a unique contact. If "GAGNON, MARIE-FRANCE" appears in two files, she'll be matched by full_name and linked to both leads. Her phone will be deduplicated.

**Re-importing with a new campaign name**: creates new leads (intended — different campaigns have different lead sets). Old leads remain untouched.

---

## After AT-1 passes — what's next

Once a real Granby rôle file imports cleanly:
1. Assign leads to Gaylord
2. Gaylord calls → logs outcomes → hot sellers appear in Anthony's review inbox
3. Hot seller → Telegram alert → Anthony reviews at `/review`
4. That completes the full operational loop

The only remaining gap before full production use is phone enrichment (W7: Brave → 411 → Places → OpenClaw) for properties where the rôle has no phone on file.
