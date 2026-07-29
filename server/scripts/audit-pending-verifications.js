import 'dotenv/config';
import { query } from '../db/connection.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { normalizeRole } from '../lib/clerk-user.js';

/**
 * Reconciles the dashboard "Verification queue" count against what the admin
 * verification page can actually show, and optionally deletes the orphans.
 *
 * Read-only by default. Pass --delete=true to remove rows whose Clerk user is
 * gone (those can never be reviewed or approved from the admin UI).
 */

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

const DOC_COLUMNS = {
  driver_identity: ['national_id_front_url', 'national_id_back_url', 'driver_licence_url', 'selfie_url'],
  driver_vehicle: [
    'car_photo_front_url',
    'car_photo_rear_url',
    'car_photo_urls',
    'vehicle_registration_url',
    'vehicle_registration_book_url',
    'insurance_url',
    'zinara_url',
  ],
  passenger_identity: ['national_id_front_url', 'national_id_back_url', 'selfie_url'],
};

function hasAnyDocument(row, table) {
  return DOC_COLUMNS[table].some((column) => {
    const value = row[column];
    if (!value) return false;
    const text = String(value).trim();
    return text !== '' && text !== '[]' && text !== 'null';
  });
}

async function lookupClerkUser(clerk, userId, cache) {
  if (cache.has(userId)) return cache.get(userId);
  let result;
  try {
    const user = await clerk.users.getUser(userId);
    result = { exists: true, role: normalizeRole(user.publicMetadata?.role) };
  } catch (error) {
    const status = error?.status || error?.statusCode;
    if (status === 404) {
      result = { exists: false, role: null };
    } else {
      result = { exists: null, role: null, error: error?.message || String(error) };
    }
  }
  cache.set(userId, result);
  return result;
}

async function collect(table, idColumn, statusColumn, submittedColumn, expectedRole, clerk, cache) {
  const rows = await query(
    `SELECT * FROM ${table}
     WHERE ${statusColumn} = 'pending'
       AND ${submittedColumn} IS NOT NULL`
  );

  const entries = [];
  for (const row of rows) {
    const userId = row[idColumn];
    const clerkInfo = await lookupClerkUser(clerk, userId, cache);
    entries.push({
      table,
      userId,
      expectedRole,
      submittedAt: row[submittedColumn],
      hasDocuments: hasAnyDocument(row, table),
      clerkExists: clerkInfo.exists,
      clerkRole: clerkInfo.role,
      clerkError: clerkInfo.error || null,
    });
  }
  return entries;
}

function classify(entry) {
  if (entry.clerkExists === false) return 'ORPHAN (Clerk user deleted)';
  if (entry.clerkExists === null) return 'UNKNOWN (Clerk lookup failed)';
  if (entry.table === 'passenger_identity') return 'PASSENGER (shown on Passengers page, not Driver verification)';
  if (entry.clerkRole !== entry.expectedRole) return `ROLE MISMATCH (Clerk role = ${entry.clerkRole})`;
  if (!entry.hasDocuments) return 'NO DOCUMENTS (hidden from the Incoming tab)';
  return 'VISIBLE (should appear on the verification page)';
}

async function main() {
  const shouldDelete = String(getArg('delete') || '').toLowerCase() === 'true';
  const clerk = getClerkClient();
  const cache = new Map();

  const entries = [
    ...(await collect('driver_identity', 'driver_user_id', 'profile_status', 'profile_submitted_at', 'driver', clerk, cache)),
    ...(await collect('driver_vehicle', 'driver_user_id', 'vehicle_status', 'vehicle_submitted_at', 'driver', clerk, cache)),
    ...(await collect('passenger_identity', 'passenger_user_id', 'identity_status', 'identity_submitted_at', 'passenger', clerk, cache)),
  ];

  console.log(`\nDashboard "Verification queue" counts ${entries.length} row(s).`);
  console.log(`Distinct users behind that number: ${new Set(entries.map((e) => e.userId)).size}\n`);

  const buckets = new Map();
  for (const entry of entries) {
    const reason = classify(entry);
    if (!buckets.has(reason)) buckets.set(reason, []);
    buckets.get(reason).push(entry);
  }

  for (const [reason, list] of buckets) {
    console.log(`--- ${reason}: ${list.length} row(s) ---`);
    for (const entry of list) {
      console.log(
        `    ${entry.table.padEnd(19)} ${entry.userId}  submitted=${entry.submittedAt ? new Date(entry.submittedAt).toISOString() : 'null'}  docs=${entry.hasDocuments ? 'yes' : 'no'}${entry.clerkError ? `  error=${entry.clerkError}` : ''}`
      );
    }
    console.log('');
  }

  const orphans = entries.filter((entry) => entry.clerkExists === false);
  if (orphans.length === 0) {
    console.log('No orphaned rows found. Nothing to delete.');
    return;
  }

  if (!shouldDelete) {
    console.log(`${orphans.length} orphaned row(s) can be deleted. Re-run with --delete=true to remove them.`);
    return;
  }

  for (const orphan of orphans) {
    const idColumn = orphan.table === 'passenger_identity' ? 'passenger_user_id' : 'driver_user_id';
    await query(`DELETE FROM ${orphan.table} WHERE ${idColumn} = ?`, [orphan.userId]);
    console.log(`Deleted ${orphan.table} row for ${orphan.userId}`);
  }
  console.log(`\nRemoved ${orphans.length} orphaned verification row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('audit-pending-verifications failed:', error);
    process.exit(1);
  });
