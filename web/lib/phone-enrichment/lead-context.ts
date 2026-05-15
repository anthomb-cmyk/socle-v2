import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadContext } from "@/lib/enrichment/types";

type LeadJoined = {
  id: string;
  contact_id: string;
  status: string;
  properties: {
    address: string;
    city: string | null;
    matricule: string | null;
    num_units: number | null;
  } | null;
  contacts: {
    id: string;
    full_name: string | null;
    company_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
  } | null;
};

export function buildLeadContextFromJoinedLead(lead: LeadJoined, enrichmentJobId: string): LeadContext {
  const rawFullName = lead.contacts?.full_name ?? null;
  let primaryName: string | null = rawFullName;
  let secondaryName: string | null = null;

  if (rawFullName) {
    const sep = rawFullName.match(/\s*[\/|]\s*|\s+et\s+|\s+and\s+/i);
    if (sep?.index !== undefined) {
      primaryName = rawFullName.slice(0, sep.index).trim() || null;
      secondaryName = rawFullName.slice(sep.index + sep[0].length).trim() || null;
    }
  }

  return {
    leadId: lead.id,
    contactId: lead.contact_id,
    enrichmentJobId,
    fullName: primaryName,
    companyName: lead.contacts?.company_name ?? null,
    secondaryName,
    propertyAddress: lead.properties?.address ?? null,
    propertyCity: lead.properties?.city ?? null,
    mailingAddress: lead.contacts?.mailing_address ?? null,
    mailingCity: lead.contacts?.mailing_city ?? null,
    mailingPostal: lead.contacts?.mailing_postal ?? null,
    matricule: lead.properties?.matricule ?? null,
    numUnits: lead.properties?.num_units ?? null,
  };
}

export async function loadLeadContext(
  sb: SupabaseClient,
  leadId: string,
  enrichmentJobId: string,
): Promise<LeadContext | null> {
  const { data, error } = await sb
    .from("leads")
    .select(`
      id, contact_id, status,
      properties ( address, city, matricule, num_units ),
      contacts ( id, full_name, company_name, mailing_address, mailing_city, mailing_postal )
    `)
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return buildLeadContextFromJoinedLead(data as unknown as LeadJoined, enrichmentJobId);
}
