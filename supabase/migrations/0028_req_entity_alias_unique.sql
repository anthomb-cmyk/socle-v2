-- Required for ON CONFLICT (neq, alias_name_normalized) upserts in ingest-req.
-- Dedupes any existing rows that violate the constraint, then adds it.
DELETE FROM req_entity_alias a USING req_entity_alias b
WHERE a.id < b.id
  AND a.neq = b.neq
  AND a.alias_name_normalized = b.alias_name_normalized;

ALTER TABLE req_entity_alias
  ADD CONSTRAINT req_entity_alias_neq_normalized_unique
  UNIQUE (neq, alias_name_normalized);
