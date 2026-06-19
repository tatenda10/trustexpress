import 'dotenv/config';
import { query } from '../db/connection.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { toAppUser } from '../lib/clerk-user.js';

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function printSection(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function loadAllClerkDrivers() {
  const clerk = getClerkClient();
  const limit = 100;
  let offset = 0;
  const drivers = [];

  while (true) {
    const page = await clerk.users.getUserList({
      limit,
      offset,
      orderBy: '-created_at',
    });
    const users = page.data || [];
    if (!users.length) break;

    for (const user of users) {
      const appUser = toAppUser(user);
      if (appUser.role === 'driver') {
        drivers.push({
          clerkUserId: appUser.clerk_user_id,
          email: appUser.email || null,
          firstName: appUser.first_name || null,
          lastName: appUser.last_name || null,
          fullName: [appUser.first_name, appUser.last_name].filter(Boolean).join(' ').trim() || null,
          phoneNumber: appUser.phone_number || null,
          phoneVerified: appUser.phoneVerified === true,
          createdAt: appUser.created_at || null,
        });
      }
    }

    offset += users.length;
    if (users.length < limit) break;
  }

  return drivers;
}

async function main() {
  const emailFilter = String(getArg('email') || '').trim().toLowerCase();
  const verbose = String(getArg('verbose') || '').trim().toLowerCase() === 'true';

  let clerkDrivers = await loadAllClerkDrivers();

  if (emailFilter) {
    clerkDrivers = clerkDrivers.filter((driver) => String(driver.email || '').trim().toLowerCase() === emailFilter);
  }

  if (!clerkDrivers.length) {
    printSection('Result', emailFilter
      ? `No Clerk driver found for email: ${emailFilter}`
      : 'No Clerk drivers found.');
    return;
  }

  const clerkUserIds = clerkDrivers.map((driver) => driver.clerkUserId);
  const placeholders = clerkUserIds.map(() => '?').join(', ');

  const [userRows, identityRows, vehicleRows, availabilityRows] = await Promise.all([
    query(
      `SELECT clerk_user_id, email, role, phone_number, phone_verified_at, created_at, updated_at
       FROM users
       WHERE clerk_user_id IN (${placeholders})`,
      clerkUserIds
    ),
    query(
      `SELECT driver_user_id, profile_status, profile_submitted_at, updated_at
       FROM driver_identity
       WHERE driver_user_id IN (${placeholders})`,
      clerkUserIds
    ),
    query(
      `SELECT driver_user_id, vehicle_status, vehicle_submitted_at, updated_at
       FROM driver_vehicle
       WHERE driver_user_id IN (${placeholders})`,
      clerkUserIds
    ),
    query(
      `SELECT driver_user_id, is_online, last_seen_at, updated_at
       FROM driver_availability
       WHERE driver_user_id IN (${placeholders})`,
      clerkUserIds
    ),
  ]);

  const usersById = new Map(userRows.map((row) => [row.clerk_user_id, row]));
  const identityById = new Map(identityRows.map((row) => [row.driver_user_id, row]));
  const vehicleById = new Map(vehicleRows.map((row) => [row.driver_user_id, row]));
  const availabilityById = new Map(availabilityRows.map((row) => [row.driver_user_id, row]));

  const missingUsers = [];
  const wrongRoleUsers = [];
  const missingIdentity = [];
  const missingVehicle = [];
  const missingAvailability = [];
  const fullyMissingFromMysql = [];

  for (const driver of clerkDrivers) {
    const localUser = usersById.get(driver.clerkUserId) || null;
    const identity = identityById.get(driver.clerkUserId) || null;
    const vehicle = vehicleById.get(driver.clerkUserId) || null;
    const availability = availabilityById.get(driver.clerkUserId) || null;

    const base = {
      clerkUserId: driver.clerkUserId,
      email: driver.email,
      fullName: driver.fullName,
      phoneNumber: driver.phoneNumber,
      createdAt: driver.createdAt,
    };

    if (!localUser) {
      missingUsers.push(base);
    } else if (String(localUser.role || '').toLowerCase() !== 'driver') {
      wrongRoleUsers.push({
        ...base,
        localRole: localUser.role || null,
      });
    }

    if (!identity) {
      missingIdentity.push(base);
    }

    if (!vehicle) {
      missingVehicle.push(base);
    }

    if (!availability) {
      missingAvailability.push(base);
    }

    if (!localUser && !identity && !vehicle && !availability) {
      fullyMissingFromMysql.push(base);
    }
  }

  printSection('Summary', {
    clerkDriverCount: clerkDrivers.length,
    missingUsersCount: missingUsers.length,
    wrongRoleUsersCount: wrongRoleUsers.length,
    missingDriverIdentityCount: missingIdentity.length,
    missingDriverVehicleCount: missingVehicle.length,
    missingDriverAvailabilityCount: missingAvailability.length,
    fullyMissingFromMysqlCount: fullyMissingFromMysql.length,
  });

  printSection(
    'Drivers Missing From users Table',
    missingUsers.length ? missingUsers : 'All Clerk drivers have a users row.'
  );
  printSection(
    'Drivers With Wrong Local Role',
    wrongRoleUsers.length ? wrongRoleUsers : 'No Clerk driver has a wrong local role.'
  );

  if (verbose) {
    printSection(
      'Drivers Missing driver_identity',
      missingIdentity.length ? missingIdentity : 'All Clerk drivers have a driver_identity row.'
    );
    printSection(
      'Drivers Missing driver_vehicle',
      missingVehicle.length ? missingVehicle : 'All Clerk drivers have a driver_vehicle row.'
    );
    printSection(
      'Drivers Missing driver_availability',
      missingAvailability.length ? missingAvailability : 'All Clerk drivers have a driver_availability row.'
    );
    printSection(
      'Drivers Fully Missing From Local MySQL',
      fullyMissingFromMysql.length ? fullyMissingFromMysql : 'No Clerk driver is fully missing from local MySQL.'
    );
  } else {
    printSection(
      'Verbose Hint',
      'Run with --verbose=true to also list missing driver_identity, driver_vehicle, and driver_availability rows.'
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nfind-unsynced-clerk-drivers failed:', error?.message || error);
    process.exit(1);
  });
