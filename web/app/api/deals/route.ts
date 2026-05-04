// GET  /api/deals        — list deals, optional ?stage= filter
// POST /api/deals        — create a new deal

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

// Default checklists when a new deal is created at a given stage
const DEFAULT_CHECKLISTS: Record<string, { id: string; label: string; done: boolean }[]> = {
  prospection: [
    { id: "info_owner",     label: "Infos propriétaire recueillies",         done: false },
    { id: "units_verified", label: "Nombre d'unités confirmé",               done: false },
    { id: "eval_checked",   label: "Évaluation municipale consultée",        done: false },
    { id: "first_contact",  label: "Premier contact initié",                 done: false },
  ],
  analyse: [
    { id: "revenus",        label: "Revenus bruts documentés",               done: false },
    { id: "depenses",       label: "Dépenses d'exploitation estimées",       done: false },
    { id: "taux_cap",       label: "Taux de capitalisation calculé",         done: false },
    { id: "visuelle",       label: "Inspection visuelle extérieure",         done: false },
    { id: "comparables",    label: "Comparables de vente analysés",          done: false },
  ],
  offre: [
    { id: "offre_redigee",  label: "Offre d'achat rédigée",                  done: false },
    { id: "offre_envoyee",  label: "Offre envoyée au vendeur",               done: false },
    { id: "conditions",     label: "Conditions d'inspection et financement", done: false },
    { id: "depot",          label: "Dépôt promis confirmé",                  done: false },
  ],
  due_diligence: [
    { id: "inspection",     label: "Inspection par entrepreneur complète",   done: false },
    { id: "baux",           label: "Baux des locataires révisés",            done: false },
    { id: "historique",     label: "Historique de revenus 3 ans",            done: false },
    { id: "taxes",          label: "Taxes municipales et scolaires OK",      done: false },
    { id: "juridique",      label: "Vérification cadastrale / titres",       done: false },
  ],
  financement: [
    { id: "banque_contact",  label: "Institution financière contactée",      done: false },
    { id: "evaluation",      label: "Évaluation bancaire commandée",         done: false },
    { id: "approbation",     label: "Approbation de financement reçue",      done: false },
    { id: "notaire",         label: "Notaire choisi et mandaté",             done: false },
  ],
  cloture: [
    { id: "acte_signe",     label: "Acte de vente signé chez le notaire",    done: false },
    { id: "cles_recues",    label: "Clés et documents reçus",                done: false },
    { id: "assurance",      label: "Assurance en vigueur dès la prise possession", done: false },
  ],
};

function buildDefaultChecklists(stage: string) {
  const checklists: Record<string, typeof DEFAULT_CHECKLISTS[string]> = {};
  const stageOrder = ["prospection", "analyse", "offre", "due_diligence", "financement", "cloture"];
  const currentIdx = stageOrder.indexOf(stage);
  for (let i = 0; i <= currentIdx; i++) {
    const s = stageOrder[i];
    if (DEFAULT_CHECKLISTS[s]) {
      checklists[s] = DEFAULT_CHECKLISTS[s].map(item => ({ ...item }));
    }
  }
  return checklists;
}

const CreateDeal = z.object({
  title:         z.string().min(1).max(300),
  stage:         z.enum(["prospection","analyse","offre","due_diligence","financement","cloture","abandonne"]).default("prospection"),
  address:       z.string().optional(),
  units:         z.number().int().positive().optional(),
  asking_price:  z.number().int().positive().optional(),
  offer_price:   z.number().int().positive().optional(),
  temperature:   z.enum(["froid","tiede","chaud"]).default("tiede"),
  priority:      z.enum(["low","medium","high"]).default("medium"),
  contact_name:  z.string().optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email().optional().or(z.literal("")),
  notes_deal:    z.string().optional(),
});

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const stage = url.searchParams.get("stage")?.trim();
  const q     = url.searchParams.get("q")?.trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10), 500);

  const sb = createSupabaseAdminClient();
  let query = sb
    .from("deals")
    .select("*")
    .not("stage", "eq", "abandonne")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (stage) query = query.eq("stage", stage);
  if (q)     query = query.or(`title.ilike.%${q}%,address.ilike.%${q}%,contact_name.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body;
  try { body = CreateDeal.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const stage = body.stage ?? "prospection";
  const checklists = buildDefaultChecklists(stage);

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("deals")
    .insert({
      title:         body.title,
      stage,
      address:       body.address       ?? null,
      units:         body.units         ?? null,
      asking_price:  body.asking_price  ?? null,
      offer_price:   body.offer_price   ?? null,
      temperature:   body.temperature   ?? "tiede",
      priority:      body.priority      ?? "medium",
      contact_name:  body.contact_name  ?? null,
      contact_phone: body.contact_phone ?? null,
      contact_email: body.contact_email ?? null,
      notes_deal:    body.notes_deal    ?? null,
      checklists,
      activities:    [{ id: crypto.randomUUID(), text: "Deal créé", time: new Date().toISOString() }],
      assigned_to:   user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data }, { status: 201 });
}
