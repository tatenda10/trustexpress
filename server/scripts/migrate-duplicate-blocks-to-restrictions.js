/**
 * Converts legacy duplicate-phone blocks (privateMetadata driverStatus/passengerStatus = 'blocked')
 * into account restrictions so they appear in the admin Blocked list and can be lifted there.
 * Dry run by default; pass --apply to write.
 */
import 'dotenv/config';
import pool, { query } from '../db/connection.js';
import { createRestriction, listUserRestrictions } from '../lib/account-restrictions.js';
import { mergePrivateMetadata } from '../lib/users.js';

const apply = process.argv.includes('--apply');

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

const rows = await query(
  `SELECT clerk_user_id, role, first_name, last_name, phone_number, private_metadata
   FROM users
   WHERE JSON_UNQUOTE(JSON_EXTRACT(private_metadata, '$.duplicateAccountDetectedAt')) IS NOT NULL
     AND (
       JSON_UNQUOTE(JSON_EXTRACT(private_metadata, '$.driverStatus')) = 'blocked'
       OR JSON_UNQUOTE(JSON_EXTRACT(private_metadata, '$.passengerStatus')) = 'blocked'
     )`
);

console.log(`${rows.length} legacy duplicate block(s) found${apply ? '' : ' (dry run)'}`);

for (const row of rows) {
  const meta = parseJson(row.private_metadata);
  const role = row.role === 'passenger' ? 'passenger' : 'driver';
  const matched = Array.isArray(meta.duplicateAccountMatchedUserIds) ? meta.duplicateAccountMatchedUserIds : [];
  const others = matched.filter((id) => id !== row.clerk_user_id);
  const stillExisting = others.length
    ? (await query(
        `SELECT clerk_user_id FROM users WHERE clerk_user_id IN (${others.map(() => '?').join(',')})`,
        others
      )).map((item) => item.clerk_user_id)
    : [];
  const deleted = others.filter((id) => !stillExisting.includes(id));
  const phone = meta.phoneNumber || row.phone_number || 'unknown';
  const reason = [
    `Duplicate ${role} account: phone ${phone} is also used by ${others.join(', ') || 'another account'}`,
    deleted.length ? `(since deleted: ${deleted.join(', ')})` : '',
  ].filter(Boolean).join(' ');

  console.log({
    userId: row.clerk_user_id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    reason,
  });
  if (!apply) continue;

  const existing = await listUserRestrictions(row.clerk_user_id);
  if (!existing.some((item) => item.status === 'active' && item.reason.startsWith(`Duplicate ${role} account`))) {
    await createRestriction({
      userId: row.clerk_user_id,
      userRole: role,
      scope: role === 'driver' ? 'go_online' : 'request_rides',
      reason,
    });
  }
  await mergePrivateMetadata(row.clerk_user_id, {
    ...(role === 'driver' ? { driverStatus: 'active' } : { passengerStatus: 'active' }),
    duplicateAccountReason: reason,
  });
}

await pool.end();
