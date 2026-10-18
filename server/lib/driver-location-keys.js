import crypto from 'crypto';
import { query } from '../db/connection.js';

let tableReady = null;

function ensureDriverLocationKeysTable() {
  if (!tableReady) {
    tableReady = query(
      `CREATE TABLE IF NOT EXISTS driver_location_keys (
         driver_user_id VARCHAR(255) NOT NULL,
         key_hash CHAR(64) NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         last_used_at TIMESTAMP NULL DEFAULT NULL,
         PRIMARY KEY (driver_user_id),
         UNIQUE KEY uk_driver_location_keys_hash (key_hash)
       )`
    ).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

/** Issues a new key for the driver's device; any key issued earlier (e.g. on another phone) stops working. */
export async function issueDriverLocationKey(driverUserId) {
  const safeDriverUserId = String(driverUserId || '').trim();
  if (!safeDriverUserId) throw new Error('driverUserId is required');
  await ensureDriverLocationKeysTable();

  const key = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO driver_location_keys (driver_user_id, key_hash)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       key_hash = VALUES(key_hash),
       created_at = CURRENT_TIMESTAMP,
       last_used_at = NULL`,
    [safeDriverUserId, hashKey(key)]
  );
  return key;
}

export async function findDriverByLocationKey(key) {
  const safeKey = String(key || '').trim();
  if (!/^[a-f0-9]{64}$/.test(safeKey)) return null;
  await ensureDriverLocationKeysTable();

  const [row] = await query(
    `SELECT driver_user_id
     FROM driver_location_keys
     WHERE key_hash = ?
     LIMIT 1`,
    [hashKey(safeKey)]
  );
  if (!row) return null;

  query(
    `UPDATE driver_location_keys SET last_used_at = CURRENT_TIMESTAMP WHERE driver_user_id = ?`,
    [row.driver_user_id]
  ).catch(() => {});
  return String(row.driver_user_id);
}
