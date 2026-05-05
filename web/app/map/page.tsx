import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

// Google Maps search URL from an address + city
function mapsUrl(address: string, city: string | null) {
  const q = encodeURIComponent([address, city, "QC", "Canada"].filter(Boolean).join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  new:              { label: "Nouveau",       color: "var(--crm-text3)" },
  ready_to_call:    { label: "À appeler",     color: "var(--crm-amber)" },
  in_outreach:      { label: "Contacté",      color: "var(--crm-blue)" },
  no_answer:        { label: "Sans réponse",  color: "var(--crm-text3)" },
  meeting_set:      { label: "RDV fixé",      color: "#5B21B6" },
  qualified:        { label: "Qualifié",      color: "var(--crm-green)" },
  phone_verified:   { label: "Tél. vérifié",  color: "var(--crm-green)" },
  rejected:         { label: "Fermé",         color: "var(--crm-text3)" },
  do_not_contact:   { label: "DNC",           color: "var(--crm-red)" },
};

export default async function MapPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();

  // Fetch leads_view joined with property data (leads_view already includes address, city, num_units)
  // For admin: all leads; for caller: their assigned leads
  let q = sb
    .from("leads_view")
    .select("lead_id, full_name, company_name, address, city, num_units, status, best_phone, assigned_to, lat, lng")
    .not("status", "in", "(rejected,do_not_contact)")
    .order("city", { ascending: true })
    .order("address", { ascending: true })
    .limit(1000);

  if (role !== "admin") q = q.eq("assigned_to", user.id);

  const { data: rawLeads } = await q;

  type LeadRow = {
    lead_id: string;
    full_name: string | null;
    company_name: string | null;
    address: string;
    city: string | null;
    num_units: number | null;
    status: string;
    best_phone: string | null;
    assigned_to: string | null;
    lat: number | null;
    lng: number | null;
  };

  const leads = (rawLeads ?? []) as LeadRow[];

  // Check if any coordinates exist
  const withCoords = leads.filter(l => l.lat != null && l.lng != null);
  const hasCoords = withCoords.length > 0;

  // Group by city
  const byCityMap = new Map<string, LeadRow[]>();
  for (const l of leads) {
    const key = l.city ?? "(ville inconnue)";
    if (!byCityMap.has(key)) byCityMap.set(key, []);
    byCityMap.get(key)!.push(l);
  }

  // Sort cities by count desc
  const cities = [...byCityMap.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  const totalLeads = leads.length;
  const totalCities = cities.length;

  // City summary data for tiles
  const citySummary = cities.map(([city, items]) => ({
    city,
    total: items.length,
    callable: items.filter(l => ["ready_to_call","in_outreach","no_answer","phone_verified"].includes(l.status)).length,
    withPhone: items.filter(l => l.best_phone).length,
  }));

  return (
    <main className="crm-page">

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 className="crm-page-title">Carte des propriétés</h1>
          <p className="crm-page-sub">
            {totalLeads === 0
              ? "Aucune propriété à afficher."
              : <>{totalLeads} propriété{totalLeads > 1 ? "s" : ""} dans {totalCities} ville{totalCities > 1 ? "s" : ""}
                  {hasCoords && <> &middot; {withCoords.length} avec coordonnées GPS</>}
                </>
            }
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/leads" className="crm-btn">Voir leads</Link>
          <Link href="/import" className="crm-btn crm-btn-dark">Import rôle</Link>
        </div>
      </div>

      {/* ── Coordinate status banner ── */}
      {!hasCoords && totalLeads > 0 && (
        <div style={{
          background: "var(--crm-gold-light)",
          border: "1px solid var(--crm-gold-border)",
          borderLeft: "4px solid var(--crm-gold)",
          borderRadius: 10,
          padding: "12px 18px",
          marginBottom: 20,
          fontSize: 13,
          color: "#7A5200",
          fontWeight: 500,
        }}>
          <strong>Coordonnées GPS non disponibles</strong> — Les propriétés n&rsquo;ont pas encore été géocodées.
          Utilisez les liens <strong>Google Maps</strong> ci-dessous pour ouvrir chaque adresse directement.
        </div>
      )}

      {totalLeads === 0 ? (
        <div className="crm-card">
          <div className="crm-empty-state">
            
            <p className="crm-empty-state-title">Aucune propriété</p>
            <p className="crm-empty-state-sub">Importez un rôle d&rsquo;évaluation pour commencer à visualiser les propriétés.</p>
          </div>
        </div>
      ) : (
        <>
          {/* ── City summary tiles ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 24 }}>
            {citySummary.slice(0, 12).map(cs => (
              <a
                key={cs.city}
                href={`#city-${encodeURIComponent(cs.city)}`}
                style={{ textDecoration: "none" }}
              >
                <div className="crm-tile" style={{ padding: "13px 16px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--crm-text)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cs.city}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--crm-text)", lineHeight: 1, marginBottom: 4 }}>{cs.total}</div>
                  <div style={{ fontSize: 11, color: "var(--crm-text2)" }}>
                    {cs.callable > 0 && <span style={{ color: "var(--crm-blue)", fontWeight: 700 }}>{cs.callable} appelables</span>}
                    {cs.callable > 0 && cs.withPhone > 0 && <span style={{ color: "var(--crm-text3)" }}> · </span>}
                    {cs.withPhone > 0 && <span style={{ color: "var(--crm-green)", fontWeight: 600 }}>{cs.withPhone} tél.</span>}
                    {cs.callable === 0 && cs.withPhone === 0 && <span style={{ color: "var(--crm-text3)" }}>Aucun appelable</span>}
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* ── Per-city property lists ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {cities.map(([city, items]) => (
              <section key={city} id={`city-${encodeURIComponent(city)}`}>
                {/* City header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, paddingBottom: 10, borderBottom: "2px solid var(--crm-card-border)" }}>
                  <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--crm-text)", margin: 0, flex: 1 }}>{city}</h2>
                  <span style={{ fontSize: 10, fontWeight: 700, background: "var(--crm-bg-alt)", color: "var(--crm-text2)", border: "1px solid var(--crm-card-border)", borderRadius: 999, padding: "2px 9px" }}>
                    {items.length} propriété{items.length > 1 ? "s" : ""}
                  </span>
                  {/* Open entire city in Google Maps */}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city + " QC Canada immeuble")}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "var(--crm-blue)", fontWeight: 600, textDecoration: "none" }}
                  >
                    Voir sur Maps →
                  </a>
                </div>

                {/* Property table */}
                <div className="crm-card" style={{ overflow: "hidden", padding: 0 }}>
                  {/* Header row */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 130px 90px 110px 80px",
                    gap: 0,
                    padding: "9px 16px",
                    background: "var(--crm-bg-alt)",
                    borderBottom: "1px solid var(--crm-card-border)",
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.9px", textTransform: "uppercase", color: "var(--crm-text3)",
                    alignItems: "center",
                  }}>
                    <div>Adresse · Propriétaire</div>
                    <div>Téléphone</div>
                    <div style={{ textAlign: "center" }}>Unités</div>
                    <div>Statut</div>
                    <div style={{ textAlign: "right" }}>Maps</div>
                  </div>

                  {items.map((l, idx) => {
                    const owner = l.full_name ?? l.company_name ?? null;
                    const sc = STATUS_CFG[l.status] ?? { label: l.status, color: "var(--crm-text3)" };

                    return (
                      <div
                        key={l.lead_id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0,1fr) 130px 90px 110px 80px",
                          gap: 0,
                          padding: "12px 16px",
                          borderTop: idx === 0 ? "none" : "1px solid var(--crm-card-border)",
                          alignItems: "center",
                        }}
                      >
                        {/* Address + Owner */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--crm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <Link href={`/leads/${l.lead_id}` as never} style={{ color: "var(--crm-text)", textDecoration: "none" }}>
                              {l.address}
                            </Link>
                          </div>
                          {owner && (
                            <div style={{ fontSize: 11, color: "var(--crm-text3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {owner}
                            </div>
                          )}
                        </div>

                        {/* Phone */}
                        <div>
                          {l.best_phone ? (
                            <a href={`tel:${l.best_phone.replace(/\D/g, "")}`} className="crm-phone-link" style={{ fontSize: 12 }}>
                              {l.best_phone}
                            </a>
                          ) : (
                            <span className="crm-no-phone">sans tél.</span>
                          )}
                        </div>

                        {/* Units */}
                        <div style={{ textAlign: "center" }}>
                          {l.num_units != null ? (
                            <span className="crm-chip crm-chip-units" style={{ fontSize: 11 }}>{l.num_units}&thinsp;u.</span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--crm-text3)" }}>—</span>
                          )}
                        </div>

                        {/* Status */}
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: sc.color }}>
                            {sc.label}
                          </span>
                        </div>

                        {/* Google Maps link */}
                        <div style={{ textAlign: "right" }}>
                          <a
                            href={mapsUrl(l.address, l.city)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Ouvrir ${l.address} dans Google Maps`}
                            style={{ fontSize: 12, color: "var(--crm-blue)", fontWeight: 600, textDecoration: "none", background: "var(--crm-blue-light)", borderRadius: 6, padding: "3px 8px", display: "inline-block" }}
                          >
                            Maps
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
