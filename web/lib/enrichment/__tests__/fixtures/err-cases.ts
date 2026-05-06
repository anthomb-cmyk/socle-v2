// Regression fixtures: every documented bad case from
// socle_phone_enrichment_error_log.md, encoded as a (lead, brave_result, expected)
// triple. Each fixture asserts that the v3 pipeline produces a NON-reviewable
// disposition (quarantined or pipeline_rejected) for the documented bad input.

import type { LeadContext } from "../../types";

export interface ErrFixture {
  id: string;
  description: string;
  ctx: LeadContext;
  result: { url: string; title: string; description: string };
  /** Expected disposition. "any_non_review" passes if disposition is in
   *  { quarantined, pipeline_rejected, weak_review<=50 }. */
  expectedDisposition: "quarantined" | "pipeline_rejected" | "any_non_review";
  /** Also assert that the source class is one of these (optional). */
  expectedSourceClassIn?: string[];
}

const baseCtx = (over: Partial<LeadContext>): LeadContext => ({
  leadId: "00000000-0000-0000-0000-000000000000",
  contactId: "00000000-0000-0000-0000-000000000001",
  enrichmentJobId: "00000000-0000-0000-0000-000000000002",
  fullName: null,
  companyName: null,
  secondaryName: null,
  propertyAddress: null,
  propertyCity: null,
  mailingAddress: null,
  mailingCity: null,
  mailingPostal: null,
  matricule: null,
  numUnits: null,
  ...over,
});

export const ERR_FIXTURES: ErrFixture[] = [
  // ── ERR-001 — Bissonnmutch / Kent + Granby pollution ───────────────────
  {
    id: "ERR-001",
    description: "Montréal mailing + Granby property → Granby business page",
    ctx: baseCtx({
      companyName: "Bissonnmutch Multi-Logements Inc.",
      propertyAddress: "189-197 Rue Desjardins Nord, Granby",
      propertyCity: "Granby",
      mailingAddress: "3720 Avenue Kent, Montréal QC H3S 1N3",
      mailingCity: "Montréal",
      mailingPostal: "H3S 1N3",
    }),
    result: {
      url: "https://usine231.com/granby/espaces-commerciaux",
      title: "L'Usine 231 - Espaces commerciaux, industriels, bureaux et entrepôts - Granby",
      description: "Espaces à louer à Granby. Téléphone (450) 994-3486. Contactez-nous pour visiter.",
    },
    expectedDisposition: "any_non_review",
  },
  // ── ERR-002 — incomplete mailing (no street) ───────────────────────────
  {
    id: "ERR-002",
    description: "Mailing address has no street number/name → pre-flight fails",
    ctx: baseCtx({
      companyName: "344-350 Simonds Inc.",
      propertyAddress: "350 Rue Simonds Sud, Granby",
      propertyCity: "Granby",
      mailingAddress: "Bromont QC J2L 2X5",
      mailingCity: "Bromont",
      mailingPostal: "J2L 2X5",
    }),
    result: {
      url: "https://fr.411.ca/category/granby",
      title: "Hobbies and Models granby QC entreprises locales | 411.ca",
      description: "G1 Tour, Solaxis Ingeniosite Manufacturiere Inc. Téléphone (450) 772-1141",
    },
    expectedDisposition: "any_non_review",
  },
  // ── ERR-007 — NEQ business number formatted as phone ───────────────────
  {
    id: "ERR-007",
    description: "Quebec NEQ 3367191080 → phone-extraction must hard-reject",
    ctx: baseCtx({
      fullName: "Laurent Wakim",
      mailingAddress: "81 ch. Belval, Bromont QC J2L 2X5",
      mailingCity: "Bromont",
      mailingPostal: "J2L 2X5",
    }),
    result: {
      url: "https://opengovca.com/quebec-business/gendron-benoit",
      title: "Entreprise Gendron-Benoit",
      description: "Entreprise Gendron-Benoit. Quebec Business Number / Numéro d'entreprise du Québec: 3367191080. Adresse: 123 Rue Test.",
    },
    expectedDisposition: "pipeline_rejected",
  },
  // ── ERR-018 — government mediators CSV ─────────────────────────────────
  {
    id: "ERR-018",
    description: "cdn-contenu.quebec.ca CSV → bulk_document, hard deny",
    ctx: baseCtx({
      fullName: "Lei Zhu",
      mailingAddress: "2759 Rue de Chamonix, Saint-Laurent QC H4R 2Z1",
      mailingCity: "Saint-Laurent",
      mailingPostal: "H4R 2Z1",
    }),
    result: {
      url: "https://cdn-contenu.quebec.ca/cdn-content/themeABC/mediateursCivils.csv",
      title: "mediateursCivils.csv",
      description: "Many civil mediators with phone (514) 866-5507 in a long list of unrelated names",
    },
    expectedDisposition: "quarantined",
    expectedSourceClassIn: ["bulk_document"],
  },
  // ── ERR-019 — CAI government PDF ───────────────────────────────────────
  {
    id: "ERR-019",
    description: "cai.gouv.qc.ca CAI_LI_Resp_Acces.pdf → bulk_document",
    ctx: baseCtx({
      companyName: "9370-4716 Quebec Inc.",
      mailingAddress: "640 Rue de Balboa, Boucherville QC J4B 6W5",
      mailingCity: "Boucherville",
      mailingPostal: "J4B 6W5",
    }),
    result: {
      url: "https://www.cai.gouv.qc.ca/documents/CAI_LI_Resp_Acces.pdf",
      title: "CAI_LI_Resp_Acces.pdf — directory of public bodies",
      description: "Bureau des enquêtes indépendantes 201 Place Charles-LeMoyne Longueuil 450 640-1350",
    },
    expectedDisposition: "quarantined",
    expectedSourceClassIn: ["bulk_document"],
  },
  // ── ERR-021 — eBay tire listing matched on numeric token ───────────────
  {
    id: "ERR-021",
    description: "eBay product page with '12165' substring → commerce_unrelated AND out-of-region area code",
    ctx: baseCtx({
      fullName: "Zyad Hobeychi",
      mailingAddress: "12165 Place Gilles-Hocquart, Montréal QC H4K 1V2",
      mailingCity: "Montréal",
      mailingPostal: "H4K 1V2",
    }),
    result: {
      url: "https://www.ebay.ca/itm/2-New-Carlisle-Ground-Force-400-Mx-12-16-5-Tires-12165-12-1-16-5",
      title: "2 New Carlisle Ground Force 400 Mx - 12-16.5 Tires 12165 12 1 16.5 | eBay",
      description: "Tire product listing with phone (520) 204-6024",
    },
    // Phone extractor rejects (520) as out-of-region on a non-authoritative
    // source → pipeline_rejected. Either pipeline_rejected or quarantined is
    // a successful kill from the audit perspective.
    expectedDisposition: "any_non_review",
    expectedSourceClassIn: ["commerce_unrelated"],
  },
  // ── ERR-024 — same street, different civic, exterminator PDF ───────────
  {
    id: "ERR-024",
    description: "352 Calixa-Lavallée vs target 432; aqgp.ca PDF → bulk + civic mismatch",
    ctx: baseCtx({
      fullName: "Marc Breton",
      mailingAddress: "432 Rue Calixa-Lavallée, Granby QC J2G 1C5",
      mailingCity: "Granby",
      mailingPostal: "J2G 1C5",
    }),
    result: {
      url: "https://aqgp.ca/aqgp_membres2017-2018.pdf",
      title: "aqgp_membres2017-2018.pdf",
      description: "EXTERMINATION DE L'ESTRIE 352 Rue Calixa-Lavallée Granby QC J2G 1C2 Téléphone : 450-775-3774",
    },
    expectedDisposition: "any_non_review",
    expectedSourceClassIn: ["bulk_document"],
  },
  // ── ERR-016 — Granby municipality contact page ─────────────────────────
  {
    id: "ERR-016",
    description: "granby.ca municipal contact page",
    ctx: baseCtx({
      fullName: "Pascal Parent",
      mailingAddress: "550 Rue Bertrand, Granby QC J2J 2L3",
      mailingCity: "Granby",
      mailingPostal: "J2J 2L3",
    }),
    result: {
      url: "https://www.granby.ca/nous-joindre",
      title: "Nous joindre | Ville de Granby",
      description: "Adresse 601, rue Léon-Harmel, Granby Téléphone 450 776-8350",
    },
    expectedDisposition: "quarantined",
    expectedSourceClassIn: ["municipal_or_institutional"],
  },
  // ── ERR-013 — Jean Coutu store locator ─────────────────────────────────
  {
    id: "ERR-013",
    description: "jeancoutu.com Succursales par province → directory_aggregate",
    ctx: baseCtx({
      companyName: "Gestion Orea Inc.",
      mailingAddress: "1094 Rue Bérubé, Sherbrooke QC J1N 1B6",
      mailingCity: "Sherbrooke",
      mailingPostal: "J1N 1B6",
    }),
    result: {
      url: "https://www.jeancoutu.com/succursales/quebec",
      title: "Succursales par province | Jean Coutu",
      description: "Sherbrooke 819 823-2222, 819 820-1212",
    },
    expectedDisposition: "quarantined",
    expectedSourceClassIn: ["directory_aggregate"],
  },
  // ── ERR-006 — postal-code list CSV/PDF ─────────────────────────────────
  {
    id: "ERR-006",
    description: "bottinexcel postal-code list → bulk_document",
    ctx: baseCtx({
      companyName: "Meng, Houy Tea",
      mailingAddress: "329 Rue Georges-Cros, Granby QC J2J 0C7",
      mailingCity: "Granby",
      mailingPostal: "J2J 0C7",
    }),
    result: {
      url: "https://bottinexcel.com/codes-postaux-granby-2016",
      title: "Codes postaux Granby 2016 — Bottin Excel",
      description: "453 RUISSEAU, rue du P3-J ... 450-375-1349 ...",
    },
    expectedDisposition: "quarantined",
    expectedSourceClassIn: ["bulk_document"],
  },
  // ── ERR-026 — santé.gouv resource directory ────────────────────────────
  {
    id: "ERR-026",
    description: "sante.gouv.qc.ca resource page → municipal_or_institutional",
    ctx: baseCtx({
      companyName: "9376-9859 Quebec Inc.",
      mailingAddress: "178 Chemin Jolley, Shefford QC J2M 1N4",
      mailingCity: "Shefford",
      mailingPostal: "J2M 1N4",
    }),
    result: {
      url: "https://sante.gouv.qc.ca/repertoire/ressource/centre-envolee",
      title: "CENTRE L'ENVOLÉE DE GRANBY - Trouver une ressource",
      description: "350 chemin Ostiguy, Shefford QC J2M 2A7. Téléphone (450) 378-5326.",
    },
    // The URL contains "/repertoire/" → AGGREGATE_PATH_RE matches and the
    // classifier flags it as directory_aggregate even though the domain is
    // sante.gouv.qc.ca. Either is a hard-deny class — kill from review.
    expectedDisposition: "quarantined",
    expectedSourceClassIn: ["municipal_or_institutional", "directory_aggregate"],
  },
  // ── ERR-008 — Canada411 surname/result page (Luc Gaucher ≠ Croteau) ───
  {
    id: "ERR-008",
    description: "Canada411 result page for unrelated person",
    ctx: baseCtx({
      fullName: "Cynthia Croteau",
      companyName: "Fiducie Cynthia Croteau",
      mailingAddress: "675 Rue Mountain, Granby QC J2H 0M3",
      mailingCity: "Granby",
      mailingPostal: "J2H 0M3",
    }),
    result: {
      url: "https://www.canada411.ca/search/?stype=si&what=gaucher&where=Granby",
      title: "Gaucher - Canada411 search results",
      description: "Luc Gaucher 675 De L'Ange-Gardien Saint-Paul-D'Abbotsford QC J0E 1A0 (450) 379-9802",
    },
    expectedDisposition: "any_non_review",
  },
  // ── ERR-005 — Bromont Montagne contact page ────────────────────────────
  {
    id: "ERR-005",
    description: "bromontmontagne.com contact page",
    ctx: baseCtx({
      fullName: "Laurent Wakim",
      mailingAddress: "81 ch. Belval, Bromont QC J2L 2X5",
      mailingCity: "Bromont",
      mailingPostal: "J2L 2X5",
    }),
    result: {
      url: "https://www.bromontmontagne.com/en/contact",
      title: "Contact Us - Bromont, montagne d'expériences",
      description: "Phone (866) 276-6668",
    },
    expectedDisposition: "quarantined",
    expectedSourceClassIn: ["municipal_or_institutional"],
  },
];

export interface GoodFixture {
  id: string;
  description: string;
  ctx: LeadContext;
  result: { url: string; title: string; description: string };
  /** Score must be at least this value, gates must all pass. */
  minScore: number;
  expectedSourceClass: string;
}

export const GOOD_FIXTURES: GoodFixture[] = [
  {
    id: "GOOD-1",
    description: "Canada411 detail page for the exact owner at exact address",
    ctx: baseCtx({
      fullName: "Bissonnmutch Multi-Logements Inc.",
      companyName: "Bissonnmutch Multi-Logements Inc.",
      mailingAddress: "3720 Avenue Kent, Montréal QC H3S 1N3",
      mailingCity: "Montréal",
      mailingPostal: "H3S 1N3",
    }),
    result: {
      url: "https://www.canada411.ca/business/bissonnmutch-multi-logements",
      title: "Bissonnmutch Multi-Logements Inc - Canada411",
      description: "Bissonnmutch Multi-Logements Inc 3720 Avenue Kent Montréal QC H3S 1N3 (514) 935-7277",
    },
    minScore: 80,
    expectedSourceClass: "directory_authoritative",
  },
  {
    id: "GOOD-2",
    description: "B2BHint detail page for company with full address match",
    ctx: baseCtx({
      companyName: "Gestion Orea Inc.",
      mailingAddress: "1094 Rue Bérubé, Sherbrooke QC J1N 1B6",
      mailingCity: "Sherbrooke",
      mailingPostal: "J1N 1B6",
    }),
    result: {
      url: "https://b2bhint.com/en/company/qc--gestion-orea-inc",
      title: "Gestion Orea Inc | B2BHint",
      description: "Gestion Orea Inc 1094 Rue Bérubé Sherbrooke QC J1N 1B6 — Phone: (819) 555-0100",
    },
    minScore: 70,
    expectedSourceClass: "directory_authoritative",
  },
];
