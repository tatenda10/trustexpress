import { query } from '../db/connection.js';

/**
 * driver_availability.last_seen_at is a heartbeat (request polling touches it without a
 * location), so live-location freshness needs its own timestamp. Mirrors migration 088.
 */
export async function ensureDriverLocationUpdatedAtColumn() {
  try {
    const [row] = await query(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'driver_availability'
         AND COLUMN_NAME = 'location_updated_at'`
    );
    if (Number(row?.count || 0) > 0) return;

    await query(
      `ALTER TABLE driver_availability
       ADD COLUMN location_updated_at TIMESTAMP NULL DEFAULT NULL AFTER current_lng`
    );
    await query(
      `UPDATE driver_availability
       SET location_updated_at = last_seen_at
       WHERE location_updated_at IS NULL
         AND current_lat IS NOT NULL
         AND current_lng IS NOT NULL`
    );
    console.log('[schema] added driver_availability.location_updated_at');
  } catch (error) {
    console.error('[schema] driver_availability.location_updated_at check failed', error?.message || error);
  }
}
