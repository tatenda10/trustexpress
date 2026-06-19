import 'dotenv/config';
import { query } from '../db/connection.js';

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function printSection(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function main() {
  const email = String(getArg('email') || process.argv[2] || '').trim().toLowerCase();

  if (!email) {
    throw new Error('Usage: node scripts/find-driver-by-email.js --email=someone@example.com');
  }

  const users = await query(
    `SELECT
       id,
       clerk_user_id,
       email,
       role,
       phone_number,
       phone_verified_at,
       created_at,
       updated_at
     FROM users
     WHERE LOWER(email) = ?`,
    [email]
  );

  if (!users.length) {
    printSection('Result', `No app user found for email: ${email}`);
    return;
  }

  printSection('Matched Users', users);

  const clerkUserIds = users.map((row) => row.clerk_user_id).filter(Boolean);
  const driverUsers = users.filter((row) => String(row.role || '').toLowerCase() === 'driver');

  if (!driverUsers.length) {
    printSection('Driver Check', 'User exists in the database, but role is not "driver".');
    return;
  }

  const placeholders = clerkUserIds.map(() => '?').join(', ');

  const [identityRows, vehicleRows, availabilityRows, rideRows, reimbursementRows] = await Promise.all([
    query(
      `SELECT *
       FROM driver_identity
       WHERE driver_user_id IN (${placeholders})`,
      clerkUserIds
    ),
    query(
      `SELECT *
       FROM driver_vehicle
       WHERE driver_user_id IN (${placeholders})`,
      clerkUserIds
    ),
    query(
      `SELECT *
       FROM driver_availability
       WHERE driver_user_id IN (${placeholders})`,
      clerkUserIds
    ),
    query(
      `SELECT
         id,
         public_id,
         driver_user_id,
         passenger_name,
         pickup_label,
         dropoff_label,
         status,
         requested_at,
         assigned_at,
         completed_at
       FROM ride_requests
       WHERE driver_user_id IN (${placeholders})
       ORDER BY COALESCE(completed_at, assigned_at, requested_at) DESC
       LIMIT 20`,
      clerkUserIds
    ),
    query(
      `SELECT
         id,
         driver_user_id,
         period_start,
         period_end,
         ride_count,
         total_reimbursement_amount,
         status,
         created_at,
         approved_at,
         paid_at
       FROM driver_discount_reimbursements
       WHERE driver_user_id IN (${placeholders})
       ORDER BY period_end DESC, id DESC`,
      clerkUserIds
    ),
  ]);

  printSection('Driver Identity', identityRows.length ? identityRows : 'No driver_identity row found');
  printSection('Driver Vehicle', vehicleRows.length ? vehicleRows : 'No driver_vehicle row found');
  printSection('Driver Availability', availabilityRows.length ? availabilityRows : 'No driver_availability row found');
  printSection('Recent Rides', rideRows.length ? rideRows : 'No rides found for this driver');
  printSection('Discount Reimbursements', reimbursementRows.length ? reimbursementRows : 'No reimbursement rows found');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nfind-driver-by-email failed:', error?.message || error);
    process.exit(1);
  });
