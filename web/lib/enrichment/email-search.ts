export interface EmailSearchContext {
  full_name?: string | null;
  company_name?: string | null;
  secondary_name?: string | null;
  property_address?: string | null;
  property_city?: string | null;
  mailing_address?: string | null;
  mailing_city?: string | null;
  mailing_postal?: string | null;
}

export interface EmailCandidate {
  email: string;
  source_url: string;
  source_label: string;
  snippet: string;
  confidence: number;
  matched_on: string;
  search_query: string;
  source: "snippet" | "page";
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi;
const EMAIL_EXACT_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}$/i;

const BLOCKED_LOCAL_PARTS = new Set([
  "abuse",
  "donotreply",
  "do-not-reply",
  "no-reply",
  "noreply",
  "postmaster",
  "privacy",
  "security",
]);

const BLOCKED_DOMAINS = new Set([
  "domain.com",
  "email.com",
  "example.ca",
  "example.com",
  "example.org",
  "localhost",
  "test.com",
  "yourdomain.com",
]);

const COMPANY_STOP_TOKENS = new Set([
  "and",
  "compagnie",
  "corp",
  "corporation",
  "des",
  "du",
  "gestion",
  "groupe",
  "immobilier",
  "immeuble",
  "immeubles",
  "inc",
  "ltee",
  "ltd",
  "les",
  "senc",
  "services",
  "the",
]);

export function buildEmailQueries(lc: EmailSearchContext): string[] {
  const company = clean(lc.company_name);
  const fullName = clean(lc.full_name);
  const secondaryName = clean(lc.secondary_name);
  const city = clean(lc.mailing_city ?? lc.property_city);
  const mailingAddress = clean(lc.mailing_address);
  const postal = clean(lc.mailing_postal);

  const queries: string[] = [];
  const push = (q: string) => {
    const trimmed = q.trim().replace(/\s+/g, " ");
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  };

  if (company && city) push(`"${company}" "${city}" courriel`);
  if (company && city) push(`"${company}" "${city}" email`);
  if (company) push(`"${company}" contact courriel`);
  if (company) push(`"${company}" "nous joindre"`);
  if (fullName && company) push(`"${fullName}" "${company}" email`);
  if (fullName && city) push(`"${fullName}" "${city}" courriel`);
  if (secondaryName && company) push(`"${secondaryName}" "${company}" email`);
  if (mailingAddress && city) push(`"${mailingAddress}" "${city}" courriel`);
  if (mailingAddress && postal) push(`"${mailingAddress}" "${postal}" email`);
  if (company) push(`site:.ca "${company}" email`);

  return queries.slice(0, 10);
}

export function extractEmailsFromText(input: string): string[] {
  const text = deobfuscateEmailText(input);
  const emails = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(EMAIL_RE.source, EMAIL_RE.flags);

  while ((match = re.exec(text)) !== null) {
    const email = normalizeEmail(match[0]);
    if (email && isUsefulEmail(email)) emails.add(email);
  }

  return [...emails];
}

export function scoreEmailCandidate(args: {
  haystack: string;
  domain: string;
  email: string;
  context: EmailSearchContext;
  source: "snippet" | "page";
}): { score: number; reasons: string[] } {
  const text = normalizeForMatch(args.haystack);
  const reasons: string[] = [];
  let score = 20;

  const companyTokens = significantCompanyTokens(args.context.company_name);
  const nameTokens = significantNameTokens(args.context.full_name);
  const secondaryNameTokens = significantNameTokens(args.context.secondary_name);
  const domainNormalized = normalizeForMatch(args.domain).replace(/\s+/g, "");
  const emailDomain = args.email.split("@")[1] ?? "";
  const emailDomainRoot = emailDomain.split(".")[0] ?? "";

  const companyTextHit = companyTokens.some((token) => text.includes(token));
  const nameTextHit = [...nameTokens, ...secondaryNameTokens].some((token) => text.includes(token));
  const companyDomainHit = companyTokens.some((token) => {
    if (token.length < 4) return false;
    return domainNormalized.includes(token) || emailDomainRoot.includes(token);
  });

  if (companyTextHit) {
    score += 25;
    reasons.push("company_name");
  }
  if (nameTextHit) {
    score += 20;
    reasons.push("contact_name");
  }
  if (companyDomainHit) {
    score += 25;
    reasons.push("company_domain");
  }

  const addressFragment = trailingAddressFragment(args.context.mailing_address);
  if (addressFragment && text.includes(addressFragment)) {
    score += 20;
    reasons.push("mailing_address");
  }

  const city = normalizeForMatch(args.context.mailing_city ?? args.context.property_city ?? "");
  if (city && text.includes(city)) {
    score += 15;
    reasons.push("city");
  }

  const postalPrefix = normalizeForMatch(args.context.mailing_postal ?? "").replace(/\s+/g, "").slice(0, 3);
  if (postalPrefix && text.replace(/\s+/g, "").includes(postalPrefix)) {
    score += 15;
    reasons.push("postal_prefix");
  }

  if (sameDomain(args.domain, emailDomain)) {
    score += 10;
    reasons.push("same_page_domain");
  }

  if (args.source === "page") {
    score += 10;
    reasons.push("fetched_page");
  }

  const localPart = args.email.split("@")[0] ?? "";
  if (/^(info|contact|admin|vente|sales|location|bureau)$/.test(localPart)) {
    score += 5;
    reasons.push("business_mailbox");
  }

  if (reasons.length === 0) score -= 10;

  return { score: clampScore(score), reasons };
}

export function contextAroundEmail(text: string, email: string, radius = 120): string {
  const normalizedText = deobfuscateEmailText(text);
  const index = normalizedText.toLowerCase().indexOf(email.toLowerCase());
  if (index === -1) return normalizedText.slice(0, radius * 2).trim();
  const start = Math.max(0, index - radius);
  const end = Math.min(normalizedText.length, index + email.length + radius);
  return normalizedText.slice(start, end).replace(/\s+/g, " ").trim();
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeEmail(raw: string): string | null {
  const email = raw
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[),.;:!?]+$/g, "")
    .toLowerCase();
  if (!EMAIL_EXACT_RE.test(email)) return null;
  return email;
}

function isUsefulEmail(email: string): boolean {
  const [local, domain] = email.split("@");
  if (!local || !domain) return false;
  if (BLOCKED_LOCAL_PARTS.has(local)) return false;
  if (BLOCKED_DOMAINS.has(domain)) return false;
  if (domain.endsWith(".test") || domain.endsWith(".invalid")) return false;
  if (/\.(png|jpe?g|gif|webp|svg|ico|css|js)$/i.test(domain)) return false;
  return true;
}

function deobfuscateEmailText(input: string): string {
  return input
    .replace(/&commat;/gi, "@")
    .replace(/\s*(?:\[|\()at(?:\]|\))\s*/gi, "@")
    .replace(/\s*(?:\[|\()dot(?:\]|\))\s*/gi, ".")
    .replace(/\s*(?:\[|\()point(?:\]|\))\s*/gi, ".");
}

function normalizeForMatch(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function significantCompanyTokens(value: string | null | undefined): string[] {
  return normalizeForMatch(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !COMPANY_STOP_TOKENS.has(token));
}

function significantNameTokens(value: string | null | undefined): string[] {
  return normalizeForMatch(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function trailingAddressFragment(value: string | null | undefined): string | null {
  const tokens = normalizeForMatch(value).split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return tokens.slice(-2).join(" ");
}

function sameDomain(pageDomain: string, emailDomain: string): boolean {
  const page = pageDomain.replace(/^www\./, "").toLowerCase();
  const email = emailDomain.replace(/^www\./, "").toLowerCase();
  return page === email || page.endsWith(`.${email}`) || email.endsWith(`.${page}`);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
