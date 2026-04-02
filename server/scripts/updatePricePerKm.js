import { query } from '../db/connection.js';

async function main() {
  try {
    const sql = `
      UPDATE operating_region_pricing_tiers
      SET price_per_km = 0.8
      WHERE is_active = 1;
    `;

    const result = await query(sql);
    console.log('price_per_km updated to 0.8 for active tiers.');
    console.log('Result:', result);
  } catch (err) {
    console.error('Failed to update price_per_km:', err);
  } finally {
    process.exit(0);
  }
}

main();

