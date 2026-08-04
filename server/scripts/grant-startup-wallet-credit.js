import 'dotenv/config';
import { query } from '../db/connection.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { toAppUser } from '../lib/clerk-user.js';
import { getDriverWalletSettings } from '../lib/driver-wallet-settings.js';
import { creditDriverWalletManual } from '../lib/driver-wallet.js';

/**
 * Startup wallet grant: credit every Clerk driver a fixed amount once.
 *
 * Re-running with the same --grant-id only credits drivers who joined since the
 * last run, so it doubles as the "top up the new drivers" job.
 *
 * Dry-run by default. Pass --apply=true to write balances.
 *
 * Examples:
 *   node scripts/grant-startup-wallet-credit.js
 *   node scripts/grant-startup-wallet-credit.js --amount=5 --apply=true
 *   node scripts/grant-startup-wallet-credit.js --amount=5 --grant-id=launch_2026_07 --apply=true
 */

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`) || getArg(name).toLowerCase() === 'true';
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
      if (appUser.role !== 'driver') continue;
      drivers.push({
        id: appUser.clerk_user_id,
        email: appUser.email || null,
        fullName: [appUser.first_name, appUser.last_name].filter(Boolean).join(' ').trim() || null,
      });
    }

    offset += users.length;
    if (users.length < limit) break;
  }

  return drivers;
}

async function loadAlreadyGrantedDriverIds(grantId) {
  const rows = await query(
    `SELECT DISTINCT driver_user_id
     FROM driver_wallet_transactions
     WHERE transaction_type = 'manual_credit'
       AND source_type = 'startup_grant'
       AND source_id = ?`,
    [grantId]
  );
  return new Set(rows.map((row) => row.driver_user_id));
}

async function main() {
  const amount = Number(getArg('amount', '5'));
  const apply = hasFlag('apply');
  const grantId = String(getArg('grant-id', 'startup_grant_v1')).trim() || 'startup_grant_v1';
  const settings = await getDriverWalletSettings();
  const currency = String(getArg('currency', settings.currency || 'USD')).toUpperCase();

  if (!(amount > 0)) {
    throw new Error(`Invalid --amount=${amount}. Must be greater than zero.`);
  }

  console.log(`\nStartup wallet grant`);
  console.log(`  amount:     ${currency} ${amount.toFixed(2)}`);
  console.log(`  grant id:   ${grantId}`);
  console.log(`  mode:       ${apply ? 'APPLY (will credit wallets)' : 'DRY RUN (no writes)'}`);
  console.log(`  source:     all Clerk users with role=driver\n`);

  const [drivers, alreadyGranted] = await Promise.all([
    loadAllClerkDrivers(),
    loadAlreadyGrantedDriverIds(grantId),
  ]);
  const pending = drivers.filter((driver) => !alreadyGranted.has(driver.id));

  console.log(`Found ${drivers.length} driver(s).`);
  console.log(`  already granted "${grantId}": ${drivers.length - pending.length}`);
  console.log(`  pending this grant:          ${pending.length}`);
  console.log(`  total to credit:             ${currency} ${(pending.length * amount).toFixed(2)}\n`);

  if (pending.length === 0) {
    console.log('Every driver already received this grant. Nothing to do.');
    return;
  }

  const summary = {
    credited: 0,
    skipped: 0,
    failed: 0,
  };

  for (const driver of pending) {
    const label = driver.fullName || driver.email || driver.id;
    try {
      if (!apply) {
        console.log(`[dry-run] would credit ${currency} ${amount.toFixed(2)} → ${label} (${driver.id})`);
        summary.credited += 1;
        continue;
      }

      const result = await creditDriverWalletManual({
        driverUserId: driver.id,
        amount,
        currency,
        description: `Startup wallet grant (${grantId})`,
        sourceType: 'startup_grant',
        sourceId: grantId,
        paymentMethod: 'admin_grant',
      });

      if (result.alreadyCredited) {
        summary.skipped += 1;
        console.log(
          `[skip] already credited ${currency} ${Number(result.amount).toFixed(2)} → ${label} (balance ${result.wallet.availableBalance})`
        );
        continue;
      }

      summary.credited += 1;
      console.log(
        `[ok] credited ${currency} ${Number(result.amount).toFixed(2)} → ${label} (new balance ${result.wallet.availableBalance})`
      );
    } catch (error) {
      summary.failed += 1;
      console.error(`[fail] ${label} (${driver.id}): ${error?.message || error}`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  credited: ${summary.credited}`);
  console.log(`  skipped:  ${summary.skipped}`);
  console.log(`  failed:   ${summary.failed}`);
  if (!apply) {
    console.log(`\nRe-run with --apply=true to actually credit wallets.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('grant-startup-wallet-credit failed:', error);
    process.exit(1);
  });
