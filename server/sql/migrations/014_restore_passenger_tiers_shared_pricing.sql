-- Restore the three passenger-facing tier names while keeping one shared fare setup.
-- Copies the current active universal pricing values onto:
--   - Trust Express
--   - Trust XL
--   - Trust Luxury

START TRANSACTION;

SET @selected_region_id := (
  SELECT id
  FROM operating_regions
  WHERE is_active = 1
  ORDER BY id ASC
  LIMIT 1
);

SET @selected_tier_id := (
  SELECT id
  FROM operating_region_pricing_tiers
  WHERE region_id = @selected_region_id
    AND is_active = 1
  ORDER BY sort_order ASC, id ASC
  LIMIT 1
);

CREATE TEMPORARY TABLE tmp_shared_pricing AS
SELECT
  @selected_region_id AS region_id,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  1 AS is_active
FROM operating_region_pricing_tiers
WHERE id = @selected_tier_id;

DELETE FROM operating_region_pricing_tiers
WHERE region_id = @selected_region_id;

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
  'trust-express' AS tier_key,
  'Trust Express' AS tier_name,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  is_active,
  0 AS sort_order
FROM tmp_shared_pricing
;

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
  'trust-xl' AS tier_key,
  'Trust XL' AS tier_name,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  is_active,
  1 AS sort_order
FROM tmp_shared_pricing
;

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
  'trust-luxury' AS tier_key,
  'Trust Luxury' AS tier_name,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  is_active,
  2 AS sort_order
FROM tmp_shared_pricing;

DROP TEMPORARY TABLE IF EXISTS tmp_shared_pricing;

COMMIT;
