export type DealChecklistItem = { id: string; label: string; done: boolean };

export const DEAL_STAGE_ORDER = [
  "prospection",
  "analyse",
  "offre",
  "due_diligence",
  "financement",
  "cloture",
] as const;

export const DEFAULT_DEAL_CHECKLISTS: Record<string, DealChecklistItem[]> = {
  prospection: [
    { id: "info_owner", label: "Infos propriétaire recueillies", done: false },
    { id: "units_verified", label: "Nombre d'unités confirmé", done: false },
    { id: "eval_checked", label: "Évaluation municipale consultée", done: false },
    { id: "first_contact", label: "Premier contact initié", done: false },
  ],
  analyse: [
    { id: "revenus", label: "Revenus bruts documentés", done: false },
    { id: "depenses", label: "Dépenses d'exploitation estimées", done: false },
    { id: "taux_cap", label: "Taux de capitalisation calculé", done: false },
    { id: "visuelle", label: "Inspection visuelle extérieure", done: false },
    { id: "comparables", label: "Comparables de vente analysés", done: false },
  ],
  offre: [
    { id: "offre_redigee", label: "Offre d'achat rédigée", done: false },
    { id: "offre_envoyee", label: "Offre envoyée au vendeur", done: false },
    { id: "conditions", label: "Conditions d'inspection et financement", done: false },
    { id: "depot", label: "Dépôt promis confirmé", done: false },
  ],
  due_diligence: [
    { id: "inspection", label: "Inspection par entrepreneur complète", done: false },
    { id: "baux", label: "Baux des locataires révisés", done: false },
    { id: "historique", label: "Historique de revenus 3 ans", done: false },
    { id: "taxes", label: "Taxes municipales et scolaires OK", done: false },
    { id: "juridique", label: "Vérification cadastrale / titres", done: false },
  ],
  financement: [
    { id: "banque_contact", label: "Institution financière contactée", done: false },
    { id: "evaluation", label: "Évaluation bancaire commandée", done: false },
    { id: "approbation", label: "Approbation de financement reçue", done: false },
    { id: "notaire", label: "Notaire choisi et mandaté", done: false },
  ],
  cloture: [
    { id: "acte_signe", label: "Acte de vente signé chez le notaire", done: false },
    { id: "cles_recues", label: "Clés et documents reçus", done: false },
    { id: "assurance", label: "Assurance en vigueur dès la prise possession", done: false },
  ],
};

export function buildDefaultChecklists(stage: string) {
  const checklists: Record<string, DealChecklistItem[]> = {};
  const currentIdx = DEAL_STAGE_ORDER.indexOf(stage as (typeof DEAL_STAGE_ORDER)[number]);
  const safeIdx = currentIdx >= 0 ? currentIdx : 0;

  for (let i = 0; i <= safeIdx; i += 1) {
    const key = DEAL_STAGE_ORDER[i];
    checklists[key] = DEFAULT_DEAL_CHECKLISTS[key].map((item) => ({ ...item }));
  }

  return checklists;
}
