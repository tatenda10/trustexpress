import 'dotenv/config';
import pool, { query } from '../db/connection.js';

const DEFAULT_PRICING_BY_TIER = {
  'trust-express': {
    tierName: 'Trust Express',
    pricePerKm: 1.0,
    baseFare: 0.0,
    perMinuteRate: 0.0,
    minimumFare: 1.0,
    sortOrder: 0,
  },
  'trust-xl': {
    tierName: 'Trust XL',
    pricePerKm: 1.5,
    baseFare: 2.0,
    perMinuteRate: 0.1,
    minimumFare: 3.0,
    sortOrder: 1,
  },
  'trust-luxury': {
    tierName: 'Trust Luxury',
    pricePerKm: 2.0,
    baseFare: 4.0,
    perMinuteRate: 0.2,
    minimumFare: 5.0,
    sortOrder: 2,
  },
};

async function main() {
  try {
    const regions = await query(
      'SELECT id, region_name FROM operating_regions WHERE is_active = 1 ORDER BY id ASC'
    );

    if (!regions.length) {
      console.log('No active operating regions found.');
      return;
    }

    let inserted = 0;

    for (const region of regions) {
      const existingRows = await query(
        'SELECT tier_key FROM operating_region_pricing_tiers WHERE region_id = ?',
        [region.id]
      );
      const existingKeys = new Set(existingRows.map((row) => String(row.tier_key || '').trim().toLowerCase()));

      for (const [tierKey, config] of Object.entries(DEFAULT_PRICING_BY_TIER)) {
        if (existingKeys.has(tierKey)) continue;

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
            tierKey,
            config.tierName,
            config.pricePerKm,
            config.baseFare,
            config.perMinuteRate,
            config.minimumFare,
            config.sortOrder,
          ]
        );

        inserted += 1;
        console.log(`Added ${config.tierName} pricing tier to ${region.region_name}.`);
      }
    }

    console.log(`Inserted ${inserted} missing pricing tiers.`);
  } catch (error) {
    console.error('Failed to seed missing pricing tiers:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
