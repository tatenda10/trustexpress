import 'dotenv/config';
import {
  DEFAULT_STARTUP_GRANT_AMOUNT,
  DEFAULT_STARTUP_GRANT_ID,
  runStartupWalletGrant,
} from '../lib/startup-wallet-grant.js';

/**
 * Startup wallet grant: credit every Clerk driver a fixed amount once.
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

async function main() {
  const amount = Number(getArg('amount', String(DEFAULT_STARTUP_GRANT_AMOUNT)));
  const apply = hasFlag('apply');
  const grantId = String(getArg('grant-id', DEFAULT_STARTUP_GRANT_ID)).trim() || DEFAULT_STARTUP_GRANT_ID;
  const currency = getArg('currency', '') || null;

  console.log(`\nStartup wallet grant`);
  console.log(`  amount:     ${amount}`);
  console.log(`  grant id:   ${grantId}`);
  console.log(`  mode:       ${apply ? 'APPLY (will credit wallets)' : 'DRY RUN (no writes)'}\n`);

  const summary = await runStartupWalletGrant({
    amount,
    grantId,
    currency,
    apply,
  });

  console.log(`Found ${summary.totalDrivers} driver(s).`);
  console.log(`  already granted "${summary.grantId}": ${summary.alreadyGranted}`);
  console.log(`  pending this grant:          ${summary.pending}`);
  console.log(`  total to credit:             ${summary.currency} ${Number(summary.totalToCredit).toFixed(2)}\n`);

  if (summary.pending === 0) {
    console.log('Every driver already received this grant. Nothing to do.');
    return;
  }

  if (!apply) {
    for (const driver of summary.samplePending) {
      const label = driver.fullName || driver.email || driver.id;
      console.log(`[dry-run] would credit ${summary.currency} ${Number(summary.amount).toFixed(2)} → ${label} (${driver.id})`);
    }
    if (summary.pending > summary.samplePending.length) {
      console.log(`... and ${summary.pending - summary.samplePending.length} more`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  credited: ${summary.credited}`);
  console.log(`  skipped:  ${summary.skipped}`);
  console.log(`  failed:   ${summary.failed}`);
  if (summary.failures?.length) {
    for (const failure of summary.failures.slice(0, 20)) {
      console.error(`[fail] ${failure.label}: ${failure.error}`);
    }
  }
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
