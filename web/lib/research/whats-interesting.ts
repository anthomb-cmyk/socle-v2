/**
 * whats-interesting.ts — Rules engine for generating a "what's interesting"
 * annotation for an owner record.
 *
 * Rules are evaluated in priority order; the first matching rule wins and its
 * message is returned.  If no rule matches, null is returned.
 *
 * Rule priority (highest first):
 *   1. Recently inherited / director name change (last 24 months)
 *   2. Corporate restructure (status change in last 12 months)
 *   3. Many buildings, no confirmed phone found
 *   4. Old property with high per-unit assessment
 *   5. Owner-occupier (mailing address ≈ one of their properties)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WhatsInterestingInput = {
  owner: {
    canonical_name: string;
    owner_type: string;
    mailing_geocode?: GeoPoint | null;
  };
  reqHistory?: Array<{
    neq: string;
    status: string;
    status_date?: string | null;
    directors_changed_at?: string | null;
  }>;
  properties: Array<{
    matricule: string;
    address: string;
    n_units: number;
    year_built?: number | null;
    assessment_total?: number | null;
    geocode?: GeoPoint | null;
  }>;
  hypothesisSearchHistory?: {
    attempts: number;
    confirmedCount: number;
  };
};

/** Simple lat/lng point. */
type GeoPoint = {
  lat: number;
  lng: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a date string as "Month YYYY" (e.g. "March 2024").
 * Falls back to the raw string if parsing fails.
 */
function formatMonthYear(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-CA", { year: "numeric", month: "long" });
  } catch {
    return iso;
  }
}

/**
 * Return true if `iso` is within the last `months` calendar months.
 */
function isWithinMonths(iso: string | null | undefined, months: number): boolean {
  if (!iso) return false;
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return new Date(iso) >= cutoff;
  } catch {
    return false;
  }
}

/**
 * Approximate distance in metres between two lat/lng points using the
 * Haversine formula.
 */
function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

// ---------------------------------------------------------------------------
// computeWhatsInteresting
// ---------------------------------------------------------------------------

export function computeWhatsInteresting(input: WhatsInterestingInput): string | null {
  const { owner, reqHistory = [], properties, hypothesisSearchHistory } = input;
  const currentYear = new Date().getFullYear();

  // -------------------------------------------------------------------------
  // Rule 1: Recently inherited — director name change in last 24 months
  // -------------------------------------------------------------------------
  for (const req of reqHistory) {
    if (isWithinMonths(req.directors_changed_at, 24)) {
      const month = formatMonthYear(req.directors_changed_at!);
      return `Director listing changed in ${month} — possible recent transition.`;
    }
  }

  // -------------------------------------------------------------------------
  // Rule 2: Corporate restructure — status changed within last 12 months
  // -------------------------------------------------------------------------
  for (const req of reqHistory) {
    if (isWithinMonths(req.status_date, 12)) {
      const month = formatMonthYear(req.status_date!);
      return `Recent corporate restructure (status change in ${month}).`;
    }
  }

  // -------------------------------------------------------------------------
  // Rule 3: Holds many buildings but no phone ever confirmed
  // -------------------------------------------------------------------------
  if (
    properties.length >= 5 &&
    hypothesisSearchHistory != null &&
    hypothesisSearchHistory.confirmedCount === 0 &&
    hypothesisSearchHistory.attempts >= 1
  ) {
    return `Owns ${properties.length} buildings; multiple research attempts found no confirmed phone — sophisticated owner.`;
  }

  // -------------------------------------------------------------------------
  // Rule 4: Old property with high per-unit assessment
  // -------------------------------------------------------------------------
  for (const prop of properties) {
    if (
      prop.year_built != null &&
      prop.assessment_total != null &&
      prop.n_units > 0 &&
      currentYear - prop.year_built > 50 &&
      prop.assessment_total / prop.n_units > 500_000
    ) {
      return `${prop.n_units}-unit at ${prop.address} built ${prop.year_built} — high per-unit assessment.`;
    }
  }

  // -------------------------------------------------------------------------
  // Rule 5: Owner-occupier — mailing geocode within ~50 m of a property
  // -------------------------------------------------------------------------
  if (owner.mailing_geocode) {
    for (const prop of properties) {
      if (prop.geocode) {
        const dist = haversineMetres(owner.mailing_geocode, prop.geocode);
        if (dist <= 50) {
          return "Mailing address matches one of their properties — owner-occupier or operates from home.";
        }
      }
    }
  }

  return null;
}
