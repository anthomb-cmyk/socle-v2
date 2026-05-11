// POST /api/quick-call/convert/:callLogId
//
// Converts a quick-call call_log into a real lead by:
//   1. Creating a contacts row (first_name, last_name)
//   2. Creating a phones row linked to that contact (phone from call_log raw)
//   3. Creating a properties row (street address if given, or placeholder)
//   4. Creating a leads row (status=ready_to_call, assigned to caller)
//   5. Updating the existing call_log to link lead_id, contact_id, phone_id
//
// On any insert failure the handler tries to roll back partial work so we
// don't end up with orphaned rows.
//
// Body: { first_name, last_name, street?, city?, postal_code?, notes?, intent? }
// Returns: { ok: true, data: { leadId } }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/twilio";

const Body = z.object({
  first_name:  z.string().min(1, "Le prénom est requis"),
  last_name:   z.string().min(1, "Le nom est requis"),
  street:      z.string().optional(),
  city:        z.string().optional(),
  postal_code: z.string().optional(),
  notes:       z.string().optional(),
  intent:      z.enum(["cold", "warm", "hot"]).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ callLogId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { callLogId } = await ctx.params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Données invalides", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  // ── Look up the call_log ──────────────────────────────────────────────────
  const { data: callLog } = await sb
    .from("call_logs")
    .select("id, user_id, lead_id, raw")
    .eq("id", callLogId)
    .single();

  if (!callLog) {
    return NextResponse.json({ ok: false, error: "Journal d'appel non trouvé" }, { status: 404 });
  }

  // Only admin or the caller who made this call can convert it
  if (auth.role !== "admin" && callLog.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });
  }

  if (callLog.lead_id) {
    return NextResponse.json(
      { ok: false, error: "Cet appel a déjà été converti en lead", data: { leadId: callLog.lead_id } },
      { status: 409 },
    );
  }

  // Extract the phone number from raw JSONB
  const raw = (callLog.raw as Record<string, unknown> | null) ?? {};
  const phoneE164Raw = (raw.phone_e164 as string | undefined) ?? (raw.lead_phone as string | undefined) ?? "";
  const phoneE164 = normalizePhone(phoneE164Raw);

  if (!phoneE164) {
    return NextResponse.json(
      { ok: false, error: "Numéro de téléphone introuvable dans le journal d'appel" },
      { status: 400 },
    );
  }

  // ── Rollback tracker ─────────────────────────────────────────────────────
  let contactId: string | null = null;
  let phoneId: string | null = null;
  let propertyId: string | null = null;
  let leadId: string | null = null;

  async function rollback() {
    if (leadId)     await sb.from("leads").delete().eq("id", leadId);
    if (propertyId) await sb.from("properties").delete().eq("id", propertyId);
    if (phoneId)    await sb.from("phones").delete().eq("id", phoneId);
    if (contactId)  await sb.from("contacts").delete().eq("id", contactId);
  }

  try {
    // ── 1. Create contact ───────────────────────────────────────────────────
    const firstName = body.first_name.trim();
    const lastName  = body.last_name.trim();
    const fullName  = `${firstName} ${lastName}`.trim();

    const { data: contact, error: contactErr } = await sb
      .from("contacts")
      .insert({
        kind:       "person",
        first_name: firstName,
        last_name:  lastName,
        full_name:  fullName,
        source:     "quick_call",
        notes:      body.notes?.trim() || null,
      })
      .select("id")
      .single();

    if (contactErr || !contact) {
      throw new Error(`contact: ${contactErr?.message ?? "insert failed"}`);
    }
    contactId = contact.id as string;

    // ── 2. Create phone ─────────────────────────────────────────────────────
    // Format a human-readable display number (e.g. (514) 555-1234)
    const digits = phoneE164.replace(/\D/g, "");
    let display = phoneE164;
    if (digits.length === 11 && digits[0] === "1") {
      display = `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
    } else if (digits.length === 10) {
      display = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    }

    const { data: phone, error: phoneErr } = await sb
      .from("phones")
      .insert({
        contact_id: contactId,
        e164:       phoneE164,
        display,
        status:     "unverified",
        source:     "manual",
        confidence: 90,
        evidence:   "quick_call — numéro composé manuellement",
      })
      .select("id")
      .single();

    if (phoneErr || !phone) {
      throw new Error(`phone: ${phoneErr?.message ?? "insert failed"}`);
    }
    phoneId = phone.id as string;

    // ── 3. Create property ─────────────────────────────────────────────────
    // leads.property_id is NOT NULL so we always need one.
    // Use provided address or a placeholder so the lead is still useful.
    const streetProvided = body.street?.trim();
    const cityProvided   = body.city?.trim();
    const address        = streetProvided || "Adresse inconnue";

    const { data: property, error: propertyErr } = await sb
      .from("properties")
      .insert({
        address,
        city:        cityProvided || null,
        postal_code: body.postal_code?.trim() || null,
        source:      "quick_call",
      })
      .select("id")
      .single();

    if (propertyErr || !property) {
      throw new Error(`property: ${propertyErr?.message ?? "insert failed"}`);
    }
    propertyId = property.id as string;

    // ── 4. Create lead ──────────────────────────────────────────────────────
    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .insert({
        property_id: propertyId,
        contact_id:  contactId,
        status:      "ready_to_call",
        source:      "quick_call",
        assigned_to: user.id,
        notes:       body.notes?.trim() || null,
        priority:    body.intent === "hot" ? 85 : body.intent === "warm" ? 60 : 40,
      })
      .select("id")
      .single();

    if (leadErr || !lead) {
      throw new Error(`lead: ${leadErr?.message ?? "insert failed"}`);
    }
    leadId = lead.id as string;

    // ── 5. Update call_log to link the new lead ─────────────────────────────
    await sb
      .from("call_logs")
      .update({
        lead_id:    leadId,
        contact_id: contactId,
        phone_id:   phoneId,
      })
      .eq("id", callLogId);

    return NextResponse.json({ ok: true, data: { leadId } });

  } catch (err) {
    // Roll back any rows created so far
    await rollback();
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "Conversion échouée" },
      { status: 500 },
    );
  }
}
