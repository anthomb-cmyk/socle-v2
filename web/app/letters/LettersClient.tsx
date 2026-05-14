"use client";

import { useEffect, useMemo, useState } from "react";

type Campaign = {
  id: string;
  name: string;
  city: string | null;
  mailed_at: string | null;
  source_file: string | null;
  stats: {
    sent: number;
    called: number;
    interested: number;
    maybe: number;
    notInterested: number;
    bad: number;
    buildings: number;
    units: number;
  };
};

type LetterProperty = {
  id: string;
  matricule: string | null;
  address: string;
  city: string | null;
  postal_code: string | null;
  num_units: number | null;
  cadastre: string | null;
  property_type: string | null;
  evaluation_total: number | null;
};

type Interaction = {
  id: string;
  outcome: string;
  notes: string | null;
  next_action: string | null;
  follow_up_at: string | null;
  created_at: string;
};

type Recipient = {
  recipient_id: string;
  campaign_id: string;
  owner_name: string;
  original_owner_name: string | null;
  company_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_postal: string | null;
  phone_display: string | null;
  bucket: string;
  property_count: number;
  total_units: number | null;
  status: string;
  last_outcome: string | null;
  last_interaction_at: string | null;
  score: number;
  campaign: { id: string; name: string; city: string | null; mailed_at: string | null } | null;
  properties: LetterProperty[];
  interactions: Interaction[];
};

const OUTCOMES = [
  { id: "interested", label: "Interested" },
  { id: "wants_offer", label: "Wants offer" },
  { id: "meeting_booked", label: "Meeting" },
  { id: "maybe_later", label: "Maybe later" },
  { id: "not_interested", label: "No" },
  { id: "wrong_person", label: "Wrong person" },
  { id: "bad_address", label: "Bad address" },
  { id: "do_not_contact", label: "DNC" },
];

function pct(n: number, d: number): string {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-CA", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMoney(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString("fr-CA")}`;
}

export default function LettersClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingOutcome, setSavingOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const selected = useMemo(
    () => results.find((recipient) => recipient.recipient_id === selectedId) ?? results[0] ?? null,
    [results, selectedId],
  );
  const activeCampaign = campaigns.find((campaign) => campaign.id === campaignId) ?? campaigns[0] ?? null;

  async function loadCampaigns() {
    const res = await fetch("/api/letters/campaigns", { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) return;
    const nextCampaigns = json.data.campaigns as Campaign[];
    setCampaigns(nextCampaigns);
    if (!campaignId && nextCampaigns[0]) setCampaignId(nextCampaigns[0].id);
  }

  async function search(nextQ = q, nextCampaignId = campaignId) {
    setLoading(true);
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextCampaignId) params.set("campaignId", nextCampaignId);
    const res = await fetch(`/api/letters/search?${params.toString()}`, { cache: "no-store" });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) return;
    const nextResults = json.data.recipients as Recipient[];
    setResults(nextResults);
    setSelectedId(nextResults[0]?.recipient_id ?? null);
  }

  async function saveOutcome(outcome: string) {
    if (!selected) return;
    setSavingOutcome(outcome);
    const res = await fetch("/api/letters/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientId: selected.recipient_id,
        outcome,
        notes: note.trim() || null,
      }),
    });
    setSavingOutcome(null);
    const json = await res.json();
    if (!json.ok) return;
    setNote("");
    await Promise.all([loadCampaigns(), search()]);
  }

  useEffect(() => {
    loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    const timer = window.setTimeout(() => search(q, campaignId), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, campaignId]);

  return (
    <div className="letters-grid">
      <section className="letters-panel letters-panel--search">
        <div className="letters-controls">
          <label className="letters-field">
            <span>Round</span>
            <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
          <label className="letters-field letters-field--grow">
            <span>Smart search</span>
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Try: Gille Tangay, 105 route 137, Cascades, 4551-86…"
              autoFocus
            />
          </label>
        </div>

        {activeCampaign && (
          <div className="letters-stats">
            <div><span>{activeCampaign.stats.sent}</span><small>letters sent</small></div>
            <div><span>{pct(activeCampaign.stats.called, activeCampaign.stats.sent)}</span><small>call rate</small></div>
            <div><span>{activeCampaign.stats.interested}</span><small>qualified</small></div>
            <div><span>{activeCampaign.stats.buildings}</span><small>buildings</small></div>
            <div><span>{activeCampaign.stats.units}</span><small>units reached</small></div>
          </div>
        )}

        <div className="letters-results">
          {loading && <div className="letters-empty">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="letters-empty">
              No matches yet. Search by rough name, mailing address, property street, phone, or matricule.
            </div>
          )}
          {!loading && results.map((recipient) => (
            <button
              type="button"
              key={recipient.recipient_id}
              className={`letters-result${selected?.recipient_id === recipient.recipient_id ? " letters-result--active" : ""}`}
              onClick={() => setSelectedId(recipient.recipient_id)}
            >
              <div>
                <strong>{recipient.owner_name}</strong>
                <span>{recipient.mailing_address || "No mailing address"}{recipient.mailing_city ? `, ${recipient.mailing_city}` : ""}</span>
              </div>
              <div className="letters-result__meta">
                <span>{recipient.property_count} bldg</span>
                <span>{recipient.total_units ?? "—"} units</span>
                <span className={`letters-status letters-status--${recipient.status}`}>{statusLabel(recipient.status)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="letters-panel letters-panel--detail">
        {!selected ? (
          <div className="letters-empty letters-empty--detail">Pick a letter recipient to see their portfolio.</div>
        ) : (
          <>
            <div className="letters-detail-head">
              <div>
                <div className="letters-detail-head__campaign">{selected.campaign?.name ?? "Letter campaign"} · mailed {fmtDate(selected.campaign?.mailed_at ?? null)}</div>
                <h2>{selected.owner_name}</h2>
                <p>
                  {selected.mailing_address || "No mailing address"}
                  {selected.mailing_city ? `, ${selected.mailing_city}` : ""}
                  {selected.mailing_postal ? ` ${selected.mailing_postal}` : ""}
                </p>
              </div>
              <div className="letters-detail-kpis">
                <div><span>{selected.property_count}</span><small>buildings</small></div>
                <div><span>{selected.total_units ?? "—"}</span><small>units</small></div>
                <div><span>{selected.phone_display ?? "—"}</span><small>phone</small></div>
              </div>
            </div>

            <div className="letters-outcomes">
              {OUTCOMES.map((outcome) => (
                <button
                  key={outcome.id}
                  type="button"
                  disabled={savingOutcome !== null}
                  onClick={() => saveOutcome(outcome.id)}
                >
                  {savingOutcome === outcome.id ? "Saving…" : outcome.label}
                </button>
              ))}
            </div>

            <label className="letters-note">
              <span>Call note</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What did they say? Motivation, timing, price expectation, callback…"
              />
            </label>

            <div className="letters-sections">
              <section>
                <h3>Properties from this letter</h3>
                <div className="letters-properties">
                  {selected.properties.map((property) => (
                    <div key={property.id} className="letters-property">
                      <div>
                        <strong>{property.address}</strong>
                        <span>{property.matricule ?? "No matricule"} · {property.property_type ?? "property"}</span>
                      </div>
                      <div>
                        <b>{property.num_units ?? "—"}</b>
                        <small>units</small>
                      </div>
                      <div>
                        <b>{fmtMoney(property.evaluation_total)}</b>
                        <small>eval</small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3>History</h3>
                <div className="letters-history">
                  {selected.interactions.length === 0 && <div className="letters-empty">No callback logged yet.</div>}
                  {selected.interactions.map((interaction) => (
                    <div key={interaction.id} className="letters-history-item">
                      <div>
                        <strong>{statusLabel(interaction.outcome)}</strong>
                        <span>{new Date(interaction.created_at).toLocaleString("fr-CA")}</span>
                      </div>
                      {interaction.notes && <p>{interaction.notes}</p>}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
