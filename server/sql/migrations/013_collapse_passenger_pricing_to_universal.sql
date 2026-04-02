-- Collapse passenger pricing to one universal pricing row.
-- Keeps Harare's first active pricing rule when available, otherwise falls back
-- to the first active pricing rule in the database.

START TRANSACTION;

SET @selected_region_id := (
  SELECT id
  FROM operating_regions
  WHERE LOWER(COALESCE(city, '')) = 'harare'
     OR LOWER(region_name) LIKE '%harare%'
  ORDER BY is_active DESC, id ASC
  LIMIT 1
);

SET @selected_region_id := COALESCE(
  @selected_region_id,
  (
    SELECT region_id
    FROM operating_region_pricing_tiers
    ORDER BY is_active DESC, sort_order ASC, id ASC
    LIMIT 1
  )
);

SET @selected_tier_id := (
  SELECT id
  FROM operating_region_pricing_tiers
  WHERE region_id = @selected_region_id
  ORDER BY is_active DESC, sort_order ASC, id ASC
  LIMIT 1
);

CREATE TEMPORARY TABLE tmp_universal_pricing AS
SELECT
  region_id,
  'trust-ride' AS tier_key,
  'Trust Ride' AS tier_name,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  1 AS is_active,
  0 AS sort_order
FROM operating_region_pricing_tiers
WHERE id = @selected_tier_id;

DELETE FROM operating_region_pricing_tiers;

INSERT INTO operating_region_pricing_tiers (
  region_id,
  tier_key,
  tier_name,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  is_active,
  sort_order
)
SELECT
  region_id,
  tier_key,
  tier_name,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  is_active,
  sort_order
FROM tmp_universal_pricing;

DROP TEMPORARY TABLE IF EXISTS tmp_universal_pricing;

UPDATE operating_regions
SET
  region_name = CASE WHEN id = @selected_region_id THEN 'Universal' ELSE region_name END,
  city = CASE WHEN id = @selected_region_id THEN NULL ELSE city END,
  is_active = CASE WHEN id = @selected_region_id THEN 1 ELSE 0 END;

DELETE FROM operating_region_configs
WHERE region_id <> @selected_region_id;

DELETE FROM operating_regions
WHERE id <> @selected_region_id;

COMMIT;
