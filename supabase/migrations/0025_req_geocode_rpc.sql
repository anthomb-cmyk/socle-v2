CREATE OR REPLACE FUNCTION req_entities_near_point(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters integer
) RETURNS SETOF req_entities
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT *
  FROM req_entities
  WHERE
    (mailing_geocode IS NOT NULL AND ST_DWithin(
      mailing_geocode,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_meters
    ))
    OR
    (registered_geocode IS NOT NULL AND ST_DWithin(
      registered_geocode,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_meters
    ));
$$;

GRANT EXECUTE ON FUNCTION req_entities_near_point(double precision, double precision, integer) TO authenticated;
