-- Bulk update helper for the addresses ingest.
-- Etablissements.csv contains NEQs that may not exist in req_entities (since
-- Entreprise.csv was filtered to active rows). UPDATE-only semantics avoid the
-- legal_name NOT NULL constraint that fires on plain upsert.
CREATE OR REPLACE FUNCTION bulk_update_req_entity_addresses(updates jsonb)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  affected int;
BEGIN
  WITH parsed AS (
    SELECT
      (j->>'neq')::text AS neq,
      (j->>'addr')::text AS addr,
      (j->>'fsa')::text AS fsa
    FROM jsonb_array_elements(updates) j
  ),
  upd AS (
    UPDATE req_entities r
    SET registered_address_raw = p.addr,
        postal_fsa = p.fsa
    FROM parsed p
    WHERE r.neq = p.neq
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM upd;
  RETURN affected;
END;
$$;
