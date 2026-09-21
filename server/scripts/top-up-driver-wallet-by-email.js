import 'dotenv/config';
import { query } from '../db/connection.js';
import { creditDriverWalletManual } from '../lib/driver-wallet.js';

const DEFAULT_EMAIL = 'tatendamuzenda740@gmail.com';
const DEFAULT_TARGET_BALANCE = 5;
const DEFAULT_CURRENCY = 'USD';

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`) || getArg(name).toLowerCase() === 'true';
}

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

async function main() {
  const email = String(getArg('email', DEFAULT_EMAIL)).trim().toLowerCase();
  const targetBalance = normalizeMoney(getArg('target', String(DEFAULT_TARGET_BALANCE)));
  const currency = String(getArg('currency', DEFAULT_CURRENCY)).trim().toUpperCase() || DEFAULT_CURRENCY;
  const apply = hasFlag('apply');

  if (!email) throw new Error('Email is required');
  if (!(targetBalance > 0)) throw new Error('Target balance must be greater than zero');

  const [driver] = await query(
    `SELECT clerk_user_id, email, first_name, last_name, role
     FROM users
     WHERE LOWER(email) = ?
     ORDER BY updated_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [email]
  );

  if (!driver?.clerk_user_id) {
    throw new Error(`No user found for ${email}`);
  }

  const [wallet] = await query(
    `SELECT available_balance
     FROM driver_wallets
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driver.clerk_user_id]
  );

  const currentBalance = normalizeMoney(wallet?.available_balance || 0);
  const creditAmount = normalizeMoney(targetBalance - currentBalance);
  const fullName = [driver.first_name, driver.last_name].filter(Boolean).join(' ').trim() || driver.email;
  const sourceId = `target-balance-${email}-${currency}-${targetBalance.toFixed(2)}`;

  console.log('\nDriver wallet target top-up');
  console.log(`  driver:          ${fullName}`);
  console.log(`  email:           ${driver.email}`);
  console.log(`  user id:         ${driver.clerk_user_id}`);
  console.log(`  current balance: ${currency} ${currentBalance.toFixed(2)}`);
  console.log(`  target balance:  ${currency} ${targetBalance.toFixed(2)}`);
  console.log(`  credit amount:   ${currency} ${Math.max(creditAmount, 0).toFixed(2)}`);
  console.log(`  mode:            ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  if (creditAmount <= 0) {
    console.log('No credit needed; wallet is already at or above the target balance.');
    return;
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply=true to write the credit.');
    return;
  }

  const result = await creditDriverWalletManual({
    driverUserId: driver.clerk_user_id,
    amount: creditAmount,
    currency,
    description: `Manual target-balance top-up to ${currency} ${targetBalance.toFixed(2)} for ${email}`,
    sourceType: 'manual_target_balance_topup',
    sourceId,
    paymentMethod: 'admin_script',
  });

  console.log('Top-up complete.');
  console.log(`  credited:        ${result.credited ? 'yes' : 'no'}`);
  console.log(`  already credited:${result.alreadyCredited ? ' yes' : ' no'}`);
  console.log(`  transaction id:  ${result.transactionId || '-'}`);
  console.log(`  new balance:     ${result.wallet?.currency || currency} ${Number(result.wallet?.availableBalance || 0).toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('top-up-driver-wallet-by-email failed:', error?.message || error);
    process.exit(1);
  });
