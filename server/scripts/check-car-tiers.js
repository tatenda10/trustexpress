import 'dotenv/config';
import pool, { query } from '../db/connection.js';

async function main() {
  try {
    const [vehicleTierCountRow] = await query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS activeTotal FROM vehicle_tier_rules'
    );

    const [pricingTierCountRow] = await query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS activeTotal FROM operating_region_pricing_tiers'
    );

    console.log('Car tier counts');
    console.log(`Vehicle tier rules: ${Number(vehicleTierCountRow?.total || 0)} total, ${Number(vehicleTierCountRow?.activeTotal || 0)} active`);
    console.log(`Pricing tiers: ${Number(pricingTierCountRow?.total || 0)} total, ${Number(pricingTierCountRow?.activeTotal || 0)} active`);
  } catch (error) {
    console.error('Failed to check car tiers:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
