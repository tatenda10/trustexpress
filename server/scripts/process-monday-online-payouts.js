import 'dotenv/config';
import { processMondayOnlinePayouts } from '../lib/monday-online-payouts.js';

function hasFlag(name) {
  return process.argv.includes(`--${name}`) || process.argv.includes(`--${name}=true`);
}

async function main() {
  const apply = hasFlag('apply');
  const force = hasFlag('force');
  if (apply) {
    console.error('Batch payouts must be authorized from the admin dashboard. CLI apply mode is disabled.');
    process.exit(1);
  }
  const result = await processMondayOnlinePayouts({
    apply: false,
    requireMonday: !force,
  });

  if (result.skipped) {
    console.log('Not Monday; no auto payouts processed. Use --force for manual testing.');
    process.exit(0);
  }

  console.log(`Found ${result.summary.totalDrivers} driver(s) with withdrawable passenger-payment earnings.`);
  for (const row of result.applied ? result.results : result.candidates) {
    const amount = Number(row.amount ?? row.withdrawableBalance ?? 0);
    const prefix = result.applied ? row.status.toUpperCase() : 'PREVIEW';
    console.log(`${prefix} ${row.driverUserId}: ${amount.toFixed(2)}${row.publicId ? ` (${row.publicId})` : ''}${row.error ? ` - ${row.error}` : ''}`);
  }

  console.log('Dry run only. Authorize actual payouts from the admin dashboard.');
  process.exit(0);
}

main().catch((error) => {
  console.error('process-monday-online-payouts failed:', error);
  process.exit(1);
});
