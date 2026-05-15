import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CallerAppShell from "@/components/caller/CallerAppShell";
import PhoneReviewClient, { type PhoneCandidate } from "./PhoneReviewClient";
import PhoneReviewHeader from "./PhoneReviewHeader";
import PhoneReviewRules from "./PhoneReviewRules";
import NextStepBanner from "@/components/next-step-banner";

export const revalidate = 0;

export default async function PhoneReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();

  const params = await searchParams;
  const justApproved = params["_just_approved"] === "1";
  const importJobId = typeof params.import_job_id === "string" ? params.import_job_id.trim() : "";

  let candidatesQuery = sb
    .from("phone_candidates")
    .select(`
        id,
        lead_id,
        phone_raw,
        phone_e164,
        stage,
        matched_on,
        search_query,
        candidate_name,
        candidate_address,
        source_label,
        source_url,
        snippet,
        initial_confidence,
        openclaw_verdict,
        openclaw_confidence,
        openclaw_evidence,
        openclaw_reasoning,
        candidate_status,
        review_reason,
        gate_results,
        source_class,
        created_at,
        leads!inner (
          id,
          status,
          source_import_job_id,
          campaign_id,
          campaigns ( name ),
          properties ( id, address, city, num_units ),
          contacts (
            id,
            full_name,
            company_name,
            mailing_address,
            mailing_city,
            mailing_postal
          )
        )
      `)
    .in("candidate_status", ["needs_anthony_review", "weak_review"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (importJobId) {
    candidatesQuery = candidatesQuery.eq("leads.source_import_job_id", importJobId);
  }

  const [candidatesRes, readyRes, importRes] = await Promise.all([
    candidatesQuery,
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "ready_to_call"),
    importJobId
      ? sb.from("import_jobs").select("id,file_name").eq("id", importJobId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (candidatesRes.error) {
    return (
      <CallerAppShell width="narrow">
        <p style={{ color: "var(--so-danger)" }}>
          Failed to load review queue: {candidatesRes.error.message}
        </p>
      </CallerAppShell>
    );
  }

  const rawCandidates = (candidatesRes.data ?? []) as unknown as PhoneCandidate[];
  const importLabel = importJobId
    ? (importRes.data as { file_name?: string | null } | null)?.file_name ?? `Import ${importJobId.slice(0, 8)}`
    : null;
  const propertyIds = [
    ...new Set(
      rawCandidates
        .map((candidate) => candidate.leads?.properties?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const neqs = [
    ...new Set(
      rawCandidates
        .map((candidate) => candidate.snippet?.match(/\((\d{10})\)/)?.[1] ?? null)
        .filter((neq): neq is string => Boolean(neq)),
    ),
  ];

  const [ownerLinksRes, directorsRes] = await Promise.all([
    propertyIds.length > 0
      ? sb
          .from("property_contacts")
          .select("property_id, contacts ( id, full_name, company_name )")
          .in("property_id", propertyIds)
          .eq("relationship", "owner")
      : Promise.resolve({ data: [], error: null }),
    neqs.length > 0
      ? sb
          .from("req_directors")
          .select("neq, full_name")
          .in("neq", neqs)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const ownerNamesByProperty = new Map<string, string[]>();
  for (const row of ownerLinksRes.data ?? []) {
    const link = row as {
      property_id?: string | null;
      contacts?: { full_name?: string | null; company_name?: string | null } | null;
    };
    if (!link.property_id) continue;
    const name = link.contacts?.full_name?.trim() || link.contacts?.company_name?.trim() || "";
    if (!name) continue;
    ownerNamesByProperty.set(link.property_id, [
      ...(ownerNamesByProperty.get(link.property_id) ?? []),
      name,
    ]);
  }

  const directorNamesByNeq = new Map<string, string[]>();
  for (const row of directorsRes.data ?? []) {
    const director = row as { neq?: string | null; full_name?: string | null };
    if (!director.neq || !director.full_name?.trim()) continue;
    directorNamesByNeq.set(director.neq, [
      ...(directorNamesByNeq.get(director.neq) ?? []),
      director.full_name.trim(),
    ]);
  }

  const candidates = rawCandidates.map((candidate) => {
    const propertyId = candidate.leads?.properties?.id;
    const neq = candidate.snippet?.match(/\((\d{10})\)/)?.[1] ?? null;
    return {
      ...candidate,
      co_owner_names: propertyId ? [...new Set(ownerNamesByProperty.get(propertyId) ?? [])] : [],
      req_director_names: neq ? [...new Set(directorNamesByNeq.get(neq) ?? [])] : [],
    };
  });
  const readyCount = readyRes.count ?? 0;

  return (
    <CallerAppShell width="wide">
      {justApproved && (
        <NextStepBanner
          kind="review_done"
          counts={{ ready: readyCount, review: 0, hotSellers: 0 }}
        />
      )}

      <PhoneReviewHeader candidateCount={candidates.length} importLabel={importLabel} />

      {candidates.length > 0 && <PhoneReviewRules />}

      <PhoneReviewClient initialCandidates={candidates} importJobId={importJobId || null} />
    </CallerAppShell>
  );
}
