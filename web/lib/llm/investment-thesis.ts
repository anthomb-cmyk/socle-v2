// Investment thesis used by the fit scorer. Edit this file to refine
// what the system considers a "fit" lead. Changes take effect on the next
// score calculation (no migration needed).
export const INVESTMENT_THESIS = {
  market: "Quebec multi-unit residential",
  ideal_property: {
    units_min: 6,
    units_max: 60,
    target_locations: ["Montréal", "Laval", "Longueuil", "Brossard", "Granby", "Sherbrooke", "Saint-Hyacinthe"],
    max_distance_from_montreal_hours: 1.5,
    valuation_per_unit_max_cad: 500000,
  },
  positive_signals: [
    "Owner-held for more than 10 years (potential retirement-driven sale).",
    "Owner is a person or family (not a large corporation).",
    "Property in a target location.",
    "Valuation per unit under target ceiling.",
    "Mailing address differs from property (out-of-town landlord).",
  ],
  negative_signals: [
    "Single-family or duplex (less than 6 units).",
    "Owner is a large corporation, REIT, or institutional investor.",
    "Property is brand new (built within last 3 years).",
    "Recently changed hands (purchased in the last 2 years).",
    "Outside target geographic radius.",
  ],
};
