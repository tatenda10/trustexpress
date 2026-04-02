import 'dotenv/config';
import pool, { query } from '../db/connection.js';

const BULAWAYO_TIER_DEFINITIONS = [
  {
    tierKey: 'trust-express',
    tierName: 'Trust Express',
    pricePerKm: 0.8,
    baseFare: 0.0,
    perMinuteRate: 0.0,
    minimumFare: 1.0,
    sortOrder: 0,
  },
  {
    tierKey: 'trust-xl',
    tierName: 'Trust XL',
    pricePerKm: 0.8,
    baseFare: 0.0,
    perMinuteRate: 0.0,
    minimumFare: 1.0,
    sortOrder: 1,
  },
  {
    tierKey: 'trust-luxury',
    tierName: 'Trust Luxury',
    pricePerKm: 0.8,
    baseFare: 0.0,
    perMinuteRate: 0.0,
    minimumFare: 1.0,
    sortOrder: 2,
  },
];

async function main() {
  try {
    const [region] = await query(
      `SELECT id, region_name, city
       FROM operating_regions
       WHERE (LOWER(region_name) = 'bulawayo' OR LOWER(city) = 'bulawayo')
         AND is_active = 1
       LIMIT 1`
    );

    if (!region) {
      console.log('No active Bulawayo region found (check operating_regions.region_name or .city).');
      return;
    }

    console.log(`Using Bulawayo region id=${region.id}, name="${region.region_name}", city="${region.city}".`);

    const existingRows = await query(
      'SELECT tier_key FROM operating_region_pricing_tiers WHERE region_id = ?',
      [region.id]
    );
    const existingKeys = new Set(
      existingRows.map((row) => String(row.tier_key || '').trim().toLowerCase())
    );

    let inserted = 0;

    for (const def of BULAWAYO_TIER_DEFINITIONS) {
      const key = def.tierKey;
      if (existingKeys.has(key)) {
        console.log(`Tier "${key}" already exists for Bulawayo, skipping.`);
        continue;
      }

      await query(
        `INSERT INTO operating_region_pricing_tiers (
          region_id,
          tier_key,
          tier_name,
          price_per_km,
          base_fare,
          per_minute_rate,
          minimum_fare,
          is_active,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          region.id,
          key,
          def.tierName,
          def.pricePerKm,
          def.baseFare,
          def.perMinuteRate,
          def.minimumFare,
          def.sortOrder,
        ]
      );

      inserted += 1;
      console.log(`Inserted tier "${def.tierName}" (${key}) for Bulawayo.`);
    }

    console.log(`Done. Inserted ${inserted} new Bulawayo pricing tiers.`);
  } catch (err) {
    console.error('Failed to create Bulawayo tiers:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

