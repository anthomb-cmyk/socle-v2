// POST /api/enrichment/run
// Headers: Authorization: Bearer ${N8N_SHARED_KEY}
// Body: { enrichment_job_id?: uuid, lead_id: uuid, lead_context?: {...} }
//
// Server-side OpenClaw deep-search runner. Replaces the n8n W8 deep_search Code-node
// logic with TypeScript. Does Brave search + page fetch + deterministic phone scoring
// + writes results to DB directly.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import {
  buildEmailQueries,
  contextAroundEmail,
  extractEmailsFromText,
  scoreEmailCandidate,
  type EmailCandidate,
} from '@/lib/enrichment/email-search';

export const runtime = 'nodejs';
export const maxDuration = 90;
export const dynamic = 'force-dynamic';

// ── Zod schemas ────────────────────────────────────────────────────────────────

const LeadContext = z.object({
  full_name: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  secondary_name: z.string().nullable().optional(),
  property_address: z.string().nullable().optional(),
  property_city: z.string().nullable().optional(),
  mailing_address: z.string().nullable().optional(),
  mailing_city: z.string().nullable().optional(),
  mailing_postal: z.string().nullable().optional(),
  matricule: z.string().nullable().optional(),
  num_units: z.number().nullable().optional(),
});
type LeadContext = z.infer<typeof LeadContext>;

const JOB_TYPES = ['find_phone', 'verify_phone', 'find_email', 'find_website', 'owner_identity', 'property_context', 'general_research'] as const;
type JobType = typeof JOB_TYPES[number];

const Body = z.object({
  enrichment_job_id: z.string().uuid().optional(),
  lead_id: z.string().uuid(),
  job_type: z.enum(JOB_TYPES).optional(),
  lead_context: LeadContext.optional(),
});
type RunnerBody = z.infer<typeof Body>;

// ── Constants ──────────────────────────────────────────────────────────────────

const PHONE_RE = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
const NA_AREA_CODES = new Set([
  '418','438','450','514','579','581','819','873','367',  // QC primary
  '204','226','236','249','250','289','306','343','365','416','437','519','548','587','604','613','639','647','672','705','709','778','780','782','807','825','867','902','905', // other Canadian
]);
const QC_AREA_CODES = new Set(['367','418','438','450','514','579','581','819','873']);
const PRIORITY_DOMAINS = [
  'canada411.ca','pagesjaunes.ca','411.ca','b2bhint.com','facebook.com',
  'yellow.ca','yellowpages.ca','linkedin.com','infobel.com','quebec.ca',
];
const MAX_PAGE_FETCHES = 8;
const BRAVE_TIMEOUT_MS = 12000;
const PAGE_FETCH_TIMEOUT_MS = 8000;
const TOP_CANDIDATES = 5;

// ── Types ──────────────────────────────────────────────────────────────────────

type Candidate = {
  phone_raw: string;
  source_url: string;
  source_label: string;
  snippet: string;
  confidence: number;
  matched_on: string;
  search_query: string;
  source: 'snippet' | 'page';
};

type CandidateStatus = 'needs_anthony_review' | 'weak_review' | 'quarantined';
type CandidateWriteStatus = CandidateStatus | 'approved_by_anthony' | 'auto_attached';

type PageFetchResult = {
  ok: boolean;
  url: string;
  domain: string;
  bodyLength: number;
  body?: string;
  error?: string;
};

// ── Query builder ──────────────────────────────────────────────────────────────

function buildQueries(lc: LeadContext): string[] {
  const mailingAddress = (lc.mailing_address ?? '').trim();
  const city = (lc.mailing_city ?? lc.property_city ?? '').trim();
  const postal = (lc.mailing_postal ?? '').trim();
  const company = (lc.company_name ?? '').trim();
  const fullName = (lc.full_name ?? '').trim();

  const queries: string[] = [];

  // Primary 5
  if (mailingAddress && city && postal) {
    queries.push(`${mailingAddress} ${city} ${postal} téléphone`);
  }
  if (mailingAddress && city) {
    queries.push(`"${mailingAddress}" "${city}" téléphone`);
  }
  if (fullName && mailingAddress) {
    queries.push(`"${fullName}" "${mailingAddress}" téléphone`);
  }
  if (company && mailingAddress) {
    queries.push(`"${company}" "${mailingAddress}" téléphone`);
  }
  if (company && city) {
    queries.push(`"${company}" "${city}" téléphone`);
  }

  // Fallback 5
  if (company) {
    queries.push(`"${company}" téléphone`);
  }
  if (fullName && company) {
    queries.push(`"${fullName}" "${company}"`);
  }
  if (fullName && city) {
    queries.push(`"${fullName}" "${city}" téléphone`);
  }
  if (company) {
    queries.push(`"${company}" B2BHint`);
  }
  if (mailingAddress) {
    queries.push(`"${mailingAddress}" Canada411 OR "Pages Jaunes" OR 411`);
  }

  // Deduplicate and limit to 10
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of queries) {
    if (!seen.has(q)) {
      seen.add(q);
      deduped.push(q);
    }
  }
  return deduped.slice(0, 10);
}

// ── Brave search helper ────────────────────────────────────────────────────────

async function braveSearch(
  query: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<{
  ok: boolean;
  query: string;
  results?: Array<{ title: string; url: string; description: string }>;
  error?: string;
}> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('country', 'CA');
  try {
    const res = await fetch(url.toString(), {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      },
      signal,
    });
    if (!res.ok) return { ok: false, query, error: `brave http ${res.status}` };
    const json = await res.json() as {
      web?: { results?: Array<{ title: string; url: string; description: string }> };
    };
    return { ok: true, query, results: json.web?.results ?? [] };
  } catch (err) {
    return { ok: false, query, error: (err as Error).message };
  }
}

// ── Page fetch helper ──────────────────────────────────────────────────────────

async function fetchPage(
  url: string,
  signal: AbortSignal,
): Promise<{
  ok: boolean;
  url: string;
  bodyLength: number;
  body?: string;
  error?: string;
}> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocleCRM/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal,
    });
    if (!res.ok) return { ok: false, url, bodyLength: 0, error: `http ${res.status}` };
    const body = await res.text();
    return { ok: true, url, bodyLength: body.length, body };
  } catch (err) {
    return { ok: false, url, bodyLength: 0, error: (err as Error).message };
  }
}

// ── HTML → plain text ──────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

// ── B2BHint entity extraction ──────────────────────────────────────────────

type B2BHintEntities = {
  companies: string[];
  directors: string[];
  addresses: string[];
};

function extractB2BHintEntities(html: string): B2BHintEntities {
  try {
    const text = htmlToText(html);

    // ── Related company names ──────────────────────────────────────────────
    const companies: string[] = [];
    const seenCompanies = new Set<string>();

    // Pattern 1: anchor hrefs like /en/company/... with link text
    const companyLinkRe = /href="\/en\/company\/[^"]+">([^<]{2,80})<\/a/gi;
    let m: RegExpExecArray | null;
    const htmlForLinks = html;
    const clRe = new RegExp(companyLinkRe.source, companyLinkRe.flags);
    while ((m = clRe.exec(htmlForLinks)) !== null && companies.length < 5) {
      const name = m[1].trim();
      const key = name.toLowerCase();
      if (name.length >= 2 && !seenCompanies.has(key)) {
        seenCompanies.add(key);
        companies.push(name);
      }
    }

    // Pattern 2: free-text mentions of legal entity suffixes
    if (companies.length < 5) {
      const entitySuffixRe =
        /([A-ZÀ-ÿ][A-Za-zÀ-ÿ\s''\-]{1,50}(?:Inc\.?|Ltée?\.?|Ltd\.?|Corp\.?|S\.E\.N\.C\.?|Enr\.?|Inc\b|Ltée\b))/g;
      const eRe = new RegExp(entitySuffixRe.source, entitySuffixRe.flags);
      while ((m = eRe.exec(text)) !== null && companies.length < 5) {
        const name = m[1].trim();
        const key = name.toLowerCase();
        if (name.length >= 4 && !seenCompanies.has(key)) {
          seenCompanies.add(key);
          companies.push(name);
        }
      }
    }

    // ── Officer / director names ───────────────────────────────────────────
    const directors: string[] = [];
    const seenDirectors = new Set<string>();

    // Find sections that look like they contain officer/director info
    const officerSectionRe =
      /(?:officers?|directors?|président|actionnaire|administrateur|shareholder)[^.]{0,300}/gi;
    const osRe = new RegExp(officerSectionRe.source, officerSectionRe.flags);
    const personRe = /\b([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zà-ÿ]+){1,3})\b/g;

    while ((m = osRe.exec(text)) !== null && directors.length < 5) {
      const section = m[0];
      const pRe = new RegExp(personRe.source, personRe.flags);
      let pm: RegExpExecArray | null;
      while ((pm = pRe.exec(section)) !== null && directors.length < 5) {
        const name = pm[1].trim();
        const key = name.toLowerCase();
        // Reject single words or very long matches
        if (
          name.split(/\s+/).length >= 2 &&
          name.length <= 50 &&
          !seenDirectors.has(key)
        ) {
          seenDirectors.add(key);
          directors.push(name);
        }
      }
    }

    // Fallback: data-testid patterns (B2BHint sometimes uses these)
    if (directors.length < 5) {
      const testidRe = /data-testid="[^"]*(?:officer|director|person)[^"]*"[^>]*>([^<]{5,60})</gi;
      const tRe = new RegExp(testidRe.source, testidRe.flags);
      while ((m = tRe.exec(html)) !== null && directors.length < 5) {
        const name = m[1].trim();
        const key = name.toLowerCase();
        if (name.split(/\s+/).length >= 2 && !seenDirectors.has(key)) {
          seenDirectors.add(key);
          directors.push(name);
        }
      }
    }

    // ── Registered addresses ───────────────────────────────────────────────
    const addresses: string[] = [];
    const seenAddresses = new Set<string>();
    const addressRe =
      /\d+\s+(?:rue|avenue|boulevard|chemin|place|rang|route|côte)\s+[A-ZÀ-ÿ][\wÀ-ÿ\s\-']{2,40}/gi;
    const aRe = new RegExp(addressRe.source, addressRe.flags);
    while ((m = aRe.exec(text)) !== null && addresses.length < 3) {
      const addr = m[0].trim().replace(/\s+/g, ' ');
      const key = addr.toLowerCase();
      if (!seenAddresses.has(key)) {
        seenAddresses.add(key);
        addresses.push(addr);
      }
    }

    return { companies, directors, addresses };
  } catch {
    return { companies: [], directors: [], addresses: [] };
  }
}

// ── B2BHint secondary query builder ───────────────────────────────────────

function buildSecondaryQueries(
  entities: B2BHintEntities,
  lc: LeadContext,
): string[] {
  const city = (lc.mailing_city ?? lc.property_city ?? '').trim();
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (q: string) => {
    const trimmed = q.trim();
    if (trimmed && !seen.has(trimmed) && queries.length < 10) {
      seen.add(trimmed);
      queries.push(trimmed);
    }
  };

  // Company queries: up to 2 per company (max 5 companies)
  for (const co of entities.companies.slice(0, 5)) {
    push(`"${co}" téléphone`);
    if (city) push(`"${co}" "${city}" téléphone`);
  }

  // Director queries: 1 per director (max 5 directors)
  for (const dir of entities.directors.slice(0, 5)) {
    if (city) push(`"${dir}" "${city}" téléphone`);
    else push(`"${dir}" téléphone`);
  }

  // Address queries: 1 per address (max 3 addresses)
  for (const addr of entities.addresses.slice(0, 3)) {
    push(`"${addr}" téléphone`);
  }

  return queries.slice(0, 10);
}

// ── Scoring ────────────────────────────────────────────────────────────────────

type ScoreResult = { score: number; reasons: string[] };

function scoreText(haystack: string, domain: string, lc: LeadContext): ScoreResult {
  const text = haystack.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const company = (lc.company_name ?? '').toLowerCase();
  const companyShort = company.replace(/\s*(inc\.?|ltée?\.?|ltd\.?|corp\.?|enr\.?)\s*$/i, '').trim();
  const fullName = (lc.full_name ?? '').toLowerCase();
  const lastName = fullName.split(/\s+/).slice(-1)[0] ?? '';
  const mailingAddress = (lc.mailing_address ?? '').toLowerCase();
  const mailingFragment = mailingAddress.split(/\s+/).slice(-2).join(' ').trim();
  const city = (lc.mailing_city ?? lc.property_city ?? '').toLowerCase();
  const postal = (lc.mailing_postal ?? '').toLowerCase().replace(/\s+/g, '');
  const postalPrefix = postal.slice(0, 3);

  if (mailingFragment.length >= 3 && text.includes(mailingFragment)) {
    score += 40;
    reasons.push('mailing_address');
  }
  if (city && text.includes(city)) {
    score += 25;
    reasons.push('city');
  } else if (postalPrefix && text.includes(postalPrefix)) {
    score += 25;
    reasons.push('postal_prefix');
  }
  if (companyShort.length >= 4 && text.includes(companyShort)) {
    score += 25;
    reasons.push('company_name');
  } else if (lastName.length >= 4 && text.includes(lastName)) {
    score += 20;
    reasons.push('contact_name');
  }
  if (PRIORITY_DOMAINS.some(d => domain.includes(d))) {
    score += 15;
    reasons.push('public_directory:' + domain);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ── Phone extraction ───────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  // Strip leading 1 if 11 digits starting with 1
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  const area = ten.slice(0, 3);
  if (!NA_AREA_CODES.has(area)) return null;
  return ten; // normalized 10-digit key
}

function areaCodeFromRawPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  return ten.length === 10 ? ten.slice(0, 3) : null;
}

function extractPhonesFromText(
  text: string,
): Array<{ raw: string; normalized: string }> {
  const results: Array<{ raw: string; normalized: string }> = [];
  // Reset regex lastIndex each call
  const re = new RegExp(PHONE_RE.source, PHONE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const normalized = normalizePhone(raw);
    if (normalized) {
      results.push({ raw, normalized });
    }
  }
  return results;
}

// ── Auto-attach helpers ────────────────────────────────────────────────────────

function countStrongEvidence(matched_on: string): number {
  const r = (matched_on || '').toLowerCase();
  let n = 0;
  if (/(^|;\s*)mailing_address/.test(r)) n++;
  if (/(^|;\s*)(city|postal_prefix)/.test(r)) n++;
  if (/(^|;\s*)contact_name/.test(r)) n++;
  if (/(^|;\s*)company_name/.test(r)) n++;
  if (/(^|;\s*)related_entity/.test(r)) n++;
  return n;
}

function hasIdentityEvidence(matched_on: string): boolean {
  return /(^|;\s*)(contact_name|company_name|related_entity)/.test((matched_on || '').toLowerCase());
}

function hasAddressEvidence(matched_on: string): boolean {
  return /(^|;\s*)mailing_address/.test((matched_on || '').toLowerCase());
}

function chooseCandidateStatus(c: Candidate): CandidateStatus {
  const area = areaCodeFromRawPhone(c.phone_raw);
  const isQcArea = area ? QC_AREA_CODES.has(area) : false;
  const hasIdentity = hasIdentityEvidence(c.matched_on);
  const hasAddress = hasAddressEvidence(c.matched_on);

  if (c.confidence < 50) return 'quarantined';

  // This runner has no LLM verdict. Keep non-QC and name-less finds out of
  // Anthony Review unless the deterministic evidence is unusually strong.
  if (!isQcArea && !(c.confidence >= 85 && hasIdentity && hasAddress)) {
    return 'quarantined';
  }

  if (c.confidence >= 70 && hasIdentity && (hasAddress || c.source === 'page')) {
    return 'needs_anthony_review';
  }

  return 'weak_review';
}

function isAutoAttachable(c: Candidate): boolean {
  // This legacy inline runner has no synchronous judge. Only auto-attach when
  // deterministic evidence includes both identity and address corroboration.
  return !!(c.source_url && c.source_url.length > 0)
      && c.confidence >= 85
      && hasIdentityEvidence(c.matched_on)
      && hasAddressEvidence(c.matched_on)
      && countStrongEvidence(c.matched_on) >= 3;
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function resolveJobType(sb: AdminClient, body: RunnerBody): Promise<JobType> {
  if (body.job_type) return body.job_type;
  if (!body.enrichment_job_id) return 'find_phone';

  const { data } = await sb
    .from('enrichment_jobs')
    .select('job_type')
    .eq('id', body.enrichment_job_id)
    .maybeSingle();

  const jobType = (data as { job_type: string } | null)?.job_type;
  return JOB_TYPES.includes(jobType as JobType) ? (jobType as JobType) : 'find_phone';
}

function shouldFetchForEmail(url: string, domain: string): boolean {
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar)(?:$|[?#])/i.test(url)) return false;
  const blockedDomains = [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'twitter.com',
    'x.com',
    'youtube.com',
  ];
  return !blockedDomains.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

async function runEmailSearch(
  sb: AdminClient,
  body: RunnerBody,
  startedAt: number,
): Promise<NextResponse> {
  type LeadRow = {
    id: string;
    contact_id: string | null;
    status: string;
    properties: { address: string; city: string | null; matricule: string | null; num_units: number | null } | null;
    contacts: {
      full_name: string | null;
      company_name: string | null;
      primary_email: string | null;
      mailing_address: string | null;
      mailing_city: string | null;
      mailing_postal: string | null;
    } | null;
  };

  const { data: leadRaw, error: leadErr } = await sb
    .from('leads')
    .select(`
      id,
      contact_id,
      status,
      properties ( address, city, matricule, num_units ),
      contacts ( full_name, company_name, primary_email, mailing_address, mailing_city, mailing_postal )
    `)
    .eq('id', body.lead_id)
    .single();

  if (leadErr || !leadRaw) {
    return NextResponse.json({ ok: false, error: 'Lead not found' }, { status: 404 });
  }

  const lead = leadRaw as unknown as LeadRow;
  const lc: LeadContext = body.lead_context ?? {
    full_name:        lead.contacts?.full_name ?? null,
    company_name:     lead.contacts?.company_name ?? null,
    mailing_address:  lead.contacts?.mailing_address ?? null,
    mailing_city:     lead.contacts?.mailing_city ?? null,
    mailing_postal:   lead.contacts?.mailing_postal ?? null,
    property_address: lead.properties?.address ?? null,
    property_city:    lead.properties?.city ?? null,
    matricule:        lead.properties?.matricule ?? null,
    num_units:        lead.properties?.num_units ?? null,
  };

  if (lead.contacts?.primary_email) {
    const reasoning_summary = `Contact already has primary_email (${lead.contacts.primary_email}); skipped email search.`;
    if (body.enrichment_job_id) {
      await sb.from('enrichment_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        raw_output: {
          outcome: 'already_has_email',
          result_type: 'email',
          results_count: 0,
          result_ids: [],
          reasoning_summary,
          runner: 'inline_email',
          elapsed_ms: Date.now() - startedAt,
        },
      }).eq('id', body.enrichment_job_id);
    }
    await sb.from('automation_events').insert({
      source:          'web_app',
      event_type:      'email_enrichment_search_complete',
      status:          'success',
      related_lead_id: body.lead_id,
      related_contact_id: lead.contact_id,
      payload: {
        outcome: 'already_has_email',
        job_id: body.enrichment_job_id ?? null,
        reasoning_summary,
        runner: 'inline_email',
      },
    });
    return NextResponse.json({
      ok: true,
      outcome: 'already_has_email',
      result_type: 'email',
      reasoning_summary,
      results: [],
      result_ids: [],
      elapsed_ms: Date.now() - startedAt,
    });
  }

  const queries = buildEmailQueries(lc);
  const braveApiKey = process.env.BRAVE_API_KEY;

  if (!braveApiKey) {
    const reasoning_summary =
      'BRAVE_API_KEY not configured. Email search could not run.';

    if (body.enrichment_job_id) {
      await sb.from('enrichment_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        raw_output: {
          outcome: 'search_unavailable',
          result_type: 'email',
          results_count: 0,
          result_ids: [],
          reasoning_summary,
          meta: { brave_credential_set: false },
          runner: 'inline_email',
          elapsed_ms: Date.now() - startedAt,
        },
      }).eq('id', body.enrichment_job_id);
    }

    await sb.from('automation_events').insert({
      source:          'web_app',
      event_type:      'email_enrichment_search_complete',
      status:          'success',
      related_lead_id: body.lead_id,
      related_contact_id: lead.contact_id,
      payload: {
        outcome: 'search_unavailable',
        job_id: body.enrichment_job_id ?? null,
        reasoning_summary,
        runner: 'inline_email',
      },
    });

    return NextResponse.json({
      ok: true,
      outcome: 'search_unavailable',
      result_type: 'email',
      reasoning_summary,
      results: [],
      result_ids: [],
      elapsed_ms: Date.now() - startedAt,
    });
  }

  const emailMap = new Map<string, EmailCandidate>();
  const queriesRun: string[] = [];
  const domainsChecked = new Set<string>();
  const braveErrors: Array<{ query: string; error: string }> = [];
  const urlsToFetch: Array<{ url: string; domain: string; query: string; title: string; description: string }> = [];
  const seenUrls = new Set<string>();

  const braveCtrl = new AbortController();
  const braveTimer = setTimeout(() => braveCtrl.abort(), BRAVE_TIMEOUT_MS);

  let searchResults: Awaited<ReturnType<typeof braveSearch>>[];
  try {
    searchResults = await Promise.all(
      queries.map((q) => braveSearch(q, braveApiKey, braveCtrl.signal)),
    );
  } finally {
    clearTimeout(braveTimer);
  }

  for (const sr of searchResults) {
    if (!sr.ok || !sr.results) {
      if (sr.error) braveErrors.push({ query: sr.query, error: sr.error });
      continue;
    }
    queriesRun.push(sr.query);

    for (const result of sr.results) {
      const domain = extractDomain(result.url);
      domainsChecked.add(domain);

      const haystack = `${result.title} ${result.description}`;
      for (const email of extractEmailsFromText(haystack)) {
        const { score, reasons } = scoreEmailCandidate({
          haystack,
          domain,
          email,
          context: lc,
          source: 'snippet',
        });
        const existing = emailMap.get(email);
        if (!existing || score > existing.confidence) {
          emailMap.set(email, {
            email,
            source_url: result.url,
            source_label: domain,
            snippet: result.description.slice(0, 300),
            confidence: score,
            matched_on: reasons.join('; '),
            search_query: sr.query,
            source: 'snippet',
          });
        }
      }

      if (
        urlsToFetch.length < MAX_PAGE_FETCHES &&
        !seenUrls.has(result.url) &&
        shouldFetchForEmail(result.url, domain)
      ) {
        seenUrls.add(result.url);
        urlsToFetch.push({
          url: result.url,
          domain,
          query: sr.query,
          title: result.title,
          description: result.description,
        });
      }
    }
  }

  const snippetCount = emailMap.size;

  const pagesFetched: PageFetchResult[] = await Promise.all(
    urlsToFetch.map(async ({ url, domain }) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PAGE_FETCH_TIMEOUT_MS);
      try {
        const res = await fetchPage(url, ctrl.signal);
        return { ...res, domain };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  for (let i = 0; i < pagesFetched.length; i++) {
    const page = pagesFetched[i];
    if (!page.ok || !page.body) continue;

    const urlInfo = urlsToFetch[i];
    const pageText = htmlToText(page.body);
    const searchable = `${page.body} ${pageText}`;

    for (const email of extractEmailsFromText(searchable)) {
      const context = contextAroundEmail(searchable, email);
      const haystack = `${urlInfo?.title ?? ''} ${urlInfo?.description ?? ''} ${context}`;
      const { score, reasons } = scoreEmailCandidate({
        haystack,
        domain: page.domain,
        email,
        context: lc,
        source: 'page',
      });
      const existing = emailMap.get(email);
      if (!existing || score > existing.confidence) {
        emailMap.set(email, {
          email,
          source_url: page.url,
          source_label: page.domain,
          snippet: context.slice(0, 300),
          confidence: score,
          matched_on: reasons.join('; '),
          search_query: urlInfo?.query ?? '',
          source: 'page',
        });
      }
    }
  }

  const allCandidates = Array.from(emailMap.values())
    .sort((a, b) => b.confidence - a.confidence);

  const finalCandidates = allCandidates
    .filter((candidate) => candidate.confidence >= 50)
    .slice(0, TOP_CANDIDATES);

  const resultIds: string[] = [];
  let dedupUpdates = 0;

  const existingMap = new Map<string, { id: string; confidence: number; status: string }>();
  if (lead.contact_id) {
    const { data: existingRows } = await sb
      .from('enrichment_results')
      .select('id, value, confidence, status')
      .eq('contact_id', lead.contact_id)
      .eq('kind', 'email');

    for (const row of (existingRows ?? [])) {
      const r = row as { id: string; value: string; confidence: number | null; status: string };
      existingMap.set(r.value.toLowerCase(), {
        id: r.id,
        confidence: r.confidence ?? 0,
        status: r.status,
      });
    }
  }

  for (const candidate of finalCandidates) {
    const evidence =
      `conf ${candidate.confidence}; matched_on=${candidate.matched_on || 'none'}; ` +
      `query="${candidate.search_query}"; snippet="${candidate.snippet.slice(0, 140)}"`;
    const rawPayload = {
      source_label: candidate.source_label,
      search_query: candidate.search_query,
      matched_on: candidate.matched_on,
      snippet: candidate.snippet,
      runner: 'inline_email',
    };

    const existing = existingMap.get(candidate.email);
    if (existing) {
      if (existing.status === 'unverified') {
        await sb.from('enrichment_results').update({
          lead_id: body.lead_id,
          source: candidate.source === 'page' ? 'brave_email_page' : 'brave_email_snippet',
          source_url: candidate.source_url,
          confidence: Math.max(existing.confidence, candidate.confidence),
          evidence,
          raw_payload: rawPayload,
          found_in_job_id: body.enrichment_job_id ?? null,
        }).eq('id', existing.id);
        dedupUpdates++;
      }
      resultIds.push(existing.id);
      continue;
    }

    const { data: row, error } = await sb.from('enrichment_results').insert({
      contact_id: lead.contact_id,
      lead_id: body.lead_id,
      kind: 'email',
      value: candidate.email,
      source: candidate.source === 'page' ? 'brave_email_page' : 'brave_email_snippet',
      source_url: candidate.source_url,
      confidence: candidate.confidence,
      evidence,
      status: 'unverified',
      raw_payload: rawPayload,
      found_in_job_id: body.enrichment_job_id ?? null,
    }).select('id').single();

    if (error) {
      console.error('[enrichment-run] email result insert failed:', error);
      continue;
    }
    if (row) resultIds.push((row as { id: string }).id);
  }

  const meta = {
    queries_run: queriesRun.length,
    queries_list: queriesRun,
    brave_errors: braveErrors,
    snippet_domains_checked: Array.from(domainsChecked),
    pages_fetched: pagesFetched.map((p) => ({
      url: p.url,
      domain: p.domain,
      status: p.ok ? 'ok' : 'error',
      byteLength: p.bodyLength,
      error: p.error,
    })),
    pages_fetched_count: pagesFetched.length,
    page_errors: pagesFetched.filter((p) => !p.ok).length,
    snippet_candidates_count: snippetCount,
    page_candidates_count: emailMap.size - snippetCount,
    rejected_count: emailMap.size - finalCandidates.length,
    candidates_above_threshold: finalCandidates.length,
    dedup_updates: dedupUpdates,
    brave_credential_set: true,
  };

  const top = finalCandidates[0];
  const reasoning_summary = resultIds.length > 0 && top
    ? `Found ${resultIds.length} reviewable email result(s). Top: ${top.email} conf ${top.confidence} (${top.matched_on || 'limited match'}; source=${top.source_label}).`
    : `No email results accepted. Queries: ${queriesRun.length}. Domains checked: ${Array.from(domainsChecked).slice(0, 6).join(', ')}.`;

  if (body.enrichment_job_id) {
    await sb.from('enrichment_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      raw_output: {
        outcome: resultIds.length > 0 ? 'email_results_found' : 'no_result',
        result_type: 'email',
        results_count: resultIds.length,
        result_ids: resultIds,
        reasoning_summary,
        meta,
        runner: 'inline_email',
        elapsed_ms: Date.now() - startedAt,
      },
    }).eq('id', body.enrichment_job_id);
  }

  await sb.from('enrichment_events').insert({
    lead_id: body.lead_id,
    event_type: 'brave_search_complete',
    stage: 'brave',
    payload: {
      source: 'email_enrichment_runner',
      outcome: resultIds.length > 0 ? 'email_results_found' : 'no_result',
      result_ids: resultIds,
      reasoning_summary,
      meta,
    },
  });

  await sb.from('automation_events').insert({
    source: 'web_app',
    event_type: 'email_enrichment_search_complete',
    status: 'success',
    related_lead_id: body.lead_id,
    related_contact_id: lead.contact_id,
    payload: {
      outcome: resultIds.length > 0 ? 'email_results_found' : 'no_result',
      results: resultIds.length,
      result_ids: resultIds,
      job_id: body.enrichment_job_id ?? null,
      reasoning_summary,
      runner: 'inline_email',
    },
  });

  return NextResponse.json({
    ok: true,
    outcome: resultIds.length > 0 ? 'email_results_found' : 'no_result',
    result_type: 'email',
    lead_status: lead.status,
    reasoning_summary,
    results: finalCandidates,
    result_ids: resultIds,
    meta,
    elapsed_ms: Date.now() - startedAt,
  });
}

// ── POST handler ───────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const startedAt = Date.now();

  // ── Auth ───────────────────────────────────────────────────────────────────
  const expected = process.env.N8N_SHARED_KEY;
  const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'N8N_SHARED_KEY not configured on server' },
      { status: 500 },
    );
  }
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'Bad input', errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();
  const jobType = await resolveJobType(sb, body);
  if (jobType === 'find_email') {
    try {
      return await runEmailSearch(sb, body, startedAt);
    } catch (err) {
      const errorMsg = (err as Error).message ?? 'Unknown error in email enrichment runner';
      if (body.enrichment_job_id) {
        await sb.from('enrichment_jobs').update({
          status:        'failed',
          completed_at:  new Date().toISOString(),
          error_message: errorMsg,
          raw_output: {
            outcome: 'runner_error',
            result_type: 'email',
            error: errorMsg,
            runner: 'inline_email',
          },
        }).eq('id', body.enrichment_job_id);
      }
      await sb.from('automation_events').insert({
        source:          'web_app',
        event_type:      'email_enrichment_search_complete',
        status:          'failed',
        related_lead_id: body.lead_id,
        payload: {
          outcome: 'runner_error',
          error: errorMsg,
          job_id: body.enrichment_job_id ?? null,
          runner: 'inline_email',
        },
        error_message: errorMsg,
      });
      return NextResponse.json(
        { ok: false, error: errorMsg, outcome: 'runner_error', result_type: 'email' },
        { status: 500 },
      );
    }
  }

  // ── Main pipeline (wrapped for error handling) ─────────────────────────────
  try {
    // ── 1. Load or use lead_context ──────────────────────────────────────────
    let lc: LeadContext;

    if (body.lead_context) {
      lc = body.lead_context;
    } else {
      // Fetch from DB
      type LeadRow = {
        id: string;
        properties: { address: string; city: string | null; matricule: string | null; num_units: number | null } | null;
        contacts: {
          full_name: string | null;
          company_name: string | null;
          mailing_address: string | null;
          mailing_city: string | null;
          mailing_postal: string | null;
        } | null;
      };
      const { data: leadRaw, error: leadErr } = await sb
        .from('leads')
        .select(`
          id,
          properties ( address, city, matricule, num_units ),
          contacts ( full_name, company_name, mailing_address, mailing_city, mailing_postal )
        `)
        .eq('id', body.lead_id)
        .single();

      if (leadErr || !leadRaw) {
        return NextResponse.json({ ok: false, error: 'Lead not found' }, { status: 404 });
      }

      const lead = leadRaw as unknown as LeadRow;
      lc = {
        full_name:        lead.contacts?.full_name ?? null,
        company_name:     lead.contacts?.company_name ?? null,
        mailing_address:  lead.contacts?.mailing_address ?? null,
        mailing_city:     lead.contacts?.mailing_city ?? null,
        mailing_postal:   lead.contacts?.mailing_postal ?? null,
        property_address: lead.properties?.address ?? null,
        property_city:    lead.properties?.city ?? null,
        matricule:        lead.properties?.matricule ?? null,
        num_units:        lead.properties?.num_units ?? null,
      };
    }

    // ── 2. Build queries ─────────────────────────────────────────────────────
    const queries = buildQueries(lc);

    // ── 3. Search phase ──────────────────────────────────────────────────────
    const candidatesMap = new Map<string, Candidate>();
    const queriesRun: string[] = [];
    const domainsChecked = new Set<string>();
    const braveErrors: Array<{ query: string; error: string }> = [];
    const urlsToFetch: Array<{ url: string; domain: string; query: string; title: string }> = [];
    const seenUrls = new Set<string>();

    const braveApiKey = process.env.BRAVE_API_KEY;

    if (!braveApiKey) {
      // Skip search phase entirely
      const reasoning_summary =
        'BRAVE_API_KEY not configured on Railway. Set it in env vars and retry. Falling back to no candidates.';

      const candidateIds: string[] = [];

      // Downgrade protection: don't demote a lead that's already in a better state
      const { data: leadNowFallback } = await sb
        .from('leads')
        .select('status')
        .eq('id', body.lead_id)
        .single();
      const currentStatusFallback = (leadNowFallback as { status: string } | null)?.status;
      const newLeadStatus = 'unresolved_after_openclaw';
      const shouldUpdateFallback =
        currentStatusFallback !== 'ready_to_call' &&
        currentStatusFallback !== 'needs_human_review';
      if (shouldUpdateFallback) {
        await sb.from('leads').update({ status: newLeadStatus }).eq('id', body.lead_id);
      }

      if (body.enrichment_job_id) {
        await sb.from('enrichment_jobs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          raw_output: {
            outcome: 'search_unavailable',
            candidates_count: 0,
            candidate_ids: [],
            reasoning_summary,
            meta: { brave_credential_set: false },
            runner: 'inline',
            elapsed_ms: Date.now() - startedAt,
          },
        }).eq('id', body.enrichment_job_id);
      }

      await sb.from('enrichment_events').insert({
        lead_id:    body.lead_id,
        event_type: 'unresolved_after_openclaw',
        stage:      'openclaw',
        payload: {
          source: 'enrichment_runner',
          reasoning_summary,
          candidate_ids: candidateIds,
          meta: { brave_credential_set: false },
        },
      });

      await sb.from('automation_events').insert({
        source:           'web_app',
        event_type:       'openclaw_callback_received',
        status:           'success',
        related_lead_id:  body.lead_id,
        payload: {
          mode:             'deep_search',
          outcome:          'search_unavailable',
          candidates:       0,
          candidate_ids:    [],
          job_id:           body.enrichment_job_id ?? null,
          reasoning_summary,
          runner:           'inline',
        },
      });

      return NextResponse.json({
        ok: true,
        outcome: 'search_unavailable',
        reasoning_summary,
        candidates: [],
        candidate_ids: [],
        elapsed_ms: Date.now() - startedAt,
      });
    }

    // ── 4. Run all queries in parallel ───────────────────────────────────────
    const braveCtrl = new AbortController();
    const braveTimer = setTimeout(() => braveCtrl.abort(), BRAVE_TIMEOUT_MS);

    let searchResults: Awaited<ReturnType<typeof braveSearch>>[];
    try {
      searchResults = await Promise.all(
        queries.map(q => braveSearch(q, braveApiKey, braveCtrl.signal)),
      );
    } finally {
      clearTimeout(braveTimer);
    }

    // ── 5. Process snippets, collect priority URLs ───────────────────────────
    for (const sr of searchResults) {
      if (!sr.ok || !sr.results) {
        if (sr.error) braveErrors.push({ query: sr.query, error: sr.error });
        continue;
      }
      queriesRun.push(sr.query);

      for (const result of sr.results) {
        const domain = extractDomain(result.url);
        domainsChecked.add(domain);

        // Extract phones from title + description snippet
        const haystack = result.title + ' ' + result.description;
        const phones = extractPhonesFromText(haystack);

        for (const { raw, normalized } of phones) {
          const { score, reasons } = scoreText(haystack, domain, lc);
          const existing = candidatesMap.get(normalized);
          if (!existing || score > existing.confidence) {
            candidatesMap.set(normalized, {
              phone_raw:    raw,
              source_url:   result.url,
              source_label: domain,
              snippet:      result.description.slice(0, 300),
              confidence:   score,
              matched_on:   reasons.join('; '),
              search_query: sr.query,
              source:       'snippet',
            });
          }
        }

        // Collect priority URLs
        if (
          urlsToFetch.length < MAX_PAGE_FETCHES &&
          !seenUrls.has(result.url) &&
          PRIORITY_DOMAINS.some(d => domain.includes(d))
        ) {
          seenUrls.add(result.url);
          urlsToFetch.push({
            url:    result.url,
            domain,
            query:  sr.query,
            title:  result.title,
          });
        }
      }
    }

    const snippetCount = candidatesMap.size;

    // ── 6. Fetch priority pages in parallel ──────────────────────────────────
    const pagesFetched: PageFetchResult[] = await Promise.all(
      urlsToFetch.map(async ({ url, domain }) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PAGE_FETCH_TIMEOUT_MS);
        try {
          const res = await fetchPage(url, ctrl.signal);
          return { ...res, domain };
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    // ── 7. Extract phones from pages ──────────────────────────────────────────
    for (let i = 0; i < pagesFetched.length; i++) {
      const page = pagesFetched[i];
      if (!page.ok || !page.body) continue;

      const urlInfo = urlsToFetch[i];
      const text = htmlToText(page.body);
      const domain = page.domain;

      // Find all phone matches with 200-char context window
      const re = new RegExp(PHONE_RE.source, PHONE_RE.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const raw = m[0];
        const normalized = normalizePhone(raw);
        if (!normalized) continue;

        const start = Math.max(0, m.index - 100);
        const end   = Math.min(text.length, m.index + raw.length + 100);
        const context = text.slice(start, end).trim();

        const titleHint = urlInfo?.title ?? '';
        const haystack = titleHint + '\n' + context;
        const { score: baseScore, reasons } = scoreText(haystack, domain, lc);
        const score = Math.min(100, baseScore + 10); // +10 page bonus
        const finalReasons = [...reasons, 'fetched_page'];

        const existing = candidatesMap.get(normalized);
        if (!existing || score > existing.confidence) {
          candidatesMap.set(normalized, {
            phone_raw:    raw,
            source_url:   page.url,
            source_label: domain,
            snippet:      context.slice(0, 300),
            confidence:   score,
            matched_on:   finalReasons.join('; '),
            search_query: urlInfo?.query ?? '',
            source:       'page',
          });
        }
      }
    }

    // ── 5.5. B2BHint secondary pass ──────────────────────────────────────────
    // Activates only when: (a) zero primary candidates ≥ 50 confidence AND
    // (b) at least one b2bhint.com URL appeared in the snippet results.

    const primaryAboveThreshold = Array.from(candidatesMap.values())
      .filter(c => c.confidence >= 50).length;

    // Collect b2bhint URLs seen in snippet results
    const b2bHintUrl: string | null = (() => {
      for (const sr of searchResults) {
        if (!sr.ok || !sr.results) continue;
        for (const r of sr.results) {
          if (extractDomain(r.url).includes('b2bhint.com')) return r.url;
        }
      }
      return null;
    })();

    // secondary_pass telemetry (populated below)
    const secondaryPassMeta: {
      triggered: boolean;
      reason:
        | 'no_primary_candidates_b2bhint_found'
        | 'skipped_primary_succeeded'
        | 'skipped_no_b2bhint_url';
      b2bhint_url: string | null;
      b2bhint_fetched: boolean;
      entities_extracted: { companies: number; directors: number; addresses: number };
      secondary_queries_run: number;
      secondary_queries_list: string[];
      secondary_phones_found: number;
    } = {
      triggered: false,
      reason:
        primaryAboveThreshold > 0
          ? 'skipped_primary_succeeded'
          : b2bHintUrl === null
          ? 'skipped_no_b2bhint_url'
          : 'no_primary_candidates_b2bhint_found',
      b2bhint_url: b2bHintUrl,
      b2bhint_fetched: false,
      entities_extracted: { companies: 0, directors: 0, addresses: 0 },
      secondary_queries_run: 0,
      secondary_queries_list: [],
      secondary_phones_found: 0,
    };

    let secondaryReasoningSuffix = '';

    if (primaryAboveThreshold === 0 && b2bHintUrl !== null) {
      secondaryPassMeta.triggered = true;

      // Fetch the B2BHint page
      const b2bCtrl = new AbortController();
      const b2bTimer = setTimeout(() => b2bCtrl.abort(), PAGE_FETCH_TIMEOUT_MS);
      let b2bHtml = '';
      try {
        const b2bResult = await fetchPage(b2bHintUrl, b2bCtrl.signal);
        secondaryPassMeta.b2bhint_fetched = b2bResult.ok;
        if (b2bResult.ok && b2bResult.body) {
          b2bHtml = b2bResult.body;
        }
      } finally {
        clearTimeout(b2bTimer);
      }

      if (b2bHtml) {
        // Extract entities from the B2BHint page
        const entities = extractB2BHintEntities(b2bHtml);
        secondaryPassMeta.entities_extracted = {
          companies: entities.companies.length,
          directors: entities.directors.length,
          addresses: entities.addresses.length,
        };

        // Build secondary queries
        const secondaryQueries = buildSecondaryQueries(entities, lc);
        secondaryPassMeta.secondary_queries_list = secondaryQueries;
        secondaryPassMeta.secondary_queries_run = secondaryQueries.length;

        if (secondaryQueries.length > 0) {
          // Run secondary Brave searches in parallel
          const secCtrl = new AbortController();
          const secTimer = setTimeout(() => secCtrl.abort(), BRAVE_TIMEOUT_MS);
          let secResults: Awaited<ReturnType<typeof braveSearch>>[];
          try {
            secResults = await Promise.all(
              secondaryQueries.map(q => braveSearch(q, braveApiKey, secCtrl.signal)),
            );
          } finally {
            clearTimeout(secTimer);
          }

          // Extract phones from secondary snippets and merge into candidatesMap
          let newPhonesFound = 0;
          for (const sr of secResults) {
            if (!sr.ok || !sr.results) continue;
            for (const result of sr.results) {
              const domain = extractDomain(result.url);
              domainsChecked.add(domain);
              const haystack = result.title + ' ' + result.description;
              const phones = extractPhonesFromText(haystack);

              for (const { raw, normalized } of phones) {
                const { score: baseScore, reasons } = scoreText(haystack, domain, lc);
                // +10 bonus for secondary pass, capped at 100
                const score = Math.min(100, baseScore + 10);
                const finalReasons = [...reasons, 'related_entity'];

                const existing = candidatesMap.get(normalized);
                if (!existing || score > existing.confidence) {
                  if (!existing) newPhonesFound++;
                  candidatesMap.set(normalized, {
                    phone_raw:    raw,
                    source_url:   result.url,
                    source_label: domain,
                    snippet:      result.description.slice(0, 300),
                    confidence:   score,
                    matched_on:   finalReasons.join('; '),
                    search_query: sr.query,
                    source:       'snippet',
                  });
                }
              }
            }
          }
          secondaryPassMeta.secondary_phones_found = newPhonesFound;

          // Build suffix for reasoning_summary
          const b2bDomain = extractDomain(b2bHintUrl);
          const entityDesc =
            `${entities.companies.length} companies, ${entities.directors.length} directors`;
          secondaryReasoningSuffix =
            ` Primary 0 candidates → B2BHint secondary fetched ${b2bDomain}` +
            ` (${entityDesc}), ${secondaryQueries.length} secondary queries, +${newPhonesFound} candidate(s).`;
        }
      }
    }

    // ── 8. Filter to accepted candidates ─────────────────────────────────────
    const allCandidates = Array.from(candidatesMap.values())
      .sort((a, b) => b.confidence - a.confidence);

    const finalCandidates = allCandidates
      .filter(c => c.confidence >= 50)
      .slice(0, TOP_CANDIDATES);

    // ── 9. DB writes ──────────────────────────────────────────────────────────

    // 9a. Load contact_id for this lead (needed for auto-attach phones insert)
    let contactId: string | null = null;
    {
      const { data: leadContact } = await sb
        .from('leads')
        .select('contact_id')
        .eq('id', body.lead_id)
        .single();
      contactId = (leadContact as { contact_id: string | null } | null)?.contact_id ?? null;
    }

    // 9b. Fetch existing phone_candidates for dedup
    const { data: existingRows } = await sb
      .from('phone_candidates')
      .select('id, phone_e164, source_label, initial_confidence, candidate_status')
      .eq('lead_id', body.lead_id);

    const existingMap = new Map<string, { id: string; initial_confidence: number; candidate_status: string | null }>();
    for (const r of (existingRows ?? [])) {
      const row = r as { id: string; phone_e164: string; source_label: string; initial_confidence: number | null; candidate_status: string | null };
      const key = `${row.phone_e164}|${row.source_label}`;
      existingMap.set(key, {
        id: row.id,
        initial_confidence: row.initial_confidence ?? 0,
        candidate_status: row.candidate_status,
      });
    }

    // 9c. Per-candidate loop: dedup + insert/update + auto-attach
    const candidateIds: string[] = [];
    const reviewCandidateIds: string[] = [];      // needs_anthony_review ones
    const autoAttachedPhoneIds: string[] = [];    // phone_candidates.id
    const autoAttachedPhones: string[] = [];      // e164 list
    let dedupUpdates = 0;
    let anyAutoAttached = false;

    for (const c of finalCandidates) {
      const phoneE164 = '+1' + c.phone_raw.replace(/\D/g, '').slice(-10);
      const key = `${phoneE164}|${c.source_label}`;
      const computedStatus = chooseCandidateStatus(c);

      let candidateId: string | null = null;
      let candidateStatus: CandidateWriteStatus = computedStatus;

      const existing = existingMap.get(key);
      if (existing) {
        // Dedup: UPDATE existing row — bump confidence, refresh fields
        const bumped = Math.max(existing.initial_confidence, c.confidence);
        const protectedStatus = existing.candidate_status === 'approved_by_anthony'
          || existing.candidate_status === 'auto_attached';
        candidateStatus = protectedStatus
          ? (existing.candidate_status as CandidateWriteStatus)
          : computedStatus;
        await sb
          .from('phone_candidates')
          .update({
            initial_confidence: bumped,
            snippet:            c.snippet,
            source_url:         c.source_url,
            matched_on:         c.matched_on,
            review_reason:      `OpenClaw deep search — confidence ${bumped} (${c.matched_on})`,
            search_query:       c.search_query,
            candidate_status:   candidateStatus,
          })
          .eq('id', existing.id);
        candidateId = existing.id;
        dedupUpdates++;
      } else {
        // Fresh insert
        const { data: row } = await sb.from('phone_candidates').insert({
          lead_id:            body.lead_id,
          enrichment_job_id:  body.enrichment_job_id ?? null,
          phone_raw:          c.phone_raw,
          phone_e164:         phoneE164,
          stage:              'openclaw',
          source_label:       c.source_label,
          source_url:         c.source_url,
          snippet:            c.snippet,
          initial_confidence: c.confidence,
          candidate_status:   candidateStatus,
          review_reason:      `OpenClaw deep search — confidence ${c.confidence} (${c.matched_on})`,
        }).select('id').single();

        if (row) {
          candidateId = (row as { id: string }).id;
        }
      }

      if (candidateId) {
        candidateIds.push(candidateId);
      }

      // 9d. Auto-attach check
      if (candidateId && candidateStatus === 'needs_anthony_review' && isAutoAttachable(c) && contactId) {
        // Check whether this phone already exists in the canonical phones table
        const { data: existingPhone } = await sb
          .from('phones')
          .select('id')
          .eq('contact_id', contactId)
          .eq('e164', phoneE164)
          .maybeSingle();

        if (!existingPhone) {
          // Insert into phones
          const evidence = `conf ${c.confidence}; source=${c.source}; url=${c.source_url}; snippet="${c.snippet.slice(0, 120)}"`;
          const notes = `Auto-attached by enrichment runner — matched_on: ${c.matched_on}`;
          await sb.from('phones').insert({
            contact_id:  contactId,
            e164:        phoneE164,
            display:     c.phone_raw,
            status:      'valid',
            source:      'enrichment_other',
            confidence:  c.confidence,
            evidence,
            notes,
          });
        }
        // Whether phone already existed or we just inserted it — mark candidate auto_attached
        const newReviewReason =
          `OpenClaw deep search — confidence ${c.confidence} (${c.matched_on}) [AUTO-ATTACHED]`;
        await sb
          .from('phone_candidates')
          .update({
            candidate_status: 'auto_attached',
            review_reason:    newReviewReason,
          })
          .eq('id', candidateId);

        autoAttachedPhoneIds.push(candidateId);
        autoAttachedPhones.push(phoneE164);
        anyAutoAttached = true;
      } else if (candidateId && candidateStatus === 'needs_anthony_review') {
        reviewCandidateIds.push(candidateId);
      }
    }

    // 9e. Lead status decision — with downgrade protection
    // Hierarchy: ready_to_call > needs_human_review > unresolved_after_openclaw
    // The runner may only escalate, never demote.

    const { data: leadNow } = await sb
      .from('leads')
      .select('status')
      .eq('id', body.lead_id)
      .single();
    const currentStatus = (leadNow as { status: string } | null)?.status;

    let newLeadStatus: string;
    if (anyAutoAttached) {
      newLeadStatus = 'ready_to_call';
    } else if (reviewCandidateIds.length > 0) {
      newLeadStatus = 'needs_phone_review';
    } else {
      newLeadStatus = 'unresolved_after_openclaw';
    }

    // Downgrade protection:
    // - never demote from ready_to_call unless the new status is also ready_to_call
    // - never demote from needs_phone_review to unresolved_after_openclaw
    const statusRank: Record<string, number> = {
      ready_to_call: 3,
      needs_phone_review: 2,
      needs_human_review: 2,  // kept for backward compat with in-flight rows
      unresolved_after_openclaw: 1,
    };
    const currentRank = statusRank[currentStatus ?? ''] ?? 0;
    const newRank = statusRank[newLeadStatus] ?? 0;
    const shouldUpdate = newRank >= currentRank;

    const leadStatusUpdateMeta = {
      previous: currentStatus ?? null,
      computed: newLeadStatus,
      applied: shouldUpdate ? newLeadStatus : (currentStatus ?? null),
      protected_from_downgrade: !shouldUpdate,
    };

    if (shouldUpdate) {
      await sb.from('leads').update({ status: newLeadStatus }).eq('id', body.lead_id);
    } else {
      // Keep current status — no update needed
      newLeadStatus = currentStatus ?? newLeadStatus;
    }

    // ── Build meta & reasoning_summary ───────────────────────────────────────
    const autoAttachMeta = {
      candidates_auto_attached: autoAttachedPhoneIds.length,
      auto_attached_phone_ids:  autoAttachedPhoneIds,
      auto_attached_phones:     autoAttachedPhones,
      dedup_updates:            dedupUpdates,
      threshold_rule:           'source_url present && score>=85 && identity+address evidence (legacy runner has no judge)',
    };

    const meta = {
      queries_run:                queriesRun.length,
      queries_list:               queriesRun,
      brave_errors:               braveErrors,
      snippet_domains_checked:    Array.from(domainsChecked),
      pages_fetched:              pagesFetched.map(p => ({
        url:        p.url,
        domain:     p.domain,
        status:     p.ok ? 'ok' : 'error',
        byteLength: p.bodyLength,
        error:      p.error,
      })),
      pages_fetched_count:        pagesFetched.length,
      page_errors:                pagesFetched.filter(p => !p.ok).length,
      snippet_candidates_count:   snippetCount,
      page_candidates_count:      candidatesMap.size - snippetCount,
      rejected_count:             candidatesMap.size - finalCandidates.length,
      candidates_above_threshold: finalCandidates.length,
      review_candidates_count:    reviewCandidateIds.length,
      weak_or_quarantined_count:  candidateIds.length - reviewCandidateIds.length - autoAttachedPhoneIds.length,
      total_candidates_seen:      candidatesMap.size,
      brave_credential_set:       true,
      secondary_pass:             secondaryPassMeta,
      auto_attach:                autoAttachMeta,
      lead_status_update:         leadStatusUpdateMeta,
    };

    const queryExamples = queriesRun.slice(0, 3).map(q => `"${q}"`).join(' | ');
    const domainList = Array.from(domainsChecked).slice(0, 6).join(', ');
    const pageStatusList = pagesFetched
      .map(p => `${p.domain}:${p.ok ? 'ok' : 'error'}`)
      .join(', ');

    let reasoning_summary: string;
    if (anyAutoAttached && finalCandidates.length > 0) {
      const autoList = autoAttachedPhones
        .map((ph) => {
          const cand = finalCandidates.find(
            fc => ('+1' + fc.phone_raw.replace(/\D/g, '').slice(-10)) === ph,
          );
          return cand
            ? `${cand.phone_raw} conf ${cand.confidence} (${cand.matched_on}; public_directory:${cand.source_label}; source=${cand.source})`
            : ph;
        })
        .join(', ');
      reasoning_summary =
        `Found ${finalCandidates.length} candidate(s) — ${autoAttachedPhoneIds.length} auto-attached: ${autoList} → phones. Lead → ready_to_call.` +
        secondaryReasoningSuffix;
    } else if (reviewCandidateIds.length > 0) {
      const top = finalCandidates[0];
      reasoning_summary =
        `Found ${reviewCandidateIds.length} review candidate(s) from ${queriesRun.length} Brave queries + ${pagesFetched.length} page fetches.` +
        secondaryReasoningSuffix +
        ` Top: ${top.phone_raw} conf ${top.confidence} (${top.matched_on}; source=${top.source}).`;
    } else if (candidateIds.length > 0) {
      reasoning_summary =
        `Found ${candidateIds.length} weak/quarantined candidate(s), none strong enough for Anthony Review.` +
        secondaryReasoningSuffix;
    } else {
      reasoning_summary =
        `No phone candidates accepted. Queries: ${queriesRun.length} (e.g. ${queryExamples}). ` +
        `Snippet domains: ${domainList}. ` +
        `Pages fetched: ${pagesFetched.length} [${pageStatusList}]. ` +
        `Page errors: ${meta.page_errors}. ${braveErrors.length} Brave queries errored.` +
        secondaryReasoningSuffix;
    }

    // ── Update job ────────────────────────────────────────────────────────────
    if (body.enrichment_job_id) {
      await sb.from('enrichment_jobs').update({
        status:       'completed',
        completed_at: new Date().toISOString(),
        raw_output: {
          outcome:          candidateIds.length > 0 ? 'candidates_found' : 'no_result',
          candidates_count: candidateIds.length,
          candidate_ids:    candidateIds,
          reasoning_summary,
          meta,
          runner:           'inline',
          elapsed_ms:       Date.now() - startedAt,
        },
      }).eq('id', body.enrichment_job_id);
    }

    await sb.from('enrichment_events').insert({
      lead_id:    body.lead_id,
      event_type: candidateIds.length > 0
        ? 'phone_candidates_found_by_openclaw'
        : 'unresolved_after_openclaw',
      stage:   'openclaw',
      payload: {
        source:            'enrichment_runner',
        reasoning_summary,
        candidate_ids:     candidateIds,
        meta,
      },
    });

    await sb.from('automation_events').insert({
      source:          'web_app',
      event_type:      'openclaw_callback_received',
      status:          'success',
      related_lead_id: body.lead_id,
      payload: {
        mode:             'deep_search',
        outcome:          candidateIds.length > 0 ? 'candidates_found' : 'no_result',
        candidates:       candidateIds.length,
        candidate_ids:    candidateIds,
        job_id:           body.enrichment_job_id ?? null,
        reasoning_summary,
        runner:           'inline',
      },
    });

    // ── Auto-attach events (additional row when at least one phone attached) ──
    if (anyAutoAttached) {
      const autoAttachPayload = {
        source:               'enrichment_runner',
        auto_attached_phones: autoAttachedPhones,
        auto_attached_ids:    autoAttachedPhoneIds,
        confidence:           finalCandidates
          .filter(fc => autoAttachedPhones.includes('+1' + fc.phone_raw.replace(/\D/g, '').slice(-10)))
          .map(fc => fc.confidence),
        source_url:           finalCandidates
          .filter(fc => autoAttachedPhones.includes('+1' + fc.phone_raw.replace(/\D/g, '').slice(-10)))
          .map(fc => fc.source_url),
        matched_on:           finalCandidates
          .filter(fc => autoAttachedPhones.includes('+1' + fc.phone_raw.replace(/\D/g, '').slice(-10)))
          .map(fc => fc.matched_on),
        reasoning_summary,
      };

      await sb.from('enrichment_events').insert({
        lead_id:    body.lead_id,
        event_type: 'phone_auto_attached',
        stage:      'openclaw',
        payload:    autoAttachPayload,
      });

      await sb.from('automation_events').insert({
        source:          'web_app',
        event_type:      'phone_auto_attached',
        status:          'success',
        related_lead_id: body.lead_id,
        payload:         autoAttachPayload,
      });
    }

    // ── Return ────────────────────────────────────────────────────────────────
    return NextResponse.json({
      ok:                true,
      outcome:           candidateIds.length > 0 ? 'candidates_found' : 'no_result',
      lead_status:       newLeadStatus,
      reasoning_summary,
      candidates:        finalCandidates,
      candidate_ids:     candidateIds,
      meta,
      elapsed_ms:        Date.now() - startedAt,
    });

  } catch (err) {
    const errorMsg = (err as Error).message ?? 'Unknown error in enrichment runner';

    // Attempt error recovery writes (best effort — don't throw again)
    try {
      if (body.enrichment_job_id) {
        await sb.from('enrichment_jobs').update({
          status:        'failed',
          completed_at:  new Date().toISOString(),
          error_message: errorMsg,
          raw_output: {
            outcome: 'runner_error',
            error:   errorMsg,
          },
        }).eq('id', body.enrichment_job_id);
      }

      await sb.from('enrichment_events').insert({
        lead_id:    body.lead_id,
        event_type: 'unresolved_after_openclaw',
        stage:      'openclaw',
        payload: {
          source:        'enrichment_runner',
          error:         errorMsg,
          outcome:       'runner_error',
        },
      });
    } catch {
      // Swallow DB errors in error handler
    }

    return NextResponse.json(
      { ok: false, error: errorMsg, outcome: 'runner_error' },
      { status: 500 },
    );
  }
}
