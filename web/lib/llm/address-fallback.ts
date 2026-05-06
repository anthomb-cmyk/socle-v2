// LLM fallback for the Quebec address parser.
//
// Called when parseQuebecAddress() returns a non-"complete" quality result.
// Sends the raw address string to Claude Haiku and asks it to extract the
// structured fields. Returns null on any failure so the caller can degrade
// gracefully without touching the deterministic result.
//
// All calls go through lib/llm/anthropic-client.ts so cost is logged
// automatically into llm_usage_log under feature "address_fallback".

import type { ParsedAddress } from "@/lib/enrichment/types";
import { callAnthropic, parseFirstJson } from "@/lib/llm/anthropic-client";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

interface LlmAddressJson {
  civic_number?: string | null;
  civic_range?: string | null;
  street_name?: string | null;
  unit?: string | null;
  city?: string | null;
  province?: string | null;
  postal?: string | null;
  unparseable?: boolean;
}

const SYSTEM = `You are a Canadian address parser specialized in Quebec addresses.
Extract structured components from a free-form address string.
Be permissive: handle Quebec, Ontario, New Brunswick, Nova Scotia, PEI, Manitoba, Alberta, BC, and US addresses.
Return ONLY a JSON object, no prose.`;

const PROMPT_TEMPLATE = (rawAddress: string) =>
  `Parse this address and return JSON with these fields:
- civic_number: string|null  — the building/house number (e.g. "3720"); use the smaller number for ranges
- civic_range: string|null   — civic range form like "189-197"; null if not a range
- street_name: string|null   — the street name including type (e.g. "Avenue Kent", "Rue Notre-Dame Est")
- unit: string|null          — apartment/unit/bureau number if present (e.g. "408", "12")
- city: string|null          — city or municipality name
- province: string|null      — 2-letter Canadian province code (QC, ON, NB, NS, PE, MB, AB, BC, …) or US state abbrev
- postal: string|null        — Canadian postal code formatted as "XXX YXY" (e.g. "H3S 1N3"); US ZIP as-is
- unparseable: boolean       — true only if the input is completely unrecognizable as an address

Address to parse: "${rawAddress}"

Respond with EXACTLY this JSON, no prose:
{"civic_number": ..., "civic_range": ..., "street_name": ..., "unit": ..., "city": ..., "province": ..., "postal": ..., "unparseable": ...}`;

/** LLM fallback address parser.
 *  Returns null if the API key is not set, the call fails, or Haiku marks the
 *  address as unparseable.
 *
 *  When parserOutput is provided (what the deterministic parser produced) and
 *  the LLM succeeds, a row is inserted into address_parse_corrections so we
 *  can improve the regex later. Fire-and-forget — never blocks. */
export async function llmParseAddress(
  rawAddress: string,
  opts: { leadId?: string; parserOutput?: ParsedAddress | null; contactId?: string } = {},
): Promise<ParsedAddress | null> {
  if (!rawAddress || !rawAddress.trim()) return null;

  const result = await callAnthropic({
    feature: "address_fallback",
    model: "claude-haiku-4-5",
    maxTokens: 300,
    system: SYSTEM,
    prompt: PROMPT_TEMPLATE(rawAddress.trim()),
    leadId: opts.leadId,
    metadata: { raw_address: rawAddress },
  });

  if (!result.ok || !result.text) return null;

  const parsed = parseFirstJson<LlmAddressJson>(result.text);
  if (!parsed) return null;
  if (parsed.unparseable) return null;

  // Normalise postal code to "XXX YXY" format if it came back as "XXXYYY".
  const postalRaw = typeof parsed.postal === "string" ? parsed.postal.trim().toUpperCase() : null;
  const postal = normalizePostal(postalRaw);
  const postalFsa = postal ? postal.slice(0, 3) : null;

  // Normalise province to uppercase 2-letter code.
  const province = parsed.province ? parsed.province.toUpperCase().trim().slice(0, 2) : null;

  const addressResult: ParsedAddress = {
    raw: rawAddress,
    civicNumber: parsed.civic_number?.trim() || null,
    civicRange: parsed.civic_range?.trim() || null,
    streetName: parsed.street_name?.trim() || null,
    unit: parsed.unit?.trim() || null,
    city: parsed.city?.trim() || null,
    province,
    postal,
    postalFsa,
  };

  // Fire-and-forget: log to address_parse_corrections when the deterministic
  // parser failed (parserOutput provided) so we can improve regexes later.
  // Never block — any DB error is caught and discarded.
  if (opts.parserOutput !== undefined) {
    void (async () => {
      try {
        const adminSb = createSupabaseAdminClient();
        await adminSb.from("address_parse_corrections").insert({
          raw_input:    rawAddress,
          parser_output: opts.parserOutput ?? null,
          llm_output:   addressResult,
          contact_id:   opts.contactId ?? null,
        });
      } catch {
        // Never break the LLM flow on logging failure.
      }
    })();
  }

  return addressResult;
}

/** Ensure "H3S1N3" → "H3S 1N3"; already-spaced "H3S 1N3" passes through. */
function normalizePostal(raw: string | null): string | null {
  if (!raw) return null;
  const clean = raw.replace(/\s/g, "").toUpperCase();
  if (/^[A-CEGHJ-NPR-TVXY]\d[A-CEGHJ-NPR-TV-Z]\d[A-CEGHJ-NPR-TV-Z]\d$/.test(clean)) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  // Already spaced or some other form — return as-is if non-empty.
  return raw.trim() || null;
}
