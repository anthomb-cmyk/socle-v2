"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Budget = {
  dailyBudgetUsd: number;
  sessionBudgetUsd: number;
  dailySpentUsd: number;
  sessionSpentUsd: number;
  dailyRemainingUsd: number;
  sessionRemainingUsd: number;
  overDailyBudget: boolean;
  overSessionBudget: boolean;
};

type SessionData = {
  import: {
    id: string;
    file_name: string | null;
    status: string;
    format_detected: string | null;
    total_rows: number | null;
    created_at: string;
    completed_at: string | null;
  };
  operator: { enabled: boolean; disabledReason: string | null };
  summary: Record<string, number | string | null> | null;
  budget: Budget;
  canStart: boolean;
  eligibleStartLeadCount: number;
  counts: {
    leads: number;
    queueByStatus: Record<string, number>;
    jobsByStatus: Record<string, number>;
    candidatesByStatus: Record<string, number>;
    staleJobs: number;
  };
  staleJobs: Array<{
    id: string;
    lead_id: string | null;
    workflow_id: string | null;
    status: string;
    attempts: number;
    max_attempts: number;
    started_at: string | null;
    created_at: string;
    error_message: string | null;
  }>;
  actions: Array<{
    id: string;
    event_type: string;
    status: string;
    payload: { codex?: { action_type?: string; reversible?: boolean } } | null;
    result: unknown;
    error_message: string | null;
    occurred_at: string;
  }>;
  recoverability: {
    counts: Record<"bad_query" | "no_public_data" | "weak_evidence" | "pipeline_error", number>;
    examples: Array<{ leadId: string; reason: string; detail: string }>;
  };
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function labelForRecoverability(key: string): string {
  const map: Record<string, string> = {
    bad_query: "Requetes faibles",
    no_public_data: "Aucune source publique",
    weak_evidence: "Preuve faible",
    pipeline_error: "Erreur pipeline",
  };
  return map[key] ?? key;
}

export default function PhoneEnrichmentSessionClient({ importJobId }: { importJobId: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/phone-enrichment/sessions/${importJobId}`);
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Impossible de charger la session.");
      } else {
        setData(json.data);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [importJobId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function runAction(actionType: string, payload: Record<string, unknown> = {}) {
    setBusy(actionType);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/phone-enrichment/sessions/${importJobId}/codex-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: actionType,
          payload,
          idempotency_key: `${actionType}:${importJobId}:${JSON.stringify(payload)}`,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Action refusee.");
      } else if (json.data?.duplicate) {
        setMessage("Action deja enregistree; aucune duplication.");
      } else {
        setMessage("Action Codex terminee.");
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runAiPass() {
    setBusy("run_ai_second_pass");
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/phone-enrichment/sessions/${importJobId}/ai-pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxLeads: 10,
          idempotency_key: `run_ai_second_pass:${importJobId}:${new Date().toISOString().slice(0, 13)}`,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "2e passe refusee.");
      } else if (json.data?.duplicate) {
        setMessage("2e passe deja enregistree; aucune duplication.");
      } else {
        setMessage("2e passe AI terminee.");
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function calibrateTrust() {
    setBusy("calibrate_trust");
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/phone-enrichment/trust/calibrate", { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Calibration refusee.");
      } else {
        setMessage(`Calibration terminee: ${json.data?.enabledGroups ?? 0} groupe(s) actif(s).`);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function undoAction(actionId: string) {
    setBusy(`undo:${actionId}`);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/phone-enrichment/sessions/${importJobId}/codex-action/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: actionId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Undo refuse.");
      } else if (json.data?.duplicate) {
        setMessage("Undo deja enregistre.");
      } else {
        setMessage("Action Codex annulee.");
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const summary = data?.summary ?? {};
  const reviewCount = n(summary.review_candidates) + n(summary.weak_candidates);
  const unresolvedCount = n(summary.unresolved_after_all_sources) + n(summary.unresolved_after_openclaw);
  const actionCount = data?.actions.length ?? 0;

  const lastAction = useMemo(() => data?.actions[0] ?? null, [data]);

  if (loading) {
    return (
      <main className="crm-page-narrow">
        <p style={{ fontSize: 13, color: "var(--crm-text3)" }}>Chargement de la session Codex...</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="crm-page-narrow">
        <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error ?? "Session introuvable."}</p>
        <Link href={"/import" as never} style={{ fontSize: 13, color: "var(--crm-gold)" }}>Retour aux imports</Link>
      </main>
    );
  }

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <Link href={"/import" as never} style={{ fontSize: 12, color: "var(--crm-gold)", textDecoration: "underline" }}>
            Retour a l&apos;import
          </Link>
          <h1 className="crm-page-title" style={{ marginTop: 8 }}>Session Codex telephone</h1>
          <p className="crm-page-sub" style={{ marginBottom: 0 }}>
            {data.import.file_name ?? "Import sans nom"} · {data.import.format_detected ?? "format inconnu"} · {data.counts.leads} leads
          </p>
        </div>
        <div style={{ minWidth: 220, border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "10px 12px", background: "var(--crm-bg-alt)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 4 }}>Budget AI</div>
          <div style={{ fontSize: 13, color: data.budget.overSessionBudget || data.budget.overDailyBudget ? "var(--crm-red)" : "var(--crm-text)" }}>
            Session {money(data.budget.sessionSpentUsd)} / {money(data.budget.sessionBudgetUsd)}
          </div>
          <div style={{ fontSize: 12, color: "var(--crm-text3)" }}>
            Jour {money(data.budget.dailySpentUsd)} / {money(data.budget.dailyBudgetUsd)}
          </div>
        </div>
      </header>

      {!data.operator.enabled && (
        <section className="crm-card" style={{ padding: "12px 16px", borderColor: "var(--crm-amber)", background: "var(--crm-amber-light, #FEF9EC)" }}>
          <strong style={{ color: "var(--crm-amber)" }}>Mode operateur desactive.</strong>{" "}
          <span style={{ fontSize: 13, color: "var(--crm-text2)" }}>{data.operator.disabledReason}</span>
        </section>
      )}

      {(message || error) && (
        <section className="crm-card" style={{ padding: "10px 14px", borderColor: error ? "var(--crm-red)" : "var(--crm-green)" }}>
          <p style={{ margin: 0, fontSize: 13, color: error ? "var(--crm-red)" : "var(--crm-green)" }}>{error ?? message}</p>
        </section>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <Stat label="Prets a appeler" value={n(summary.ready_to_call)} tone="green" />
        <Stat label="A reviser" value={reviewCount} tone="amber" />
        <Stat label="Non trouves" value={unresolvedCount} tone="red" />
        <Stat label="Actions Codex" value={actionCount} />
      </section>

      <section className="crm-card" style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Controle de session</h2>
            <p style={{ margin: 0, fontSize: 12, color: "var(--crm-text3)" }}>
              Rien ne demarre automatiquement. Codex agit seulement via ces boutons et l&apos;action est auditee.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="crm-btn crm-btn-dark"
              disabled={!data.operator.enabled || busy !== null || !data.canStart}
              onClick={() => runAction("start_enrichment")}
              style={{ opacity: !data.operator.enabled || busy !== null || !data.canStart ? 0.55 : 1 }}
            >
              {busy === "start_enrichment" ? "Demarrage..." : `Demarrer l'enrichissement (${data.eligibleStartLeadCount})`}
            </button>
            <button
              type="button"
              className="crm-btn"
              disabled={!data.operator.enabled || busy !== null || data.staleJobs.length === 0}
              onClick={() => runAction("mark_stale_jobs_failed", { minutes: 10 })}
              style={{ opacity: !data.operator.enabled || busy !== null || data.staleJobs.length === 0 ? 0.55 : 1 }}
            >
              Nettoyer stale jobs ({data.staleJobs.length})
            </button>
            <button
              type="button"
              className="crm-btn"
              disabled={!data.operator.enabled || busy !== null || reviewCount === 0}
              onClick={() => runAction("propose_review_decisions")}
              style={{ opacity: !data.operator.enabled || busy !== null || reviewCount === 0 ? 0.55 : 1 }}
            >
              Proposer les decisions ({reviewCount})
            </button>
            <button
              type="button"
              className="crm-btn"
              disabled={!data.operator.enabled || busy !== null || unresolvedCount === 0}
              onClick={() => runAiPass()}
              style={{ opacity: !data.operator.enabled || busy !== null || unresolvedCount === 0 ? 0.55 : 1 }}
            >
              {busy === "run_ai_second_pass" ? "2e passe..." : `Lancer 2e passe AI (${Math.min(unresolvedCount, 10)})`}
            </button>
            <button
              type="button"
              className="crm-btn"
              disabled={!data.operator.enabled || busy !== null || reviewCount === 0}
              onClick={() => runAction("apply_trusted_review_decisions")}
              style={{ opacity: !data.operator.enabled || busy !== null || reviewCount === 0 ? 0.55 : 1 }}
            >
              Appliquer fiables
            </button>
            <button
              type="button"
              className="crm-btn"
              disabled={!data.operator.enabled || busy !== null}
              onClick={() => calibrateTrust()}
              style={{ opacity: !data.operator.enabled || busy !== null ? 0.55 : 1 }}
            >
              Calibrer confiance
            </button>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title="Jobs">
          <Breakdown rows={data.counts.jobsByStatus} />
          {data.staleJobs.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--crm-red)" }}>
              {data.staleJobs.length} job{data.staleJobs.length !== 1 ? "s" : ""} stale detecte{data.staleJobs.length !== 1 ? "s" : ""}.
            </div>
          )}
        </Panel>
        <Panel title="Candidats">
          <Breakdown rows={data.counts.candidatesByStatus} />
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href={`/phone-review?import_job_id=${importJobId}` as never} className="crm-btn" style={{ fontSize: 12 }}>
              Ouvrir phone-review
            </Link>
            <Link href={`/leads?import_job_id=${importJobId}` as never} className="crm-btn" style={{ fontSize: 12 }}>
              Voir les leads
            </Link>
          </div>
        </Panel>
      </section>

      <section className="crm-card" style={{ padding: "16px 18px" }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Analyse des cas faibles/non trouves</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {Object.entries(data.recoverability.counts).map(([key, value]) => (
            <div key={key} style={{ background: "var(--crm-bg-alt)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--crm-text3)" }}>{labelForRecoverability(key)}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
        {data.recoverability.examples.length > 0 && (
          <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--crm-text2)" }}>
            {data.recoverability.examples.map(example => (
              <li key={example.leadId}>
                <Link href={`/leads/${example.leadId}` as never} style={{ color: "var(--crm-gold)" }}>{example.leadId.slice(0, 8)}</Link>{" "}
                · {labelForRecoverability(example.reason)} · {example.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-card" style={{ padding: "16px 18px" }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Actions Codex recentes</h2>
        {lastAction && (
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--crm-text3)" }}>
            Derniere action: {lastAction.payload?.codex?.action_type ?? lastAction.event_type} · {new Date(lastAction.occurred_at).toLocaleString("fr-CA")}
          </p>
        )}
        {data.actions.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--crm-text3)", margin: 0 }}>Aucune action Codex pour cet import.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.actions.slice(0, 12).map(action => (
              <details key={action.id} style={{ borderTop: "1px solid var(--crm-card-border)", paddingTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    <strong>{action.payload?.codex?.action_type ?? action.event_type}</strong>{" "}
                    <span style={{ color: "var(--crm-text3)" }}>{action.status} · {new Date(action.occurred_at).toLocaleString("fr-CA")}</span>
                  </span>
                  {action.payload?.codex?.reversible && (
                    <button
                      type="button"
                      className="crm-btn"
                      disabled={!data.operator.enabled || busy !== null}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void undoAction(action.id);
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", opacity: !data.operator.enabled || busy !== null ? 0.55 : 1 }}
                    >
                      Undo
                    </button>
                  )}
                </summary>
                <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", fontSize: 10, background: "var(--crm-bg-alt)", padding: 8, borderRadius: 6, overflowX: "auto" }}>
                  {JSON.stringify({ payload: action.payload, result: action.result, error: action.error_message }, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" }) {
  const color = tone === "green" ? "var(--crm-green)" : tone === "amber" ? "var(--crm-amber)" : tone === "red" ? "var(--crm-red)" : "var(--crm-text)";
  return (
    <div className="crm-card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="crm-card" style={{ padding: "16px 18px" }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Breakdown({ rows }: { rows: Record<string, number> }) {
  const entries = Object.entries(rows);
  if (entries.length === 0) return <p style={{ fontSize: 13, color: "var(--crm-text3)", margin: 0 }}>Aucune donnee.</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 8, background: "var(--crm-bg-alt)", borderRadius: 8, padding: "7px 9px", fontSize: 12 }}>
          <span style={{ color: "var(--crm-text2)", overflow: "hidden", textOverflow: "ellipsis" }}>{key}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
