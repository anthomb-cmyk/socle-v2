// Multi-property owner detection.
//
// refreshPortfolioFlags: bulk UPDATE that recomputes property_count and
//   is_portfolio_owner for all contacts in one SQL query.
//
// getPortfolioInfo: per-contact lookup of portfolio size and property list.

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioInfo {
  propertyCount: number;
  isPortfolio: boolean;
  properties: Array<{
    address: string;
    city: string | null;
    num_units: number | null;
  }>;
}

// ── refreshPortfolioFlags ────────────────────────────────────────────────────

/**
 * Bulk-update contacts.property_count, contacts.is_portfolio_owner and
 * contacts.portfolio_updated_at based on property_contacts where
 * relationship = 'owner'.
 *
 * Uses a single SQL RPC call for efficiency. Returns the count of rows
 * updated (contacts whose property_count changed).
 */
export async function refreshPortfolioFlags(
  sb: SupabaseClient,
): Promise<{ updated: number }> {
  // We call a raw SQL UPDATE via rpc. The SQL:
  //   UPDATE contacts c
  //   SET property_count      = sub.cnt,
  //       is_portfolio_owner  = (sub.cnt >= 3),
  //       portfolio_updated_at = now()
  //   FROM (
  //     SELECT pc.contact_id, COUNT(DISTINCT pc.property_id) AS cnt
  //     FROM property_contacts pc
  //     WHERE pc.relationship = 'owner'
  //     GROUP BY pc.contact_id
  //   ) sub
  //   WHERE c.id = sub.contact_id
  //     AND (c.property_count IS DISTINCT FROM sub.cnt)
  //
  // We wrap this in an rpc function call using execute_sql if available,
  // or fall back to performing the update via PostgREST's rpc endpoint.
  // Since we can't run arbitrary SQL directly from the JS client, we use
  // a two-step approach: fetch aggregated counts, then batch-update contacts.

  // Step 1: aggregate property counts per contact (owner relationships only)
  const { data: counts, error: countErr } = await sb
    .from("property_contacts")
    .select("contact_id, property_id")
    .eq("relationship", "owner");

  if (countErr) {
    console.error("[portfolio] property_contacts query failed:", countErr.message);
    return { updated: 0 };
  }

  // Aggregate in JS
  const countMap = new Map<string, number>();
  for (const row of (counts ?? []) as Array<{ contact_id: string; property_id: string }>) {
    if (!row.contact_id) continue;
    countMap.set(row.contact_id, (countMap.get(row.contact_id) ?? 0) + 1);
  }

  if (countMap.size === 0) return { updated: 0 };

  // Step 2: batch-update contacts
  const now = new Date().toISOString();
  let updated = 0;

  // Update in batches of 200 to avoid large payloads
  const entries = Array.from(countMap.entries());
  const BATCH = 200;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    for (const [contactId, cnt] of batch) {
      const { error } = await sb
        .from("contacts")
        .update({
          property_count: cnt,
          is_portfolio_owner: cnt >= 3,
          portfolio_updated_at: now,
        })
        .eq("id", contactId);
      if (!error) updated++;
    }
  }

  // Also zero out contacts that own no properties (had been owners but properties removed)
  // We only do this for contacts that currently have property_count > 0 but aren't in countMap
  const { data: nonZero } = await sb
    .from("contacts")
    .select("id")
    .gt("property_count", 0);

  for (const row of (nonZero ?? []) as Array<{ id: string }>) {
    if (!countMap.has(row.id)) {
      await sb
        .from("contacts")
        .update({
          property_count: 0,
          is_portfolio_owner: false,
          portfolio_updated_at: now,
        })
        .eq("id", row.id);
      updated++;
    }
  }

  return { updated };
}

// ── getPortfolioInfo ─────────────────────────────────────────────────────────

/**
 * For a single contact, return the cached portfolio flag + the list of
 * properties they own (joined through property_contacts).
 */
export async function getPortfolioInfo(
  contactId: string,
  sb: SupabaseClient,
): Promise<PortfolioInfo> {
  // Fetch the contact's cached fields first (fast path)
  const { data: contact } = await sb
    .from("contacts")
    .select("property_count, is_portfolio_owner")
    .eq("id", contactId)
    .single();

  const propertyCount = (contact as { property_count: number | null } | null)?.property_count ?? 0;
  const isPortfolio = (contact as { is_portfolio_owner: boolean | null } | null)?.is_portfolio_owner ?? false;

  // Fetch property list via junction table
  const { data: pcRows } = await sb
    .from("property_contacts")
    .select("properties ( address, city, num_units )")
    .eq("contact_id", contactId)
    .eq("relationship", "owner");

  type PcRow = {
    properties: { address: string | null; city: string | null; num_units: number | null } | null;
  };
  const properties = ((pcRows ?? []) as unknown as PcRow[])
    .filter(r => r.properties !== null)
    .map(r => ({
      address: r.properties!.address ?? "",
      city: r.properties!.city ?? null,
      num_units: r.properties!.num_units ?? null,
    }));

  return { propertyCount, isPortfolio, properties };
}
